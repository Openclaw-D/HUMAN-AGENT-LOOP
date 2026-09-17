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
      const dup = await store.query(
        `SELECT evidence_id FROM evidence_artifacts WHERE tenant_id=$1 AND sha256=$2 AND evidence_id != $3 LIMIT 1`,
        [a.tenantId, a.sha256, evidenceId],
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
   *  任务02 · W10：事实可携带对象/期间锚定；不同对象/期间的同名事实不互相替代。 */
  async function assertFact(f) {
    if (!f.tenantId || !f.customerId || !f.subject || !f.predicate || f.objectValue == null) {
      throw new ConnError('INVALID_INPUT', 'assertFact: tenantId/customerId/subject/predicate/objectValue required');
    }
    const factId = newId('fact');
    const untrusted = flagUntrustedContent(f.objectValue) ;
    await store.query(
      `INSERT INTO fact_assertions (fact_id, tenant_id, customer_id, statement, subject, predicate, object_value, unit, from_observations, from_artifacts, source_mode, object_ref, period_from, period_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [factId, f.tenantId, f.customerId, f.statement ?? `${f.subject} ${f.predicate} = ${f.objectValue}`, f.subject, f.predicate, String(f.objectValue), f.unit ?? null,
       JSON.stringify(f.fromObservations ?? []), JSON.stringify(f.fromArtifacts ?? []), f.sourceMode ?? 'real',
       f.objectRef ?? null, f.periodFrom ?? null, f.periodTo ?? null],
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

  /** 显式更正：只有真正的更正关系才 supersede（I17/S4）。 */
  async function correctFact({ tenantId, correctsFactId, fact }) {
    const orig = await store.query(`SELECT * FROM fact_assertions WHERE fact_id=$1 AND tenant_id=$2`, [correctsFactId, tenantId]);
    if (orig.rows.length === 0) throw new ConnError('NOT_FOUND', `fact ${correctsFactId}`);
    const created = await assertFact({ ...fact, tenantId });
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
    return created;
  }

  async function listArtifacts({ tenantId, customerId }) {
    const r = await store.query(
      `SELECT * FROM evidence_artifacts WHERE tenant_id=$1 AND customer_id=$2 ORDER BY created_at`,
      [tenantId, customerId],
    );
    return r.rows;
  }

  return { registerArtifact, verifyArtifact, evidenceCoverage, independentEvidenceCount, addObservation, assertFact, correctFact, listArtifacts, flagUntrustedContent };
}

export { sha256Hex };
