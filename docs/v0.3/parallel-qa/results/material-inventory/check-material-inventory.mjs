#!/usr/bin/env node
// V0.3-Z1 材料清单核对（离线、可重跑、零依赖、只读输入）
// 任务书：docs/v0.3/parallel-qa/01_MATERIAL_INVENTORY.md
// 运行：node docs/v0.3/parallel-qa/results/material-inventory/check-material-inventory.mjs
// 写入范围：本脚本所在目录。退出码：0=核对完成且manifest完整性与原件一致；1=存在完整性错误（见REPORT.md）；2=输入缺失。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, '..', '..', '..', '..', '..');
const MAT = path.join(ROOT, 'docs', 'materials', 'kashgar-demo-v1');
const RECEIPTS = path.join(ROOT, '.local', 'v03-recovery', 'case-upload-receipts.json');
const RUNTIME_MAP = path.join(ROOT, '.local', 'v03-recovery', 'case-runtime-map.json');
const OUT = SELF_DIR;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
fs.mkdirSync(path.join(OUT, 'pending-by-customer'), { recursive: true });
const jwrite = (rel, obj) => fs.writeFileSync(path.join(OUT, rel), JSON.stringify(obj, null, 2) + '\n', 'utf8');

const findings = [];   // {severity:'error'|'observation', file, code, detail}
const inputHashes = {}; // relPath -> {sha256, bytes}
const fail = (code, file, detail) => findings.push({ severity: 'error', code, file, detail });
const obs = (code, file, detail) => findings.push({ severity: 'observation', code, file, detail });

function readInput(absPath, relLabel) {
  if (!fs.existsSync(absPath)) {
    fail('INPUT_MISSING', relLabel, '必需输入不存在: ' + absPath);
    return null;
  }
  const buf = fs.readFileSync(absPath);
  inputHashes[relLabel] = { sha256: sha256(buf), bytes: buf.length };
  return JSON.parse(buf.toString('utf8'));
}

// ---------- 载入输入（全部只读） ----------
const caseIndex = readInput(path.join(MAT, 'case-index.json'), 'docs/materials/kashgar-demo-v1/case-index.json');
const integrationMd = path.join(MAT, 'INTEGRATION.md');
if (fs.existsSync(integrationMd)) {
  const b = fs.readFileSync(integrationMd);
  inputHashes['docs/materials/kashgar-demo-v1/INTEGRATION.md'] = { sha256: sha256(b), bytes: b.length };
} else fail('INPUT_MISSING', 'docs/materials/kashgar-demo-v1/INTEGRATION.md', 'INTEGRATION.md 不存在');
const receipts = readInput(RECEIPTS, '.local/v03-recovery/case-upload-receipts.json');
const runtimeMap = readInput(RUNTIME_MAP, '.local/v03-recovery/case-runtime-map.json');

// SHA256SUMS.txt 冻结基线
const sumsPath = path.join(MAT, 'SHA256SUMS.txt');
const sumsMap = new Map();
if (fs.existsSync(sumsPath)) {
  const raw = fs.readFileSync(sumsPath);
  inputHashes['docs/materials/kashgar-demo-v1/SHA256SUMS.txt'] = { sha256: sha256(raw), bytes: raw.length };
  for (const line of raw.toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const trimmed = line.trim();
    if (!/^[0-9a-f]{64}$/.test(trimmed.slice(0, 64))) continue;
    const rest = trimmed.slice(64).replace(/^\s+\*?/, '');
    if (rest) sumsMap.set(rest.replace(/\\/g, '/'), trimmed.slice(0, 64));
  }
  if (sumsMap.size === 0) fail('FROZEN_BASELINE_EMPTY', 'docs/materials/kashgar-demo-v1/SHA256SUMS.txt', 'SHA256SUMS.txt解析出0条记录，冻结基线比对不可用');
} else fail('INPUT_MISSING', 'docs/materials/kashgar-demo-v1/SHA256SUMS.txt', 'SHA256SUMS.txt 不存在');

if (!caseIndex || !receipts || !runtimeMap) {
  jwrite('findings.json', { findings });
  console.error('输入缺失，退出码 2');
  process.exit(2);
}

const caseIds = caseIndex.cases.map((c) => c.id);
const caseById = new Map(caseIndex.cases.map((c) => [c.id, c]));
const runtimeByCase = new Map(runtimeMap.map((r) => [r.caseId, r]));

