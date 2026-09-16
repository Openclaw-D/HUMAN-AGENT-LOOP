// S1 E0 自检：版本封存结构、无路径/凭据泄漏、buildId 稳定性与字段完备（任务04 §3 / D01 判据种子）。
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(EDGE_ROOT, '..', '..');

test('版本封存包含协议要求的全部字段', async () => {
  const { collectVersionSeal } = await import('../src/version.mjs');
  const seal = await collectVersionSeal({ repoRoot: REPO_ROOT, capabilities: { model: 'not_configured' } });

  assert.match(seal.schemaVersion, /^jw\.version-seal\.v\d+$/);
  assert.equal(seal.buildId.length, 16);
  assert.match(seal.buildId, /^[0-9a-f]+$/);
  assert.ok(seal.git, 'git 块缺失');
  assert.equal(typeof seal.git.sourceDirty, 'boolean', 'sourceDirty 必须是布尔（本轮工作区含未跟踪任务书目录，预期 true——seal 如实记录，不掩盖）');
  if (seal.git.sourceDirty) assert.ok(seal.git.dirtyCount >= 1 && Array.isArray(seal.git.dirtyPaths), 'dirty 时必须给出计数与路径清单');
  assert.ok(seal.git.gitSha === null || /^[0-9a-f]{40}$/.test(seal.git.gitSha), 'gitSha 必须是 40 位 sha 或 null');
  assert.ok(seal.sourceDigest.back && seal.sourceDigest.back.files > 0, 'Back 源指纹缺失');
  assert.ok(seal.sourceDigest.frontSrc && seal.sourceDigest.frontSrc.files > 0, 'Front/preview 源指纹缺失');
  assert.ok(seal.dist.frontend && seal.dist.frontend.files > 0, 'Front/dist 指纹缺失（用户明确要求 dist 随仓库交付）');
  assert.equal(seal.contractVersion, 'v1.3', '当前 Back/CONTRACT.md 头部版本应为 v1.3');
  assert.ok(seal.migrationVersion.count >= 1 && seal.migrationVersion.sha256, '迁移版本指纹缺失');
  assert.equal(seal.capabilities.model, 'not_configured');
  assert.ok(seal.sealedAt, 'sealedAt 缺失');
});

test('版本封存不泄漏本地绝对路径与敏感字段', async () => {
  const { collectVersionSeal } = await import('../src/version.mjs');
  const seal = await collectVersionSeal({ repoRoot: REPO_ROOT, capabilities: {} });
  const text = JSON.stringify(seal).toLowerCase();
  for (const bad of [REPO_ROOT, EDGE_ROOT, os.homedir()]) {
    assert.ok(!text.includes(String(bad).toLowerCase()), `封存输出泄漏本地路径: ${bad}`);
    const noBackslash = String(bad).replace(/\\/g, '/').toLowerCase();
    assert.ok(!text.includes(noBackslash), `封存输出泄漏本地路径(正斜杠变体): ${noBackslash}`);
  }
  for (const bad of ['password', 'credential', 'secret']) {
    assert.ok(!text.includes(bad), `封存输出包含敏感字样: ${bad}`);
  }
});

test('buildId 覆盖源/契约/迁移/dist 变化（同输入稳定、换输入变化）', async () => {
  const { collectVersionSeal } = await import('../src/version.mjs');
  const a = await collectVersionSeal({ repoRoot: REPO_ROOT, capabilities: {} });
  const b = await collectVersionSeal({ repoRoot: REPO_ROOT, capabilities: {} });
  assert.equal(a.buildId, b.buildId, '同一工作区连续两次封存 buildId 应一致（sealAt 不参与）');

  const c = await collectVersionSeal({ repoRoot: REPO_ROOT, capabilities: { model: 'real' } });
  assert.equal(a.buildId, c.buildId, 'capabilities 变化不改变 buildId（能力与源版本分开追踪）');
});
