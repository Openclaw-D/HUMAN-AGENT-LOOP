// V7 backend-next Lane C · mock 服务独立启动入口。
// 用法：node scripts/start-mock.mjs [--port 3730] [--api-key <key>] [--seed <seed>] [--scenario <name>] [--latency-ms N]
// 纪律：--api-key 只来自启动参数（调用方自行输入），本脚本绝不读取环境变量密钥；key 仅以掩码回显。
import { createMockServer, DEFAULT_PORT, SCENARIOS } from '../src/mock-server.mjs';
import { maskSecret } from '../src/mock-redact.mjs';

function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const port = parseInt(argValue('port') ?? String(DEFAULT_PORT), 10);
const scenario = argValue('scenario');
if (scenario !== undefined && !SCENARIOS.includes(scenario)) {
  console.error(`[mock] 未知场景 ${scenario}；可选：${SCENARIOS.join(' | ')}`);
  process.exit(2);
}
const apiKey = argValue('api-key') ?? null;

const mock = createMockServer({
  port,
  apiKey,
  seed: argValue('seed') ?? 'jw-mock-night-20260916',
  defaultScenario: scenario ?? 'success',
  latencyMs: parseInt(argValue('latency-ms') ?? '0', 10) || 0,
});

const { port: actualPort, host } = await mock.listen();
console.log(`[mock] V7 backend-next Lane C 模拟模型 API 已启动（SIMULATION ONLY，不代表真实模型能力）`);
console.log(`[mock] 地址：http://${host}:${actualPort}/chat/completions   控制面：http://${host}:${actualPort}/__mock__/health`);
console.log(`[mock] 鉴权：${apiKey === null ? '未启用（loopback 测试默认）' : `启用（key=${maskSecret(apiKey)}）`}   PID=${process.pid}`);
process.on('SIGINT', () => {
  console.log('[mock] 收到 SIGINT，关闭…');
  mock.close().then(() => process.exit(0));
});
