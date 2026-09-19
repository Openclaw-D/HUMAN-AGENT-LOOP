// GLM-5.2 密钥一键配置(交互式)。入口:双击根目录 Set-GLM-Key.cmd,或
//   node Back/B/scripts/setup-glm-key.mjs
// 行为:提示粘贴 API Key(回显打码)→ 写入 Back/B/config/b-config.json
//   (transport.mode=real + model=glm-5.2 + 出站白名单 + 预算;该文件已被
//   .gitignore 排除,密钥不入 Git)→ 自动打一次真实冒烟调用并显示结果。
// 边界:不读取环境变量里的密钥;Key 不回显、不写日志;失败原因经 glm.mjs 脱敏。
// 可选:--config <路径> 指定写入位置;--no-smoke 只写配置不打测试调用。

import { fs } from '../src/deps.mjs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const configIdx = args.indexOf('--config');
const configPath = configIdx >= 0
  ? path.resolve(process.cwd(), args[configIdx + 1])
  : fileURLToPath(new URL('../config/b-config.json', import.meta.url));
const examplePath = fileURLToPath(new URL('../config/b-config.example.json', import.meta.url));
const rootGitignore = fileURLToPath(new URL('../../../.gitignore', import.meta.url));
const smokePath = fileURLToPath(new URL('./glm-real-smoke.mjs', import.meta.url));

function fail(code, messageZh) {
  console.error(`\n[${code}] ${messageZh}`);
  process.exit(2);
}

// 密钥回显打码:prompt 正常显示,粘贴/键入内容一律显示为 *。
function askKey(rl) {
  const q = '请粘贴智谱 BigModel 的 API Key,然后回车: ';
  if (!process.stdout.isTTY) {
    return new Promise((resolve) => rl.question(q, resolve));
  }
  return new Promise((resolve) => {
    let muted = false;
    const orig = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => orig(muted ? '*'.repeat(Math.max(1, String(s).length)) : s);
    rl.question(q, (ans) => resolve(ans));
    muted = true;
  });
}

async function readJsonIfExists(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdout.isTTY });
const raw = await askKey(rl);
rl.close();

const key = String(raw ?? '').trim().replace(/^["']+|["']+$/g, '');
if (!key) fail('KEY_EMPTY', '没有输入 Key;请重新运行,粘贴完整 Key 后回车。');
if (/\s/.test(key)) fail('KEY_HAS_WHITESPACE', 'Key 里包含空格/换行,请只粘贴 Key 本体(一般形如 id.secret 一长串,无空格)。');

// 写入前护栏:确认仓库 .gitignore 仍排除 b-config.json,否则拒绝把密钥落盘。
const gitignore = await fs.readFile(rootGitignore, 'utf8');
if (!/b-config\.json/.test(gitignore)) {
  fail('GITIGNORE_GUARD', '仓库 .gitignore 未再排除 b-config.json;为避免密钥入 Git,已拒绝写入。请先恢复 .gitignore 的 **/b-config.json 规则。');
}

const existed = await readJsonIfExists(configPath);
const cfg = existed ?? JSON.parse(await fs.readFile(examplePath, 'utf8'));
cfg.transport = { ...(cfg.transport ?? {}) };
cfg.transport.mode = 'real';
cfg.transport.real = {
  ...(cfg.transport.real ?? {}),
  endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  model: 'glm-5.2',
  apiKey: key,
  timeoutMs: cfg.transport.real?.timeoutMs ?? 30000,
  outboundAllow: ['https://open.bigmodel.cn'],
  cost: cfg.transport.real?.cost ?? { per1kInput: null, per1kOutput: null, currency: 'CNY' },
};
for (const k of Object.keys(cfg.transport.real)) {
  if (k.startsWith('_')) delete cfg.transport.real[k];
}
cfg.budget = cfg.budget ?? { maxTotalCost: 0.5, perCallEstimate: 0.01, currency: 'CNY' };

await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
console.log(`\n✅ 已${existed ? '更新' : '创建'} ${configPath}`);
console.log('   (密钥已注入且不回显;该文件被 .gitignore 排除,不会进入 Git)');

if (args.includes('--no-smoke')) {
  console.log('\n完成:只写了配置,未打测试调用(--no-smoke)。');
  process.exit(0);
}

console.log('\n正在打一次真实测试调用(内容为合成演示,预算超限自动拦截)...\n');
const child = spawn(process.execPath, [smokePath, '--config', configPath], { stdio: 'inherit' });
const code = await new Promise((resolve) => child.on('exit', resolve));
if (code === 0) {
  console.log('\n✅ 真实调用成功:GLM-5.2 接入完成。用量/成本见上方 JSON。');
} else {
  console.log('\n❌ 真实调用未成功:常见原因是 Key 无效(401)、网络不通、预算或出站白名单拦截;具体看上方 JSON 的 error 字段。');
}
process.exit(code ?? 1);
