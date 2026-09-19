import { newId, sha256Hex } from '../ids.mjs';
import { ConnError } from '../errors.mjs';
import { audit } from '../wecom/consent.mjs';

/**
 * 证据层次：EvidenceArtifact → Observation → FactAssertion（候选）。
 * 自动识别只产生 observation/候选事实，绝不自动"人工已确认"（任务02 §6）。
 * SHA256 只证明采集后字节一致；sourceGroup 相同的视频截帧=同源，不加独立证据计数（I18）。
 * 只有明确更正关系（correction_of）才 supersede；发票vs合同金额冲突并存（I17）。
 * 客户素材中的指令式文本一律 non-trusted，永不进入指令通道（I20）。
 */

const INJECTION_PATTERNS = [
  /忽略.{0,6}(规则|限制|审查)/i, /(直接|立即|现在).{0,4}(批准|通过)/i, /ignore.{0,10}(rules?|polic(?:y|ies)|review)/i,
  /approve.{0,10}(now|immediately)/i, /不要.{0,4}(核验|审查|复核)/i, /disregard.{0,10}(instructions?|rules?)/i,
];

export function flagUntrustedContent(text) {
  const s = String(text ?? '');
  const hits = INJECTION_PATTERNS.filter((re) => re.test(s)).map((re) => re.source);
  return { trusted: false, instructionLike: hits.length > 0, patterns: hits };
}