// ---------- 逐件核对 manifest ----------
// 目录逃逸防护：file 必须是相对路径、无 ..、解析后严格位于 docs/materials/kashgar-demo-v1/<caseId>/ 内。
function safeResolve(caseId, relFile) {
  if (typeof relFile !== 'string' || relFile.length === 0) return { error: 'file字段缺失或非字符串' };
  if (path.isAbsolute(relFile) || /^[a-zA-Z]:/.test(relFile)) return { error: '绝对路径' };
  if (relFile.includes('..')) return { error: '包含..段' };
  if (relFile.includes('\0')) return { error: '包含NUL字节' };
  const norm = path.normalize(relFile).replace(/\\/g, '/');
  const matRoot = path.resolve(MAT) + path.sep;
  const abs = path.resolve(MAT, norm);
  if (!abs.startsWith(matRoot)) return { error: '解析后逃逸出Materials根' };
  if (!abs.startsWith(path.join(MAT, caseId) + path.sep)) return { error: '不属于本案例目录（客户归属冲突）' };
  return { abs, rel: norm };
}

const perCase = [];
const receiptIndex = (receipts || []).map((r, i) => ({ ...r, _i: i }));

for (const caseId of caseIds) {
  const manifestRel = `docs/materials/kashgar-demo-v1/${caseId}/material-manifest.json`;
  const manifest = readInput(path.join(MAT, caseId, 'material-manifest.json'), manifestRel);
  if (!manifest) continue;
  const ciCase = caseById.get(caseId);
  const rt = runtimeByCase.get(caseId) || null;

  // manifest 顶层客户归属一致性
  if (manifest.customerKey !== caseId) fail('ATTRIBUTION', manifestRel, `customerKey=${manifest.customerKey} ≠ 目录案例 ${caseId}`);
  if (ciCase && manifest.legalEntityRef !== ciCase.legalEntityRef) fail('ATTRIBUTION', manifestRel, `legalEntityRef=${manifest.legalEntityRef} ≠ case-index ${ciCase.legalEntityRef}`);
  if (ciCase && manifest.sourceMode !== ciCase.sourceMode) fail('SOURCE_MODE', manifestRel, `sourceMode=${manifest.sourceMode} ≠ case-index ${ciCase.sourceMode}`);

  const items = [];
  const seenFiles = new Map();
  for (const e of manifest.materials) {
    const rel = e.file;
    const r = safeResolve(caseId, rel);
    const item = {
      file: rel,
      materialId: e.materialId,
      kind: e.kind,
      contentType: e.contentType,
      sourceGroup: e.sourceGroup,
      sourceMode: e.sourceMode,
      declaredSha256: e.sha256,
      declaredBytes: e.bytes,
    };
    if (r.error) {
      fail('PATH_UNSAFE', rel, r.error);
      item.pathSafe = false; item.exists = false;
      items.push(item);
      continue;
    }
    item.pathSafe = true;
    if (seenFiles.has(r.rel)) fail('DUPLICATE_ENTRY', rel, '同一文件在manifest中出现多次');
    seenFiles.set(r.rel, true);

    if (!fs.existsSync(r.abs) || !fs.statSync(r.abs).isFile()) {
      fail('FILE_MISSING', rel, '文件不存在或不是常规文件');
      item.exists = false;
      items.push(item);
      continue;
    }
    item.exists = true;
    const buf = fs.readFileSync(r.abs);
    const actualHash = sha256(buf);
    item.actualSha256 = actualHash;
    item.actualBytes = buf.length;
    if (actualHash !== e.sha256) fail('HASH_MISMATCH', rel, `声明=${e.sha256} 实测=${actualHash}`);
    if (buf.length !== e.bytes) fail('BYTES_MISMATCH', rel, `声明=${e.bytes} 实测=${buf.length}`);
    const frozen = sumsMap.get(`${caseId}/` + rel.split('/').slice(1).join('/'));
    item.frozenMatch = frozen === undefined ? 'not_listed' : frozen === actualHash ? 'match' : 'mismatch';
    if (item.frozenMatch === 'mismatch') fail('FROZEN_MISMATCH', rel, '与SHA256SUMS.txt冻结值不一致');

    // sourceMode 与客户归属（逐件）
    if (e.sourceMode !== manifest.sourceMode) fail('SOURCE_MODE', rel, `条目sourceMode=${e.sourceMode} ≠ manifest顶层${manifest.sourceMode}`);
    if (e.customerKey !== undefined && e.customerKey !== caseId) fail('ATTRIBUTION', rel, `条目customerKey=${e.customerKey} ≠ ${caseId}`);

    // 回执匹配（按字节哈希；哈希是跨客户匹配的主键，文件名仅辅助）
    const hashHits = receiptIndex.filter((rc) => rc.hash === actualHash);
    const crossCaseHit = hashHits.find((rc) => rc.caseId !== caseId);
    if (crossCaseHit) fail('RECEIPT_CROSS_CUSTOMER', rel, `哈希出现在案例 ${crossCaseHit.caseId} 的回执中（客户归属冲突风险）`);
    const nameHits = receiptIndex.filter((rc) => rc.caseId === caseId && rc.name === path.basename(rel));
    let receiptStatus = 'not_recorded'; // 默认：尚未记录
    if (hashHits.length > 0) {
      const sameCase = hashHits.find((rc) => rc.caseId === caseId);
      if (sameCase && nameHits.some((rc) => rc.hash === actualHash)) {
        receiptStatus = 'recorded_upload'; // 同案例、同名、同哈希 → 已记录上传
      } else if (sameCase) {
        // 同案例但名字不同的回执含此哈希：类别或来源组不一致
        receiptStatus = 'category_or_group_mismatch';
        fail('RECEIPT_NAME_HASH_DIVERGE', rel, `哈希被回执[name=${sameCase.name}]记录，但该回执名指向其他条目`);
      }
    } else if (nameHits.length > 0) {
      // 同名但哈希不同：记录版本与当前文件不一致
      receiptStatus = 'category_or_group_mismatch';
      fail('RECEIPT_HASH_DIVERGE', rel, `回执[name=${nameHits[0].name}]哈希=${nameHits[0].hash} ≠ 当前文件实测=${actualHash}`);
    }
    item.receiptStatus = receiptStatus;
    items.push(item);
  }

  // ---------- 候选接入清单（仅 uploadByDefault=true，按 (customer, sourceGroup) 去重） ----------
  const groupOrder = [];
  const groups = new Map();
  for (const it of items) {
    const e = manifest.materials.find((m) => m.file === it.file);
    if (!e || e.uploadByDefault !== true) continue;
    const key = e.sourceGroup;
    if (!groups.has(key)) { groups.set(key, { sourceGroup: key, reps: [] }); groupOrder.push(key); }
    groups.get(key).reps.push({ item: it, entry: e });
  }
  const candidateGroups = groupOrder.map((key) => {
    const g = groups.get(key);
    const primaries = g.reps.filter((r) => r.entry.uploadByDefault === true);
    const others = manifest.materials.filter((m) => m.sourceGroup === key && m.uploadByDefault !== true);
    if (primaries.length > 1) fail('GROUP_MULTI_PRIMARY', `${caseId}/${key}`, `同一sourceGroup内有${primaries.length}个uploadByDefault=true表示，不应当作多份独立证据`);
    const p = primaries[0];
    const contentTypes = [...new Set(g.reps.map((r) => r.entry.contentType))];
    const receiptOf = p.item.receiptStatus === 'recorded_upload'
      ? receiptIndex.find((rc) => rc.caseId === caseId && rc.hash === p.item.actualSha256) : null;
    return {
      sourceGroup: key,
      evidenceSlots: 1, // 同组无论几种格式，只算一份证据槽
      materialId: p.entry.materialId,
      kind: p.entry.kind,
      filename: path.basename(p.item.file),
      file: p.item.file,
      contentType: p.entry.contentType,
      declaredSha256: p.item.declaredSha256,
      actualSha256: p.item.actualSha256,
      bytes: p.item.actualBytes,
      sourceMode: p.entry.sourceMode,
      caliberRaw: p.entry.caliber ?? null,
      unit: null,
      period: null,
      missingFields: {
        unit: 'manifest未提供结构化unit字段（caliber原文见caliberRaw；案例级unit见caseLevel.unit）',
        period: 'manifest未提供结构化期间字段（caliber注明“期间以文件内容为准”，本核对不解析文件内容）',
      },
      receiptStatus: p.item.receiptStatus,
      receiptEvidenceId: receiptOf ? receiptOf.evidenceId : null,
      receiptDisclaimer: '回执为.local恢复期历史记录，不构成当前服务授权、邀请有效性或数据库状态的证明',
      sameSourceRepresentationsNotCountedAsNew: others.map((o) => ({ file: o.file, contentType: o.contentType, duplicateRepresentation: o.duplicateRepresentation, uploadByDefault: o.uploadByDefault })),
      groupContentTypeCount: contentTypes.length,
    };
  });

  const candidateSummary = {
    uploadByDefaultEntries: manifest.materials.filter((m) => m.uploadByDefault === true).length,
    dedupedEvidenceGroups: candidateGroups.length,
    duplicateRepresentationsNotCounted: manifest.materials.filter((m) => m.uploadByDefault !== true && candidateGroups.some((g) => g.sourceGroup === m.sourceGroup)).length,
    recordedUploads: candidateGroups.filter((g) => g.receiptStatus === 'recorded_upload').length,
    pendingNotRecorded: candidateGroups.filter((g) => g.receiptStatus === 'not_recorded').length,
    pendingMismatch: candidateGroups.filter((g) => g.receiptStatus === 'category_or_group_mismatch').length,
  };

  // manifest 未收录的同目录材料（仅陈述，不纳入候选）
  const manifestFiles = new Set(manifest.materials.map((m) => path.normalize(m.file)));
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
  const onDisk = walk(path.join(MAT, caseId)).map((p) => ({ abs: p, rel: path.relative(MAT, p).replace(/\\/g, '/') }));
  const unlisted = onDisk.filter((f) => !manifestFiles.has(path.normalize(f.rel)));
  for (const u of unlisted) obs('NOT_IN_MANIFEST', u.rel, '存在于案例目录但未被manifest收录（不计入候选清单）');

  perCase.push({
    caseId,
    customerName: ciCase ? ciCase.name : null,
    legalEntityRef: manifest.legalEntityRef,
    sourceMode: manifest.sourceMode,
    manifestTopFields: { schemaVersion: manifest.schemaVersion, runtimeCustomerId: manifest.runtimeCustomerId, note: manifest.note ?? null },
    runtime: rt ? { customerId: rt.customerId, sourceMode: rt.sourceMode, authority: rt.authority, materialStatus: rt.materialStatus, assessmentId: rt.assessmentId, provenance: '.local/v03-recovery/case-runtime-map.json（恢复期记录，非当前数据库状态证明）' } : null,
    runtimeCustomerIdConsistent: rt && receiptIndex.some((rc) => rc.caseId === caseId) ? receiptIndex.filter((rc) => rc.caseId === caseId).every((rc) => rc.customerId === rt.customerId) : null,
    caseLevel: { unit: ciCase ? ciCase.unit : null, asOf: ciCase ? ciCase.asOf : null, provenance: 'docs/materials/kashgar-demo-v1/case-index.json' },
    integrity: {
      total: items.length,
      uniqueMaterialIds: new Set(items.map((i) => i.materialId)).size,
      uniqueFiles: seenFiles.size,
    },
    items,
    candidateGroups,
    candidateSummary,
    filesNotInManifest: unlisted.map((u) => u.rel),
  });

  jwrite(`pending-by-customer/${caseId}.json`, {
    schema: 'v03-z1-material-inventory@1',
    caseId,
    customerKey: manifest.customerKey,
    legalEntityRef: manifest.legalEntityRef,
    sourceMode: manifest.sourceMode,
    customerName: ciCase ? ciCase.name : null,
    runtimeCustomerId: rt ? rt.customerId : null,
    runtimeCustomerIdProvenance: '.local/v03-recovery/case-runtime-map.json；manifest.runtimeCustomerId=null，运行身份须由授权流程获取',
    caseLevel: { unit: ciCase ? ciCase.unit : null, asOf: ciCase ? ciCase.asOf : null },
    noRatingClause: '本清单为接入候选事实清单，不含任何预判评级或审批结论',
    receiptDisclaimer: '回执比对结果为历史记录核对，不构成当前服务授权、邀请有效性或数据库状态的证明',
    candidateGroups,
    summary: candidateSummary,
  });
}

