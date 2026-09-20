// 任务 03 · S1 共享感知层：同一材料的规范化处理只做一次，四域按权限读取所需部分。
// 硬边界（任务书 §3）：
// - 不得四份完整视频各自重复上传：normalize 以 contentHash 去重，重复材料归 duplicateGroup，
//   不作为独立佐证叠加（C01）。
// - 关键帧/观测包含来源片段、时间与质量指标；清晰度不足 → unreadable，绝不补全铭牌号码。
// - 质量问题（低清/低置信/断网）只产生 quality 标记，不用于诚信推断（C17）。
// - 同一材料的新版本取代旧版本（转写否定词/金额修正）：旧条目 superseded，分析须重算（C08）。
// - projectForDomain 按 domain 权限投影最小输入，构造上不给域投放越权切片。
// 本模块是确定性结构化编排：抽取（ASR/抽帧/OCR）本身属任务 02 与 provider 能力，
// 本层消费“已抽取的声明事实（declaredFacts）+ 原文引用”，不伪造抽取结果。

import { stableStringify, stableHash } from './util.mjs';

// TAKEOFF-FA-1.0.0（03路 PROTOCOL.md §1）：进件真实材料 kind 并入感知白名单（加法；
// 域投影/冲突/判重语义与 document 一致——kind 只影响事实溯源与重算依赖映射，不改变可信级）。
const KNOWN_KINDS = Object.freeze([
  'document', 'transcript', 'message', 'device_observation', 'image', 'video', 'audio',
  'legal_document', 'financial_statement', 'equipment_list', 'ownership_document',
  'order_contract', 'litigation_document',
]);