export function makeEvidenceService(store) {
  /** 登记原始材料。objectRef+sha256 来自对象存储；sameSource 判定按 sourceGroup + 派生链。
   *  任务02 · B1/W02：登记与解析/事实候选/人工核验分离——本函数只登记原件与元数据，
   *  绝不产生事实；readable=false（加密/缺页/不可读）→ completeness=needs_followup（待补），
   *  不编数。客户上传（upload_source=customer_upload）只能形成声明级未核验工件。 */
  async function registerArtifact(a) {
    const required = ['tenantId', 'customerId', 'sourceProvider', 'kind', 'sourceGroup'];
    for (const k of required) if (!a[k]) throw new ConnError('INVALID_INPUT', `registerArtifact: ${k} required`);
    const COMPLETENESS = ['complete', 'incomplete', 'needs_followup'];
    const completeness = a.completeness ?? 'complete';
    if (!COMPLETENESS.includes(completeness)) throw new ConnError('INVALID_INPUT', `registerArtifact: completeness 必须是 ${COMPLETENESS.join('/')}`);
    if (completeness === 'needs_followup' && a.readable !== false) {
      throw new ConnError('INVALID_INPUT', 'registerArtifact: needs_followup 必须显式 readable=false（加密/缺页/不可读）');
    }
    const evidenceId = newId('ev');

    let duplicateOf = null;
    let sameSourceFlag = null;
    if (a.sha256) {
      // IR-03-8③ 判重收敛到客户级：跨客户同字节各自独立处理（A 侧按客户隔离，本侧不得跨客户误判 skipped_duplicate）
      const dup = await store.query(
        `SELECT evidence_id FROM evidence_artifacts WHERE tenant_id=$1 AND customer_id=$2 AND sha256=$3 AND evidence_id != $4 LIMIT 1`,
        [a.tenantId, a.customerId, a.sha256, evidenceId],
      );
      if (dup.rows.length > 0) duplicateOf = dup.rows[0].evidence_id;
    }
    if (duplicateOf) {
      sameSourceFlag = 'same_source';
    } else if (a.derivedFrom) {
      const src = await store.query(
        `SELECT source_group, media_start_ms, media_end_ms FROM evidence_artifacts WHERE tenant_id=$1 AND evidence_id=$2`,
        [a.tenantId, a.derivedFrom],
      );
      if (src.rows.length > 0 && src.rows[0].source_group === a.sourceGroup) {
        sameSourceFlag = 'suspected_duplicate'; // 同源视频换格式/截帧：不增加独立佐证
      }
    }

    const verificationState = completeness === 'needs_followup' ? 'incomplete'
      : (completeness === 'incomplete' ? 'incomplete' : 'unverified');
    await store.query(
      `INSERT INTO evidence_artifacts
         (evidence_id, tenant_id, customer_id, session_id, source_provider, provider_event_id, object_ref, sha256, kind,
          captured_at, media_start_ms, media_end_ms, track, frame_region, consent_ref, verification_state, completeness,
          source_group, derived_from, duplicate_of, same_source_flag, source_mode, trust, schema_version,
          period_from, period_to, currency, unit, caliber, page_from, page_to, uploader_ref, upload_source, object_refs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,1,
               $24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
      [
        evidenceId, a.tenantId, a.customerId, a.sessionId ?? null, a.sourceProvider, a.providerEventId ?? null,
        a.objectRef ?? null, a.sha256 ?? null, a.kind, a.capturedAt ?? null, a.mediaStartMs ?? null, a.mediaEndMs ?? null,
        a.track ?? null, a.frameRegion ?? null, a.consentRef ?? null,
        verificationState,
        completeness, a.sourceGroup, a.derivedFrom ?? null, duplicateOf, sameSourceFlag,
        a.sourceMode ?? 'real', a.trust ? JSON.stringify(a.trust) : '{}',
        a.periodFrom ?? null, a.periodTo ?? null, a.currency ?? null, a.unit ?? null, a.caliber ?? null,
        a.pageFrom ?? null, a.pageTo ?? null, a.uploaderRef ?? null, a.uploadSource ?? null,
        JSON.stringify(Array.isArray(a.objectRefs) ? a.objectRefs : []),
      ],
    );
    await audit(store, {
      tenantId: a.tenantId, actor: 'evidence-service', action: 'EVIDENCE_REGISTERED', targetType: 'evidence', targetId: evidenceId,
      summary: `kind=${a.kind} group=${a.sourceGroup} dup=${duplicateOf ?? 'no'} sameSource=${sameSourceFlag ?? 'no'} completeness=${completeness}${a.uploadSource ? ` src=${a.uploadSource}` : ''}`,
    });
    return { evidenceId, duplicateOf, sameSourceFlag, completeness, verificationState };
  }

  /** 人工核验升级（操作者动作，服务令牌面）：客户上传永远无法自证 verified。
   *  verdict=verified|rejected；核验意见必须附理由；只读元数据不改写原件字节。 */
  async function verifyArtifact({ tenantId, evidenceId, verifiedBy, verdict, reason }) {
    if (!tenantId || !evidenceId || !verifiedBy || !reason) {
      throw new ConnError('INVALID_INPUT', 'verifyArtifact: tenantId/evidenceId/verifiedBy/reason required');
    }
    if (!['verified', 'rejected'].includes(verdict)) throw new ConnError('INVALID_INPUT', 'verifyArtifact: verdict 必须是 verified|rejected');
    const rows = (await store.query(
      `SELECT verification_state, completeness FROM evidence_artifacts WHERE tenant_id=$1 AND evidence_id=$2`,
      [tenantId, evidenceId],
    )).rows;
    if (rows.length === 0) throw new ConnError('NOT_FOUND', `evidence ${evidenceId}`);
    if (rows[0].completeness === 'needs_followup') {
      throw new ConnError('INVALID_STATE', 'verifyArtifact: 待补材料须先补齐重传，不能在缺失状态核验');
    }
    const next = verdict === 'verified' ? 'verified' : rows[0].verification_state;
    await store.query(
      `UPDATE evidence_artifacts SET verification_state=$3 WHERE tenant_id=$1 AND evidence_id=$2`,
      [tenantId, evidenceId, next],
    );
    await audit(store, {
      tenantId, actor: verifiedBy, action: verdict === 'verified' ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_REJECTED',
      targetType: 'evidence', targetId: evidenceId, summary: `verdict=${verdict} reason=${reason.slice(0, 120)}`,
    });
    return { ok: true, evidenceId, verificationState: next };
  }

  /** W10 对象范围覆盖：指定 kind 在指定对象上的独立证据计数。
   *  只存在"同 kind 材料"不等于"该对象已覆盖"——对象/期间必须显式命中；
   *  needs_followup 材料不计入覆盖。 */
  async function evidenceCoverage({ tenantId, customerId, kind, objectRef }) {
    if (!tenantId || !customerId || !kind || !objectRef) {
      throw new ConnError('INVALID_INPUT', 'evidenceCoverage: tenantId/customerId/kind/objectRef required');
    }
    const r = await store.query(
      `SELECT COUNT(DISTINCT (COALESCE(source_group,'') || '|' || COALESCE(sha256, evidence_id)))::int AS n
       FROM evidence_artifacts
       WHERE tenant_id=$1 AND customer_id=$2 AND kind=$3
         AND object_refs @> $4::jsonb
         AND duplicate_of IS NULL AND same_source_flag IS NULL
         AND completeness = 'complete'`,
      [tenantId, customerId, kind, JSON.stringify([objectRef])],
    );
    return { kind, objectRef, independentCount: r.rows[0].n };
  }

  /** 独立证据计数：同 sha256 与同源标记都不计数。 */
  async function independentEvidenceCount({ tenantId, customerId }) {
    const r = await store.query(
      `SELECT COUNT(DISTINCT (COALESCE(source_group,'') || '|' || COALESCE(sha256, evidence_id)))::int AS n
       FROM evidence_artifacts WHERE tenant_id=$1 AND customer_id=$2 AND duplicate_of IS NULL AND same_source_flag IS NULL`,
      [tenantId, customerId],
    );
    return r.rows[0].n;
  }

  /** 转写/OCR/视觉观测：provisional→final 修订链；说话人未知保留未知。 */
  async function addObservation(o) {
    if (!o.tenantId || !o.segmentId || o.text == null) throw new ConnError('INVALID_INPUT', 'addObservation: tenantId/segmentId/text required');
    const prev = await store.query(
      `SELECT observation_id, revision, state FROM evidence_observations
       WHERE tenant_id=$1 AND segment_id=$2 AND superseded_by IS NULL ORDER BY revision DESC LIMIT 1`,
      [o.tenantId, o.segmentId],
    );
    const observationId = newId('obs');
    const revision = prev.rows.length > 0 ? prev.rows[0].revision + 1 : 1;
    const untrusted = flagUntrustedContent(o.text);
    await store.query(
      `INSERT INTO evidence_observations (observation_id, tenant_id, artifact_id, session_id, obs_kind, segment_id, revision, state, text, start_ms, end_ms, language, speaker, quality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [observationId, o.tenantId, o.artifactId ?? null, o.sessionId ?? null, o.obsKind ?? 'transcription', o.segmentId,
       revision, o.state ?? 'provisional', o.text, o.startMs ?? null, o.endMs ?? null, o.language ?? null,
       o.speaker ?? 'unknown', o.quality ?? null],
    );
    if (prev.rows.length > 0) {
      await store.query(`UPDATE evidence_observations SET superseded_by=$3 WHERE observation_id=$1 AND tenant_id=$2`, [prev.rows[0].observation_id, o.tenantId, observationId]);
      // 修订使下游候选失效（I16）：引用旧版本的事实候选 → stale。
      const stale = await store.query(
        `UPDATE fact_assertions SET status='stale', stale_reason='observation_revised'
         WHERE tenant_id=$1 AND status='candidate' AND from_observations ? $2 RETURNING fact_id`,
        [o.tenantId, prev.rows[0].observation_id],
      );
      if (stale.rows.length > 0) {
        await audit(store, { tenantId: o.tenantId, actor: 'evidence-service', action: 'FACTS_STALE_BY_REVISION', targetType: 'observation', targetId: observationId, summary: `revised ${prev.rows[0].observation_id}; ${stale.rows.length} candidate(s) marked stale` });
      }
    }
    return { observationId, revision, state: o.state ?? 'provisional', untrusted };
  }

  /** 事实候选（authority=none）。检测同 subject+predicate 冲突 → 并存 + conflict 记录（I17）。
   *  任务02 · W10：事实可携带对象/期间锚定；不同对象/期间的同名事实不互相替代。
   *  goal-02：f.contentKey（内容键）给定时 factId 确定性生成——处理任务重放/崩溃恢复
   *  重入时同键零新增（ON CONFLICT DO NOTHING），不产生重复候选或重复冲突记录。 */
  async function assertFact(f) {
    if (!f.tenantId || !f.customerId || !f.subject || !f.predicate || f.objectValue == null) {
      throw new ConnError('INVALID_INPUT', 'assertFact: tenantId/customerId/subject/predicate/objectValue required');
    }
    const factId = f.contentKey ? `fact-${String(f.contentKey).replace(/[^a-z0-9]/gi, '').slice(0, 40)}` : newId('fact');
    if (f.contentKey) {
      const dup = await store.query(`SELECT fact_id FROM fact_assertions WHERE fact_id=$1`, [factId]);
      if (dup.rows.length > 0) return { factId, status: 'candidate', authority: 'none', conflicts: [], untrusted: { trusted: false, instructionLike: false, patterns: [] }, existed: true };
    }
    const untrusted = flagUntrustedContent(f.objectValue) ;
    await store.query(
      `INSERT INTO fact_assertions (fact_id, tenant_id, customer_id, statement, subject, predicate, object_value, unit, from_observations, from_artifacts, source_mode, object_ref, period_from, period_to, entry_mode, value_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [factId, f.tenantId, f.customerId, f.statement ?? `${f.subject} ${f.predicate} = ${f.objectValue}`, f.subject, f.predicate, String(f.objectValue), f.unit ?? null,
       JSON.stringify(f.fromObservations ?? []), JSON.stringify(f.fromArtifacts ?? []), f.sourceMode ?? 'real',
       f.objectRef ?? null, f.periodFrom ?? null, f.periodTo ?? null,
       f.entryMode ?? null, f.valueJson === undefined ? null : JSON.stringify(f.valueJson)],
    );
    if (untrusted.instructionLike) {
      await store.query(`UPDATE fact_assertions SET stale_reason='contains_instruction_like_text', status='candidate' WHERE fact_id=$1`, [factId]);
      await audit(store, { tenantId: f.tenantId, actor: 'evidence-service', action: 'UNTRUSTED_CONTENT_FLAGGED', targetType: 'fact', targetId: factId, summary: `patterns=${untrusted.patterns.join(';')}; content never executed` });
    }
    const others = await store.query(
      `SELECT fact_id, object_value FROM fact_assertions
       WHERE tenant_id=$1 AND customer_id=$2 AND subject=$3 AND predicate=$4 AND fact_id != $5 AND status IN ('candidate','stale')
         AND COALESCE(object_ref,'') = COALESCE($6,'')`,
      [f.tenantId, f.customerId, f.subject, f.predicate, factId, f.objectRef ?? ''],
    );
    const conflicts = [];
    for (const other of others.rows) {
      if (String(other.object_value) !== String(f.objectValue)) {
        const conflictId = newId('cfl');
        await store.query(
          `INSERT INTO fact_conflicts (conflict_id, tenant_id, customer_id, subject, predicate, fact_a, fact_b) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [conflictId, f.tenantId, f.customerId, f.subject, f.predicate, other.fact_id, factId],
        );
        conflicts.push({ conflictId, withFactId: other.fact_id, otherValue: other.object_value });
      }
    }
    return { factId, status: 'candidate', authority: 'none', conflicts, untrusted };
  }

  /** goal-02·B2 人工录入（扫描/图片等机器不可解析材料的"原件可见、来源可选、人工录入"产品入口）。
   *  录入事实=转录（observation quality=human_transcription，附来源定位与录入人）；
   *  录入 ≠ 人工核验：verified 只能经 verifyQuestion/verifyArtifact 由获准复核产生。
   *  同内容重录走 contentKey 确定性幂等（零重复候选）。needs_followup（不可读/缺页）材料拒绝录入。 */
  async function manualEntry({ tenantId, customerId, evidenceId, facts = [], enteredBy, reason }) {
    if (!tenantId || !customerId || !evidenceId || !enteredBy || !reason) {
      throw new ConnError('INVALID_INPUT', 'manualEntry: tenantId/customerId/evidenceId/enteredBy/reason 必填');
    }
    if (!Array.isArray(facts) || facts.length === 0) throw new ConnError('INVALID_INPUT', 'manualEntry: facts 必须非空数组');
    for (const f of facts) {
      if (!f?.factKey || f.value == null) throw new ConnError('INVALID_INPUT', 'manualEntry: facts[].factKey/value 必填');
    }
    const art = (await store.query(
      `SELECT completeness, verification_state, object_refs FROM evidence_artifacts WHERE tenant_id=$1 AND evidence_id=$2`,
      [tenantId, evidenceId],
    )).rows[0];
    if (!art) throw new ConnError('NOT_FOUND', `evidence ${evidenceId}`);
    if (art.completeness === 'needs_followup') {
      throw new ConnError('INVALID_STATE', 'manualEntry: 待补（不可读）材料须先补齐重传，不能对缺失原件录入事实');
    }
    const anchor = Array.isArray(art.object_refs) && art.object_refs.length > 0 ? art.object_refs[0] : null;
    const segmentId = `manual:${evidenceId}:${Date.now().toString(36)}`;
    const summary = facts.map((f) => `${f.factKey}=${f.value}`).join('; ').slice(0, 2000);
    const obs = await addObservation({
      tenantId, artifactId: evidenceId, obsKind: 'manual_entry', segmentId, state: 'final',
      text: `人工录入（录入人 ${enteredBy}；理由 ${String(reason).slice(0, 200)}）：${summary}`,
      quality: ['human_transcription'],
    });
    const results = [];
    for (const f of facts) {
      const contentKey = sha256Hex(JSON.stringify({
        t: tenantId, c: customerId, s: anchor ?? `customer:${customerId}`, p: f.factKey, v: f.value,
        u: f.unit ?? null, pf: f.periodFrom ?? null, pt: f.periodTo ?? null, src: evidenceId, mode: 'manual',
      }));
      const r = await assertFact({
        tenantId, customerId, contentKey,
        subject: anchor ?? `customer:${customerId}`, predicate: f.factKey, objectValue: f.value, unit: f.unit ?? null,
        statement: `人工录入（${enteredBy}）：${anchor ?? customerId} ${f.factKey} = ${f.value}（来源定位 ${f.location ?? '未定位'}；转录≠核验）`,
        fromObservations: [obs.observationId],
        fromArtifacts: [evidenceId], objectRef: anchor, periodFrom: f.periodFrom ?? null, periodTo: f.periodTo ?? null,
        sourceMode: 'real',
        entryMode: 'manual_entry', valueJson: f.value,
      });
      results.push({ factId: r.factId, existed: r.existed === true, conflicts: r.conflicts });
    }
    // 材料到位语义推进：该件的转人工问题 → material_received（录入完成；verified 仍须人工复核）
    await store.query(
      `UPDATE prepared_questions SET status='material_received',
         note=COALESCE(note,'') || ' | 人工录入完成（材料到位≠核验）', updated_at=now()
       WHERE tenant_id=$1 AND customer_id=$2 AND binding->>'questionId' = $3
         AND status IN ('needs_human','suggested','queued_outbound','outbound_paused','send_unknown','send_failed')`,
      [tenantId, customerId, `q-manual-${evidenceId}`],
    );
    // IR-03-8②：人工事实已变更 → 该件处理任务重入分析（从 analyze 续跑；事实状态为分析输入权威）
    const requeued = await requeueForAnalysis(tenantId, [evidenceId]);
    await audit(store, {
      tenantId, actor: enteredBy, action: 'FACTS_MANUAL_ENTERED', targetType: 'evidence', targetId: evidenceId,
      summary: `人工录入 ${facts.length} 项（转录≠核验；reason=${String(reason).slice(0, 80)}）`,
    });
    return { ok: true, observationId: obs.observationId, facts: results, note: '录入=转录（source_supported 语义，来源已留痕）；核验须另行由获准人员执行' };
  }


  /** IR-03-8②：人工事实（录入/更正/复核升级）变更后，把受影响材料的处理任务从终态重入分析。
   *  只重入 done/needs_followup（failed=确定性拒绝、blocked_unknown=等对账，各有语义不越权改写）；
   *  游标置 analyze：已 registered 的 A 操作经 a_links 状态零重复。 */
  async function requeueForAnalysis(tenantId, evidenceIds) {
    const ids = (Array.isArray(evidenceIds) ? evidenceIds : []).filter((x) => typeof x === 'string' && x);
    if (ids.length === 0) return { ok: true, requeued: 0 };
    const r = await store.query(
      `UPDATE processing_tasks SET status='queued', stage_cursor='analyze', leased_until=NULL, leased_by=NULL,
         note=COALESCE(note,'') || ' | 人工事实变更：重入分析（以现行事实状态为准）', updated_at=now()
       WHERE tenant_id=$1 AND evidence_id = ANY($2::text[]) AND status IN ('done','needs_followup') RETURNING task_id`,
      [tenantId, ids],
    );
    return { ok: true, requeued: r.rows.length };
  }

  async function correctFact({ tenantId, correctsFactId, fact }) {
    const orig = await store.query(`SELECT * FROM fact_assertions WHERE fact_id=$1 AND tenant_id=$2`, [correctsFactId, tenantId]);
    if (orig.rows.length === 0) throw new ConnError('NOT_FOUND', `fact ${correctsFactId}`);
    const created = await assertFact({ ...fact, tenantId, entryMode: 'correction', valueJson: fact.objectValue ?? fact.value });
    await store.query(
      `UPDATE fact_assertions SET status='superseded', superseded_by=$3 WHERE fact_id=$1 AND tenant_id=$2`,
      [correctsFactId, tenantId, created.factId],
    );
    await store.query(`UPDATE fact_assertions SET correction_of=$3 WHERE fact_id=$1 AND tenant_id=$2`, [created.factId, tenantId, correctsFactId]);
    await store.query(
      `UPDATE fact_conflicts SET state='resolved_by_correction' WHERE tenant_id=$1 AND (fact_a=$2 OR fact_b=$2)`,
      [tenantId, correctsFactId],
    );
    await audit(store, { tenantId, actor: 'evidence-service', action: 'FACT_CORRECTED', targetType: 'fact', targetId: created.factId, summary: `corrects=${correctsFactId}` });
    // IR-03-8②：更正改变现行事实状态 → 来源材料重入分析（新输入=新收口，不覆写历史）
    await requeueForAnalysis(tenantId, Array.isArray(orig.rows[0].from_artifacts) ? orig.rows[0].from_artifacts : []);
    return created;
  }

  async function listArtifacts({ tenantId, customerId }) {
    const r = await store.query(
      `SELECT * FROM evidence_artifacts WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at`,
      [tenantId, customerId],
    );
    return r.rows;
  }

  return { registerArtifact, verifyArtifact, evidenceCoverage, independentEvidenceCount, addObservation, assertFact, correctFact, manualEntry, requeueForAnalysis, listArtifacts, flagUntrustedContent };
}

export { sha256Hex };