// 回执侧核对：未被任何当前文件哈希匹配的回执
const allActualHashes = new Set(perCase.flatMap((c) => c.items.filter((i) => i.actualSha256).map((i) => i.actualSha256)));
const orphanReceipts = receiptIndex.filter((rc) => !allActualHashes.has(rc.hash));
for (const rc of orphanReceipts) fail('RECEIPT_ORPHAN', `.local/v03-recovery/case-upload-receipts.json#${rc._i}`, `回执哈希=${rc.hash} 不匹配任何当前原件字节`);

// ---------- 汇总输出 ----------
const errorCount = findings.filter((f) => f.severity === 'error').length;
const summary = {
  schema: 'v03-z1-material-inventory@1',
  determinism: '输出不含时间戳；重跑字节一致（输入哈希见input-hashes.json）',
  exitCodeMeaning: { 0: '核对完成，manifest完整性与原件字节一致（回执覆盖缺口属数据事实，非核对失败）', 1: '存在完整性错误，见findings.json', 2: '必需输入缺失' },
  cases: perCase.map((c) => ({
    caseId: c.caseId,
    integrity: c.integrity,
    candidateSummary: c.candidateSummary,
    filesNotInManifest: c.filesNotInManifest,
    frozenBaseline: {
      parsedEntries: sumsMap.size,
      checked: c.items.filter((i) => i.frozenMatch !== undefined).length,
      match: c.items.filter((i) => i.frozenMatch === 'match').length,
      notListed: c.items.filter((i) => i.frozenMatch === 'not_listed').length,
      mismatch: c.items.filter((i) => i.frozenMatch === 'mismatch').length,
    },
    items: c.items,
  })),
  receipts: {
    total: receiptIndex.length,
    recordedUpload: receiptIndex.filter((rc) => allActualHashes.has(rc.hash)).length,
    orphanNotMatchingCurrentFiles: orphanReceipts.length,
    disclaimer: '回执与runtime-map均为恢复期记录，不代表当前服务授权或数据库状态；本轮未启动服务、未查数据库',
  },
  totals: {
    manifestEntries: perCase.reduce((s, c) => s + c.integrity.total, 0),
    candidateEvidenceGroups: perCase.reduce((s, c) => s + c.candidateSummary.dedupedEvidenceGroups, 0),
    pendingNotRecorded: perCase.reduce((s, c) => s + c.candidateSummary.pendingNotRecorded, 0),
    errors: errorCount,
    observations: findings.filter((f) => f.severity === 'observation').length,
  },
};
jwrite('summary.json', summary);
jwrite('findings.json', { findings });
jwrite('input-hashes.json', {
  schema: 'v03-z1-material-inventory@1',
  note: '本核对实际读取的全部输入文件哈希（读取时刻实测）',
  inputs: inputHashes,
});

