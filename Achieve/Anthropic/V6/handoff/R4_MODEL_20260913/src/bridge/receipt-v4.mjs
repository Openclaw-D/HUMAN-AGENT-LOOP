// R4 集成回执(R4_INTEGRATION_RECEIPT@1):修复 R3 回执"凭五个自填 boolean 判 integrated"的弱点。
// 判定原则:checks 不再由调用方自填,而是由本模块**机器核对**——
//  1) 代码 hash:回执引用的产品桥/候选/服务三份代码 SHA256 必须与 verify 时点实际文件一致;
//  2) 运行包引用:必须携带 MAIN integration-inputs 的编号与包内清单 hash(由 MAIN 交付),
//     且回执的 mainPackageHashes 逐条出现在该清单中;
//  3) 运行证据:必须引用一次 MAIN 实际运行的结果摘要(status/requestId/时间)。
// hash 不匹配/缺引用 → 永远 candidate,不得标 integrated。
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const RECEIPT_SCHEMA_V4 = 'R4_INTEGRATION_RECEIPT@1';

const STATUS_SET = new Set(['not_configured', 'simulated', 'succeeded', 'failed', 'unknown', 'stale', 'cancelled']);

/** 相对 site 根的三个关键代码文件(接线审查对象)。 */
export const CODE_FILES = Object.freeze([
  'lib/v5-preview/remote-model-adapter-bridge.ts',
  'lib/v5-preview/remote-service.ts',
  'lib/v5-preview/model-adapter/adapter.mjs',
]);

/** 计算产品代码 hash(只读)。返回 { file: sha256 } 映射;文件缺失 → { file: null }。 */
export function computeCodeHashes(siteRoot) {
  const out = {};
  for (const rel of CODE_FILES) {
    const full = path.join(siteRoot, rel);
    out[rel] = existsSync(full) ? createHash('sha256').update(readFileSync(full)).digest('hex') : null;
  }
  return out;
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * 构建集成回执(MAIN 运行后填写;A 路判定)。
 * 输入:
 *   integrationInputId : MAIN 的 integration-inputs 编号(如 'INPUT-20260913-01';必填)
 *   inputManifest      : 该编号包内清单(含各文件 hash;来自 MAIN 交付,必填数组,元素含 path/hash)
 *   runEvidence        : 一次 MAIN 实际运行证据 { entry:'simulateFollowUps', requestId, at, outcomeStatus }
 *   siteRoot           : 产品 site 根(用于现算代码 hash——判定时点的事实,不由调用方自填)
 */
export function buildIntegrationReceipt({ integrationInputId, inputManifest, runEvidence, siteRoot } = {}) {
  if (typeof integrationInputId !== 'string' || integrationInputId.length === 0) {
    throw new TypeError('回执必须引用 MAIN 的 integration-inputs 编号');
  }
  if (!Array.isArray(inputManifest) || inputManifest.length === 0) {
    throw new TypeError('回执必须携带 MAIN 输入包清单(inputManifest)');
  }
  if (!runEvidence || typeof runEvidence.entry !== 'string' || !STATUS_SET.has(runEvidence.outcomeStatus)) {
    throw new TypeError('回执必须携带一次 MAIN 实际运行证据(entry + 七状态 outcomeStatus)');
  }
  const codeHashes = computeCodeHashes(siteRoot);
  return Object.freeze({
    schema: RECEIPT_SCHEMA_V4,
    generatedAt: null, // 调用方可经 build 时传入;模块自身不取系统时间
    integrationInput: { id: integrationInputId, manifest: inputManifest.map((m) => ({ path: m.path, hash: m.hash })) },
    codeHashes, // 判定时点现算,非自填
    runEvidence: {
      entry: runEvidence.entry,
      requestId: runEvidence.requestId ?? null,
      outcomeStatus: runEvidence.outcomeStatus,
      at: runEvidence.at ?? null,
    },
  });
}

/**
 * 判定回执是否达到 integrated(A 路执行;机器核对,无自填布尔)。
 * 判定基准**不采信回执内嵌 codeHashes**:必须提供 siteRoot(判定时点现算)
 * 或冻结时点的 expectCodeHashes;两者皆缺 → 拒绝(防止自填 hash 绕过)。
 */
export function judgeIntegrationReceipt(receipt, { siteRoot, expectCodeHashes } = {}) {
  if (!receipt || receipt.schema !== RECEIPT_SCHEMA_V4) {
    return { ok: false, reason: `schema 必须是 ${RECEIPT_SCHEMA_V4}` };
  }
  const expect = expectCodeHashes ?? (siteRoot ? computeCodeHashes(siteRoot) : null);
  if (!expect) {
    return { ok: false, reason: '判定必须提供 siteRoot(现算代码 hash)或冻结时点 expectCodeHashes;不采信回执自填 hash' };
  }
  if (!receipt.integrationInput || typeof receipt.integrationInput.id !== 'string') {
    return { ok: false, reason: '缺少 integration-inputs 编号引用' };
  }
  if (!Array.isArray(receipt.integrationInput.manifest) || receipt.integrationInput.manifest.length === 0) {
    return { ok: false, reason: '缺少 MAIN 输入包清单' };
  }
  for (const [file, want] of Object.entries(expect)) {
    if (!want) return { ok: false, reason: `代码文件缺失或未纳入 hash:${file}` };
    if (receipt.codeHashes?.[file] !== want) return { ok: false, reason: `代码 hash 不匹配(接线代码已变动或回执被篡改):${file}` };
  }
  if (!receipt.runEvidence || !STATUS_SET.has(receipt.runEvidence.outcomeStatus)) {
    return { ok: false, reason: '缺少合法的 MAIN 运行证据' };
  }
  return { ok: true, integrated: true };
}