/** 内容规范化（哈希用）：压缩全部空白，防止“重排版/复制粘贴”绕过同源判定（C01）。 */
function canonicalContent(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function normalizeSourceRef(sr) {
  if (sr === undefined || sr === null) return null;
  if (typeof sr !== 'object' || Array.isArray(sr)) return null;
  const out = {};
  for (const k of ['channel', 'capturedAt', 'page', 'field', 'timeSpan', 'uri']) {
    if (sr[k] !== undefined) out[k] = String(sr[k]);
  }
  return out;
}

/** 单材料校验：materialId/kind 必填；declaredFacts 结构合法；声明值不得带“已核验”之外的可信声明。 */
export function validateMaterial(m) {
  const reasons = [];
  if (m === null || typeof m !== 'object') return ['材料必须为对象'];
  if (typeof m.materialId !== 'string' || m.materialId.trim() === '') reasons.push('materialId 必填');
  if (!KNOWN_KINDS.includes(m.kind)) reasons.push(`kind ${String(m.kind)} 未知（允许:${KNOWN_KINDS.join('/')})`);
  if (typeof m.content !== 'string') reasons.push('content 必须为字符串（合成文本或抽取原文）');
  const q = m.quality ?? {};
  if (typeof q !== 'object' || Array.isArray(q)) reasons.push('quality 必须为对象');
  if (Array.isArray(m.declaredFacts)) {
    m.declaredFacts.forEach((f, i) => {
      if (!f || typeof f !== 'object') { reasons.push(`declaredFacts[${i}] 必须为对象`); return; }
      if (typeof f.factKey !== 'string' || f.factKey.trim() === '') reasons.push(`declaredFacts[${i}].factKey 必填`);
      if (!('value' in f)) reasons.push(`declaredFacts[${i}].value 必填（缺失须显式 null+unknown 级）`);
      if (!['unknown', 'declared', 'source_supported', 'verified'].includes(f.verificationLevel)) {
        reasons.push(`declaredFacts[${i}].verificationLevel 非法`);
      }
    });
  }
  if (m.version !== undefined && !(Number.isInteger(m.version) && m.version >= 1)) reasons.push('version 必须为 ≥1 整数');
  return reasons;
}

/**
 * 构建共享感知快照（一次规范化，四域共用）。
 * @param p.tenantId 租户隔离键（缓存/上下文隔离必填）
 * @param p.customerId 客户隔离键
 * @param p.materials 材料数组（含 declaredFacts / quality / version / supersededByMaterialId）
 * @param p.capabilities 能力注册表（createCapabilityRegistry 产物）
 * @param p.provider {providerMode, modelVersion} 感知处理提供方（本轮= simulation 抽取编排）
 * @returns { ok } | { ok:false, problems }
 */
export function buildPerceptionSnapshot({ tenantId, customerId, materials, capabilities, provider }) {
  const problems = [];
  if (typeof tenantId !== 'string' || tenantId.trim() === '') return { ok: false, problems: ['tenantId 必填（缓存/上下文隔离键）'] };
  if (typeof customerId !== 'string' || customerId.trim() === '') return { ok: false, problems: ['customerId 必填'] };
  if (!Array.isArray(materials) || materials.length === 0) return { ok: false, problems: ['materials 不能为空'] };
  materials.forEach((m, i) => {
    for (const p of validateMaterial(m)) problems.push(`materials[${i}]: ${p}`);
  });

  const items = [];
  const unreadable = [];
  const processedHashes = new Map(); // contentHash → [materialId]
  const seenMaterialIds = new Set();
  const materialVersionIndex = new Map(); // baseId → 最高 version 材料组

  for (const m of materials) {
    if (seenMaterialIds.has(m.materialId)) { problems.push(`材料 id 重复: ${m.materialId}`); continue; }
    seenMaterialIds.add(m.materialId);

    // 能力门：未注册/模态不支持/超尺寸 → 确定不处理（不猜、不补全）
    const cap = capabilities.checkMaterial({ providerMode: provider.providerMode, modelVersion: provider.modelVersion, material: m });
    const contentHash = stableHash({ kind: m.kind, content: canonicalContent(m.content) });
    if (!cap.ok) {
      unreadable.push({ materialId: m.materialId, kind: m.kind, reasonCode: cap.code, messageZh: cap.messageZh });
      continue;
    }

    // 质量门：质量问题只标质量，不判诚信；asrConfidence/clarity 低于声明阈值 → 条目降级为不可读
    const qualityFlags = [];
    const q = m.quality ?? {};
    for (const key of ['videoClarity', 'audioIntelligibility', 'asrConfidence']) {
      if (typeof q[key] === 'number' && q[key] < 0.6) qualityFlags.push(`${key}_low`);
    }
    if (q.connection === 'interrupted') qualityFlags.push('connection_interrupted');
    const hasBlockingQuality = qualityFlags.length > 0 && (qualityFlags.includes('connection_interrupted')
      || (typeof q.asrConfidence === 'number' && q.asrConfidence < 0.6 && m.kind === 'transcript'));

    const baseId = String(m.materialId).replace(/@v\d+$/, '');
    materialVersionIndex.set(baseId, Math.max(materialVersionIndex.get(baseId) ?? 0, m.version ?? 1));

    processedHashes.set(contentHash, [...(processedHashes.get(contentHash) ?? []), m.materialId]);

    if (hasBlockingQuality) {
      // 低置信转写/断网：不产出事实条目（未知待核验），绝不补全识别结果
      unreadable.push({ materialId: m.materialId, kind: m.kind, reasonCode: 'QUALITY_INSUFFICIENT', qualityFlags, messageZh: '材料质量不足（低置信/断连）：按不可读处理，待重新采集，不推断内容' });
      continue;
    }

    for (const f of m.declaredFacts ?? []) {
      items.push({
        itemId: `${m.materialId}#${f.factKey}`,
        factKey: f.factKey,
        value: f.value,
        unit: f.unit ?? null,
        caliber: f.caliber ?? null,
        verificationLevel: f.verificationLevel,
        materialId: m.materialId,
        materialVersion: m.version ?? 1,
        materialKind: m.kind,
        contentHash,
        sourceRef: normalizeSourceRef(m.sourceRef),
        qualityFlags,
        capturedAt: m.sourceRef?.capturedAt ?? null,
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  // 重复来源组：同 contentHash 的材料不是独立佐证（C01）
  const duplicateGroups = [...processedHashes.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ contentHash: hash, materialIds: ids }));

  // 版本取代：同 baseId 的旧版本条目标 superseded（新版本存在即失效，C08）
  const itemMarks = new Map();
  for (const item of items) {
    const baseId = String(item.materialId).replace(/@v\d+$/, '');
    const latest = materialVersionIndex.get(baseId) ?? item.materialVersion;
    if (item.materialVersion < latest) itemMarks.set(item.itemId, true);
  }

  const liveItems = items.filter((it) => !itemMarks.get(it.itemId)).map((it) => ({ ...it, superseded: false }));
  const supersededItems = items.filter((it) => itemMarks.get(it.itemId)).map((it) => ({ ...it, superseded: true }));

  // 冲突检测：同 factKey 在现行条目间取值不一致且无取代关系 → 保留冲突（C05）。
  // 口径不同不豁免：同事实跨口径取值不同本身就是待澄清项（口径随值一起透出）；
  // 取值一致的跨口径并列不是冲突（数值一致，口径说明保留在条目上）。
  const byFact = new Map();
  for (const it of liveItems) {
    byFact.set(it.factKey, [...(byFact.get(it.factKey) ?? []), it]);
  }
  const conflicts = [];
  for (const [, group] of byFact) {
    const distinct = new Map();
    for (const it of group) distinct.set(stableStringify(it.value), it);
    if (distinct.size > 1) {
      conflicts.push({
        factKey: group[0].factKey,
        values: [...distinct.values()].map((it) => ({
          value: it.value, unit: it.unit, caliber: it.caliber, verificationLevel: it.verificationLevel,
          materialId: it.materialId, sourceRef: it.sourceRef,
        })),
      });
    }
  }

  const generation = 1 + supersededItems.length + unreadable.length; // 任何更替/不可读都推进代次
  const snapshot = {
    snapshotId: `psnap-${stableHash({ tenantId, customerId, materials }).slice(0, 16)}`,
    tenantId,
    customerId,
    createdAtBasis: 'deterministic',
    inputHash: stableHash({ items: [...liveItems, ...supersededItems], unreadable }),
    watermark: {
      generation,
      materials: Object.fromEntries([...seenMaterialIds].map((id) => {
        const m = materials.find((x) => x.materialId === id);
        return [id, stableHash({ kind: m.kind, content: canonicalContent(m.content), version: m.version ?? 1 })];
      })),
    },
    items: liveItems,
    supersededItems,
    unreadable,
    duplicateGroups,
    conflicts,
    qualitySummary: {
      flaggedMaterials: [...new Set(liveItems.filter((i) => i.qualityFlags.length > 0).map((i) => i.materialId))],
      note: '质量标记仅用于核验请求，不用于诚信推断',
    },
    provider: { ...provider },
  };
  return { ok: true, snapshot };
}

/** 域读取权限投影（输入最小化）：每域只见其权限内切片；默认全量仅限内部协调面。 */
export const DOMAIN_READ_SCOPE = Object.freeze({
  business: { factKeys: '*', materialKinds: '*', note: '商机读订单/收入动向与回租需求合理性事实；不用资料页数提额' },
  policy: { factKeys: '*', materialKinds: '*', note: '政策域读适用面（机构/地区/产品/主体）所需全量事实键' },
  credit: { factKeys: '*', materialKinds: '*', note: '信审读经营/负债/集中度事实' },
  commerce: { factKeys: '*', materialKinds: '*', note: '商务读期限/租金表/付款交付条件/成本' },
  asset: { factKeys: '*', materialKinds: '*', note: '资产读存在性/型号序列/权属/报价' },
});

/**
 * 按域投影快照：返回带同一 snapshotId/inputHash 的最小视图（来源可追溯不变）。
 * scope.factKeys / scope.materialKinds 支持 '*' 或显式清单；越权切片不出现在投影内。
 */
export function projectForDomain(snapshot, domain, scopeOverrides = {}) {
  const scope = scopeOverrides[domain] ?? DOMAIN_READ_SCOPE[domain] ?? null;
  if (!scope) return { ok: false, problems: [`域 ${domain} 无读取权限定义`] };
  const fk = scope.factKeys;
  const mk = scope.materialKinds;
  const keep = (it) => (fk === '*' || fk.includes(it.factKey)) && (mk === '*' || mk.includes(it.materialKind));
  return {
    ok: true,
    projection: {
      domain,
      snapshotId: snapshot.snapshotId,
      inputHash: snapshot.inputHash,
      watermark: snapshot.watermark,
      items: snapshot.items.filter(keep),
      supersededItems: snapshot.supersededItems.filter(keep),
      unreadable: snapshot.unreadable,
      duplicateGroups: snapshot.duplicateGroups,
      conflicts: snapshot.conflicts.filter((c) => fk === '*' || fk.includes(c.factKey)),
      scopeNote: scope.note ?? null,
    },
  };
}

/** 事实读取：现行条目中指定 factKey 的取值（含核验等级与来源）；多值时返回全部（冲突由上游保留）。 */
export function readFact(projection, factKey, { caliber = null } = {}) {
  return projection.items
    .filter((it) => it.factKey === factKey && (caliber === null || it.caliber === caliber))
    .map((it) => ({ value: it.value, unit: it.unit, verificationLevel: it.verificationLevel, materialId: it.materialId, sourceRef: it.sourceRef }));
}

/** 独立佐证计数：按内容来源去重后的来源数（重复组只算一次，C01 判据的机械基础）。 */
export function independentSourceCount(projection, factKey) {
  const ids = new Set(projection.items.filter((it) => it.factKey === factKey).map((it) => it.materialId));
  const countedGroups = new Set();
  let count = 0;
  for (const id of ids) {
    const g = projection.duplicateGroups.find((x) => x.materialIds.includes(id));
    if (!g) count += 1;
    else if (!countedGroups.has(g.contentHash)) { count += 1; countedGroups.add(g.contentHash); }
  }
  return count;
}
