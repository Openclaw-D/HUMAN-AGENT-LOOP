#!/usr/bin/env node
// 生成 MANIFEST.json:交付目录内文件相对路径 + SHA256 + 可复现命令 + 接口版本 + 已知限制。
// R2(INTERFACE_R2 §4):测试运行时可变产物目录 runtime/ 整棵递归不入清单;
// tools/gen-manifest.mjs 与 MANIFEST.json 自身不入清单;其余文件全部入清单。
// 配套核验:node tools/verify-frozen-hash.mjs(逐文件重算 SHA256,退出码 0=全部匹配)。
// 用法:node tools/gen-manifest.mjs(只读遍历交付文件,不修改它们)
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 排除规则:相对路径精确匹配;目录命中则整棵递归排除。
const EXCLUDED_FILES = new Set([
  'MANIFEST.json',        // 清单自身(无法包含自身 hash)
  'tools/gen-manifest.mjs', // 生成器自身
]);
const EXCLUDED_DIRS = new Set([
  'runtime', // 测试运行时可变产物(mutant 文件/adversarial-results.json/运行汇总):复跑测试不得影响清单
]);

function walk(dir, base = root) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, name.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (name.isDirectory()) {
      if (EXCLUDED_DIRS.has(rel)) continue;
      out.push(...walk(full, base));
    } else if (name.isFile()) {
      if (EXCLUDED_FILES.has(rel)) continue;
      const buf = readFileSync(full);
      const sha = createHash('sha256').update(buf).digest('hex');
      out.push({ path: rel, sha256: sha, bytes: buf.length });
    }
  }
  return out;
}

const files = walk(root);
const manifest = {
  batch: 'R2_MODEL_20260913',
  status: 'READY_FOR_REVIEW',
  frozenAt: new Date().toISOString(),
  contractVersion: 'v1',
  protocol: 'jianwei.dd.analyze/v1',
  runtime: { node: process.version, platform: process.platform, dependencies: 'none (Node built-ins only)' },
  reproduce: {
    testCommand: 'node test/run-all.mjs',
    expected: '全部测试通过;复跑测试只写 runtime/(或 R2_MODEL_TEST_OUT_DIR),不改本清单内任何文件;无网络、无端口、零真实模型调用',
    evidenceFiles: [
      'runtime/<运行目录>/adversarial-results.json(mutation 捕获 M/7 报告,运行时可变产物,不入本清单)',
      'runtime/<运行目录>/mutants/(变异样本文件,运行时可变产物,不入本清单)',
      'runtime/<运行目录>/last-run-summary.txt(最近一次全量运行汇总)',
    ],
  },
  entryPoints: {
    factory: 'src/adapter.mjs # createModelAdapter / createProviderTransport',
    simulation: 'src/simulated.mjs # createSimulatedTransport',
    providers: ['src/providers/http-json.mjs', 'src/providers/dify-workflow.mjs'],
    fixtures: 'src/fixtures/provider-fixtures.mjs (redacted, synthetic)',
    frozenCheck: 'tools/verify-frozen-hash.mjs # 冻结 hash 核验(退出码 0=全部匹配)',
  },
  knownLimits: [
    'quality/金融准确率 NOT TESTED(本模块只验证协议与边界)',
    '真实 OpenAI 形状网关与真实 Dify 1.13.x 实例端到端兼容 NOT TESTED(仅官方文档格式映射+fixture)',
    '持久化幂等与跨进程恰好一次不在本模块保证范围(业务层负责持久记录)',
    '文本脱敏/允许出境判定为业务层职责,本模块透传',
    '越权批准词表为启发式护栏,非完备;最终防线为产品层 authority=none',
    '本轮真实模型请求数为 0;未使用任何真实凭据',
    '测试运行时可变输出只写 runtime/(或 R2_MODEL_TEST_OUT_DIR),不入本清单;核验用 tools/verify-frozen-hash.mjs',
  ],
  secrets: 'none — 本清单与全部文件不含真实密钥/凭据/客户数据',
  files,
};

writeFileSync(path.join(root, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`MANIFEST.json written: ${files.length} files`);
for (const f of files) console.log(`  ${f.sha256.slice(0, 12)}…  ${f.path}`);
