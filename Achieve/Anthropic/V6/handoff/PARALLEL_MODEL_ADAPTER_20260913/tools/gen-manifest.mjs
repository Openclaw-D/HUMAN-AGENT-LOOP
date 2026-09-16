#!/usr/bin/env node
// 生成 MANIFEST.json:交付目录内文件相对路径 + SHA256 + 可复现命令 + 接口版本 + 已知限制。
// 用法:node tools/gen-manifest.mjs(只读遍历,不修改交付文件)
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, base = root) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) {
      out.push(...walk(full, base));
    } else if (name.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (rel === 'MANIFEST.json' || rel === 'tools/gen-manifest.mjs') continue;
      const buf = readFileSync(full);
      const sha = createHash('sha256').update(buf).digest('hex');
      out.push({ path: rel, sha256: sha, bytes: buf.length });
    }
  }
  return out;
}

const files = walk(root);
const manifest = {
  batch: 'PARALLEL_MODEL_ADAPTER_20260913',
  status: 'READY_FOR_REVIEW',
  frozenAt: new Date().toISOString(),
  contractVersion: 'v1',
  protocol: 'jianwei.dd.analyze/v1',
  runtime: { node: process.version, platform: process.platform, dependencies: 'none (Node built-ins only)' },
  reproduce: {
    testCommand: 'node test/run-all.mjs',
    expected: '91/91 pass; ~0.3s; no network, no ports, zero real model calls',
    evidenceFiles: ['evidence/test-run-full.txt', 'evidence/adversarial-results.json', 'evidence/mutants/'],
  },
  entryPoints: {
    factory: 'src/adapter.mjs # createModelAdapter / createProviderTransport',
    simulation: 'src/simulated.mjs # createSimulatedTransport',
    providers: ['src/providers/http-json.mjs', 'src/providers/dify-workflow.mjs'],
    fixtures: 'src/fixtures/provider-fixtures.mjs (redacted, synthetic)',
  },
  knownLimits: [
    'quality/金融准确率 NOT TESTED(本模块只验证协议与边界)',
    '真实 OpenAI 形状网关与真实 Dify 1.13.x 实例端到端兼容 NOT TESTED(仅官方文档格式映射+fixture)',
    '持久化幂等与跨进程恰好一次不在本模块保证范围(业务层负责持久记录)',
    '文本脱敏/允许出境判定为业务层职责,本模块透传',
    '越权批准词表为启发式护栏,非完备;最终防线为产品层 authority=none',
    '本轮真实模型请求数为 0;未使用任何真实凭据',
  ],
  secrets: 'none — 本清单与全部文件不含真实密钥/凭据/客户数据',
  files,
};

writeFileSync(path.join(root, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`MANIFEST.json written: ${files.length} files`);
for (const f of files) console.log(`  ${f.sha256.slice(0, 12)}…  ${f.path}`);