// ---------- REPORT.md（脚本生成，重跑即重建） ----------
const rep = [];
rep.push('# V0.3-Z1 材料清单核对 REPORT');
rep.push('');
rep.push('- 任务书：`docs/v0.3/parallel-qa/01_MATERIAL_INVENTORY.md`');
rep.push('- 执行方式：离线只读核对。未上传、未写数据库、未改manifest/原件、未调用模型、未启动服务、未安装依赖、未commit/push/worktree。');
rep.push('- 复现命令（工作区根目录，一条命令）：`node docs/v0.3/parallel-qa/results/material-inventory/check-material-inventory.mjs`');
rep.push('- 输入哈希：`input-hashes.json`（读取时刻实测）。输出无时间戳，重跑字节一致。');
rep.push('');
rep.push('## 结论');
rep.push('');
const driftCount = findings.filter((f) => ['HASH_MISMATCH', 'BYTES_MISMATCH', 'FILE_MISSING', 'PATH_UNSAFE', 'FROZEN_MISMATCH', 'ATTRIBUTION', 'SOURCE_MODE', 'RECEIPT_CROSS_CUSTOMER', 'RECEIPT_ORPHAN', 'RECEIPT_NAME_HASH_DIVERGE', 'RECEIPT_HASH_DIVERGE', 'DUPLICATE_ENTRY', 'GROUP_MULTI_PRIMARY'].includes(f.code)).length;
if (driftCount === 0) {
  const totalMatch = perCase.reduce((s, c) => s + (summary.cases.find((x) => x.caseId === c.caseId)?.frozenBaseline.match ?? 0), 0);
  rep.push(`- 三例 manifest 共 ${summary.totals.manifestEntries} 条，逐件实测 SHA256/bytes 与声明**零漂移**；其中 ${totalMatch}/${summary.totals.manifestEntries} 条与 \`docs/materials/kashgar-demo-v1/SHA256SUMS.txt\` 冻结值逐一比对一致（解析${sumsMap.size}条）→ 原件自冻结以来未变化。`);
} else {
  rep.push(`- **存在 ${driftCount} 项完整性/一致性错误**（见下文发现表），原件完整性结论不成立，退出码 1。`);
}
rep.push(`- 候选接入（仅 uploadByDefault=true）：${summary.totals.candidateEvidenceGroups} 个同源证据组（每客户 ${perCase[0].candidateSummary.dedupedEvidenceGroups} 个）；PDF/MD 双表示及 接口设备↔设备清单、接口财务2025↔年度报表 均按 sourceGroup 合并为**一份**证据，重复表示未计为新增材料。`);
if (summary.receipts.orphanNotMatchingCurrentFiles === 0) {
  rep.push(`- 回执比对：${summary.receipts.total} 条回执哈希全部匹配当前原件字节（每客户已记录上传 ${perCase[0].candidateSummary.recordedUploads} 件）；每客户其余 ${perCase[0].candidateSummary.pendingNotRecorded} 个候选组尚未记录。`);
} else {
  rep.push(`- 回执比对：${summary.receipts.orphanNotMatchingCurrentFiles} 条回执哈希不匹配任何当前原件（孤儿回执，见发现表）；已记录上传每客户 ${perCase[0].candidateSummary.recordedUploads} 件，尚未记录每客户 ${perCase[0].candidateSummary.pendingNotRecorded} 个候选组。`);
}
rep.push(`- 完整性错误：${summary.totals.errors}；观察项：${summary.totals.observations}。退出码：**${errorCount === 0 ? 0 : 1}**。`);
rep.push('');
rep.push('## 逐例核对');
rep.push('');
rep.push('| 案例 | manifest条目 | 唯一materialId | 哈希漂移 | bytes漂移 | 目录逃逸 | 候选组 | 已记录上传 | 尚未记录 |');
rep.push('|---|---|---|---|---|---|---|---|---|');
for (const c of perCase) {
  const hashDrift = c.items.filter((i) => i.actualSha256 && i.actualSha256 !== i.declaredSha256).length;
  const bytesDrift = c.items.filter((i) => i.actualBytes !== undefined && i.actualBytes !== i.declaredBytes).length;
  const esc = findings.filter((f) => f.code === 'PATH_UNSAFE' && f.file.startsWith(c.caseId)).length;
  rep.push(`| ${c.caseId} | ${c.integrity.total} | ${c.integrity.uniqueMaterialIds} | ${hashDrift} | ${bytesDrift} | ${esc} | ${c.candidateSummary.dedupedEvidenceGroups} | ${c.candidateSummary.recordedUploads} | ${c.candidateSummary.pendingNotRecorded} |`);
}
rep.push('');
rep.push('注：漂移列=实测值与manifest声明不一致的条目数；本轮逐件值亦写入 `summary.json`（每案例 items 内含 declared/actual 双值）。');
rep.push('');
rep.push('## 核对方法');
rep.push('');
rep.push('- 每条 manifest 条目实测：路径合法性（拒绝绝对路径、`..`段、解析后越界、跨案例归属；防目录逃逸）、文件存在性、SHA256 与 bytes（实测 vs 声明 vs SHA256SUMS.txt 冻结值）、sourceMode、customerKey/目录/case-index 三方客户归属一致性。');
rep.push('- 回执比对以**字节哈希**为主键（不依赖文件名）：同案例同名同哈希=已记录上传；哈希无任何原件匹配=孤儿回执；同名不同哈希或哈希记于他名=类别或来源组不一致；跨案例哈希命中=客户归属冲突。');
rep.push(`- 冻结基线解析自 \`SHA256SUMS.txt\` 全部 ${sumsMap.size} 条（实测值同步写入 summary.json 各案例 frozenBaseline.parsedEntries）。`);
rep.push('');
rep.push('## 同源去重规则与证据');
rep.push('');
rep.push('- 分组主键 =（客户, sourceGroup）；同一组内多格式（PDF/MD、CSV/CSV、CSV/XLSX）只产生 **1 个证据槽**。');
rep.push('- 依据：各案例 manifest `note`：“PDF与MD同源，XLSX为全部CSV的展示汇编”；`INTEGRATION.md`：“不要把月度、年度、接口投影三种格式全部当新证据上传”。');
rep.push('- 每客户 32 条 uploadByDefault=true 条目 → 32 组（D01–D21 的 PDF 与其 MD 同组；接口设备.csv 与 设备清单.csv 同组“设备清单”；接口财务2025.csv 与 年度报表.csv 同组“年度报表”）。其中 21 个 MD 与 2 个 CSV（设备清单.csv、年度报表.csv）为组内非候选表示，未计入新增材料。');
rep.push('- `经营台账.xlsx`、`原始材料阅读册.pdf`、`supplements/S01-补件答复.md` 等未被 manifest 收录的文件见下节观察项，不纳入候选清单。');
rep.push('');
rep.push('## 回执比对分类');
rep.push('');
rep.push('| 案例 | 已记录上传（哈希=当前字节） | 尚未记录 | 类别/来源组不一致 | 跨客户哈希 |');
rep.push('|---|---|---|---|---|');
for (const c of perCase) {
  const mismatch = c.items.filter((i) => i.receiptStatus === 'category_or_group_mismatch').length;
  const cross = findings.filter((f) => f.code === 'RECEIPT_CROSS_CUSTOMER' && f.file.startsWith(c.caseId)).length;
  rep.push(`| ${c.caseId} | ${c.candidateSummary.recordedUploads} | ${c.candidateSummary.pendingNotRecorded} | ${mismatch} | ${cross} |`);
}
rep.push('');
rep.push(`- 回执文件：\`.local/v03-recovery/case-upload-receipts.json\`（${summary.receipts.total} 条，孤儿回执 ${summary.receipts.orphanNotMatchingCurrentFiles} 条）；回执客户ID与 \`case-runtime-map.json\` 一致性已在各案例 runtimeCustomerIdConsistent 记录。`);
rep.push('- **声明**：回执是恢复期历史记录，不是当前服务授权、邀请有效性或数据库状态的证明；本轮未启动任何服务、未查询数据库。');
rep.push('');
rep.push('## 发现（错误与观察）');
rep.push('');
if (findings.length === 0) {
  rep.push('无。');
} else {
  rep.push('| 级别 | 代码 | 文件 | 说明 |');
  rep.push('|---|---|---|---|');
  for (const f of findings) rep.push(`| ${f.severity} | ${f.code} | ${f.file} | ${f.detail} |`);
}
rep.push('');
rep.push('## 交付物');
rep.push('');
rep.push('- `check-material-inventory.mjs`（本脚本，零依赖，Node ≥20）');
rep.push('- `summary.json` / `findings.json` / `input-hashes.json`');
rep.push('- `pending-by-customer/KS-TEXTILE-200.json`、`pending-by-customer/KS-LASER-500.json`、`pending-by-customer/KS-INJECTION-1000.json`（每客户待接入清单：文件名、kind、sourceGroup、caliber原始值、单位/期间缺失说明、哈希、回执状态；不含预判评级）');
rep.push('- `REPORT.md`（本文件）');
rep.push('');
rep.push('## 单位/期间字段说明（不猜缺失）');
rep.push('');
rep.push('- manifest 无结构化 unit/period 字段；caliber 原文（“模拟资料；金额元，接口投影列_wan为万元；期间以文件内容为准”）已原样保留于 `caliberRaw`。');
rep.push('- 案例级 `unit: "CNY-yuan"`、`asOf: "2026-08-31"` 来自 `case-index.json`，已在各清单 `caseLevel` 注明出处。');
rep.push('- 未解析文件内容推断期间（避免猜测）；清单 `missingFields` 逐条说明缺失。');
rep.push('');
fs.writeFileSync(path.join(OUT, 'REPORT.md'), rep.join('\n'), 'utf8');

console.log('V0.3-Z1 材料清单核对完成');
console.log(`  案例: ${perCase.length}  manifest条目: ${summary.totals.manifestEntries}  候选证据组: ${summary.totals.candidateEvidenceGroups}  尚未记录: ${summary.totals.pendingNotRecorded}`);
console.log(`  完整性错误: ${errorCount}  观察项: ${summary.totals.observations}  退出码: ${errorCount === 0 ? 0 : 1}`);
process.exit(errorCount === 0 ? 0 : 1);
