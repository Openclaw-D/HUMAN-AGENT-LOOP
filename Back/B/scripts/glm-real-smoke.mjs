// GLM-5.2 真实出站冒烟脚本(E2 受控测试入口第一步)。
// 边界:
//   - 仅在 b-config.json transport.mode=real 时运行;apiKey 只在配置文件显式注入,
//     本脚本不读取 process.env、不接受命令行传 key(避免密钥进 shell 历史)。
//   - 请求内容仅合成演示(no-op 证据引用),不携带真实客户数据;响应按 glm.mjs
//     现有映射回 findings/questions,模型输出 authority=none 纪律不变。
//   - 预算/成本记账沿用 glm.mjs 自身记账面(reserve/actual、超限失败关闭);
//     账本落 gitignored 的 .tmp 专用文件,不写常驻 runtime 的 cost-ledger。
//   - 冒烟通过 ≠ 四域 E2 验收;E1 的 42 场景冻结集仍为确定性零模型,不受本脚本影响。
// 用法: node scripts/glm-real-smoke.mjs [--config ./config/b-config.json]
// 退出码: 0=succeeded;1=调用未成功(看 JSON 结果 error);2=配置不满足 real 出站条件。

import { fs } from '../src/deps.mjs';
import { createModelTransport, buildModelRequest } from '../src/transport/glm.mjs';
import { fileURLToPath } from 'node:url';

// 冒烟专用成本账本(启用预算必须有账本路径,否则预算门失败关闭):
// 放在 gitignored 的 .tmp 下,不污染常驻 runtime 状态;删除该文件即重置冒烟预算累计。
const smokeLedgerPath = fileURLToPath(new URL('../.tmp/glm-smoke-cost-ledger.jsonl', import.meta.url));
await fs.mkdir(fileURLToPath(new URL('../.tmp/', import.meta.url)), { recursive: true });

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') out.config = argv[++i];
  }
  return out;
}

function failConfig(code, messageZh) {
  console.error(JSON.stringify({ step: 'load-config', ok: false, code, messageZh }, null, 2));
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const configPath = args.config ?? fileURLToPath(new URL('../config/b-config.json', import.meta.url));

let config;
try {
  config = JSON.parse(await fs.readFile(configPath, 'utf8'));
} catch (e) {
  failConfig('CONFIG_UNREADABLE', `无法读取 ${configPath}:${e.message}。请从 b-config.example.json 复制为 b-config.json,设置 transport.mode="real" 并注入 real.apiKey(该文件已被 .gitignore 排除,不入 Git)。`);
}

const t = config.transport ?? {};
if (t.mode !== 'real') {
  failConfig('MODE_NOT_REAL', `transport.mode 当前为 ${JSON.stringify(t.mode ?? null)};真实出站冒烟要求显式 "real"(not_configured/mock 都不会发真实请求)。`);
}
if (!t.real?.endpoint || !t.real?.model) {
  failConfig('REAL_INCOMPLETE', 'transport.real 缺少 endpoint 或 model;两处都必须显式配置。');
}
if (!t.real?.apiKey) {
  failConfig('APIKEY_MISSING', 'transport.real.apiKey 未注入:留空即真实调用不可发,请在 b-config.json 显式填入(不从环境读取)。');
}
if (!config.budget || typeof config.budget.maxTotalCost !== 'number' || typeof config.budget.perCallEstimate !== 'number') {
  failConfig('BUDGET_REQUIRED', 'E2 真实出站必须显式配置顶层 budget(maxTotalCost/perCallEstimate,正有限数):缺省即失败关闭,不无预算打真实调用。');
}

const transport = createModelTransport({
  mode: t.mode,
  real: t.real,
  mock: t.mock,
  budget: config.budget ?? config.transport?.budget ?? null,
  costLogPath: smokeLedgerPath,
});

const { request, payloadHash } = buildModelRequest({
  runId: 'smoke-glm-real',
  stepId: 'connectivity',
  attempt: 1,
  role: 'credit',
  purpose: 'risk_review',
  projectId: 'demo-synthetic',
  goalId: null,
  goalLabel: '合成演示案例(冒烟)',
  factVersion: 'smoke-v1',
  evidenceRefs: [{ id: 'demo-synthetic-evidence-001', version: '1', hash: 'smoke' }],
});

const result = await transport.complete(request);

const summary = {
  step: 'complete',
  configFingerprint: transport.configFingerprint(),
  payloadHash,
  status: result.status,
  sentFlag: result.sentFlag,
  source: result.source ?? null,
  usage: result.usage ?? null,
  costEntries: transport.costSnapshot(),
  findings: (result.findings ?? []).map((f) => String(f.text).slice(0, 300)),
  questions: (result.questions ?? []).map((q) => String(q.text).slice(0, 300)),
  error: result.error ?? null,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(result.status === 'succeeded' ? 0 : 1);
