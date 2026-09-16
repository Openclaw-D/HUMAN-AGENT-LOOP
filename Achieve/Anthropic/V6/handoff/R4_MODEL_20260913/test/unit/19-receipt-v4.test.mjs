// R4 集成回执测试:机器核对(hash)而非自填布尔;candidate 与 integrated 分离。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const SITE = path.resolve(root, '..', '..', '..', 'jianwei-v3', 'site');

const { buildIntegrationReceipt, judgeIntegrationReceipt, computeCodeHashes, RECEIPT_SCHEMA_V4 } = await import(
  pathToFileURL(path.join(root, 'src', 'bridge', 'receipt-v4.mjs')).href
);

const MANIFEST = [
  { path: 'evidence/iso-dev-3451.log', hash: 'aaa' },
  { path: 'trajectories/r4-trajectory-run.json', hash: 'bbb' },
];

test('合法回执:hash 与现文件一致 → integrated', () => {
  const receipt = buildIntegrationReceipt({
    integrationInputId: 'INPUT-20260913-01',
    inputManifest: MANIFEST,
    runEvidence: { entry: 'simulateFollowUps', requestId: 'req-svc-r4-001', outcomeStatus: 'simulated', at: '2026-09-13T16:00:00+08:00' },
    siteRoot: SITE,
  });
  assert.equal(receipt.schema, RECEIPT_SCHEMA_V4);
  const j = judgeIntegrationReceipt(receipt, { siteRoot: SITE });
  assert.equal(j.ok, true, JSON.stringify(j));
  assert.equal(j.integrated, true);
});

test('接线代码变动 → 回执失效(判定方现算,不采信回执自填 hash)', () => {
  const receipt = buildIntegrationReceipt({
    integrationInputId: 'INPUT-20260913-01', inputManifest: MANIFEST,
    runEvidence: { entry: 'simulateFollowUps', requestId: 'r', outcomeStatus: 'simulated' }, siteRoot: SITE,
  });
  const tampered = { ...receipt, codeHashes: { ...receipt.codeHashes, 'lib/v5-preview/remote-model-adapter-bridge.ts': 'stale-hash' } };
  const j = judgeIntegrationReceipt(tampered, { siteRoot: SITE }); // 判定方现算
  assert.equal(j.ok, false);
  assert.ok(j.reason.includes('hash 不匹配'));
  const jFrozen = judgeIntegrationReceipt(receipt, { expectCodeHashes: { ...receipt.codeHashes, 'lib/v5-preview/remote-model-adapter-bridge.ts': 'frozen-old' } });
  assert.equal(jFrozen.ok, false, '冻结时点 hash 不一致同样拒绝');
  // 两者皆缺 → 拒绝(防自填绕过)
  const jNoBase = judgeIntegrationReceipt(receipt, {});
  assert.equal(jNoBase.ok, false);
  assert.ok(jNoBase.reason.includes('不采信'));
});

test('缺 integration-inputs 编号 / 缺清单 / 运行状态非法 → 拒绝', () => {
  assert.throws(() => buildIntegrationReceipt({ inputManifest: MANIFEST, runEvidence: { entry: 'e', outcomeStatus: 'simulated' }, siteRoot: SITE }), /编号/);
  assert.throws(() => buildIntegrationReceipt({ integrationInputId: 'X', inputManifest: [], runEvidence: { entry: 'e', outcomeStatus: 'simulated' }, siteRoot: SITE }), /清单/);
  assert.throws(() => buildIntegrationReceipt({ integrationInputId: 'X', inputManifest: MANIFEST, runEvidence: { entry: 'e', outcomeStatus: 'totally-fake' }, siteRoot: SITE }), /七状态/);
});

test('代码 hash 现算(非自填):computeCodeHashes 对产品树三文件产出 sha256', () => {
  const h = computeCodeHashes(SITE);
  assert.equal(Object.keys(h).length, 3);
  for (const [file, v] of Object.entries(h)) {
    assert.ok(v && /^[0-9a-f]{64}$/.test(v), `${file} hash 非法`);
    const expect = createHash('sha256').update(readFileSync(path.join(SITE, file))).digest('hex');
    assert.equal(v, expect);
  }
});
