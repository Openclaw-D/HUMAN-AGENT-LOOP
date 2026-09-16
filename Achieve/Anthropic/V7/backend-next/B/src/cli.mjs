#!/usr/bin/env node
// V7 backend-next B CLI:人以 API/CLI 测试客户端介入(不模拟前端点击)。
// 子命令:
//   worker                    恢复扫描后启动 worker 主循环(Ctrl-C 停)
//   recover                   只做崩溃恢复扫描(recover+对账+续跑+补提交),不进主循环
//   view <taskRunId>          查看运行视图(投影)
//   resume <taskRunId> <action> [--step <id>] [--note <n>] [--evidence <json>]
//                             人工恢复(D-9:从 B_RESUME_CREDENTIAL 环境变量读凭据,
//                             只进本次调用,不落盘不回显)
//   seed-demo                 向契约 stub 灌入演示目标/任务(合成数据)
//   status                    输出 transport/路由/契约指纹(不含密钥)
// 用法: node src/cli.mjs <cmd> ... [--data-dir ./runtime] [--config ./config/b-config.json]

import { fs } from './deps.mjs';
import { fileURLToPath } from 'node:url';
import { createBRuntime } from './runtime.mjs';
import { redactText } from './redact.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { args[key] = true; continue; }
      args[key] = next;
      i++;
    } else args._.push(a);
  }
  return args;
}

async function loadConfig(configPath) {
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const dataDir = args['data-dir'] ?? fileURLToPath(new URL('../runtime/', import.meta.url));
  const configPath = args.config ?? fileURLToPath(new URL('../config/b-config.json', import.meta.url));
  const config = await loadConfig(configPath);
  // 常驻进程可观测性:worker/编排日志走 stdout(重定向到文件即得运行日志;内容经 redact)
  const rt = createBRuntime({ dataDir, config, overrides: { logger: (m) => log(m) } });
  const log = (m) => console.log(redactText(typeof m === 'string' ? m : JSON.stringify(m)));

  switch (cmd) {
    case 'worker': {
      const recovered = await rt.worker.recoverAll();
      if (recovered.length) log(`恢复扫描:${JSON.stringify(recovered.map((r) => ({ taskRunId: r.taskRunId, settled: r.settled ?? r.error })))}`);
      await rt.worker.startLoop();
      const stop = async () => {
        log('停止中…');
        await rt.worker.stopLoop();
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      setInterval(() => {}, 1 << 30); // keep alive
      break;
    }
    case 'recover': {
      const recovered = await rt.worker.recoverAll();
      log(`恢复扫描结果:${JSON.stringify(recovered, null, 2)}`);
      break;
    }
    case 'view': {
      const view = await rt.orchestrator.view(args._[1]);
      log(view ? JSON.stringify(view, null, 2) : `运行 ${args._[1]} 不存在`);
      break;
    }
    case 'cancel': {
      // 跨进程取消:写标志文件,常驻 worker 下一 tick 消费(步边界生效:
      // 未发送→cancelled;已有发送意图无回执→unknown)。参数接受 taskRunId 或 goalId。
      const target = args._[1];
      if (!target) { log('用法: cancel <taskRunId|goalId> [--reason 文本]'); process.exitCode = 2; break; }
      const goalId = target.includes(':') ? target.split(':')[1] : target;
      await fs.mkdir(`${dataDir}/cancellations`, { recursive: true });
      await fs.writeFile(`${dataDir}/cancellations/${encodeURIComponent(goalId)}.flag`, new Date().toISOString(), 'utf8');
      log(`取消标志已写入:${dataDir}/cancellations/${goalId}.flag(常驻 worker 下一轮询消费;reason=${args.reason ?? '人工取消'})`);
      break;
    }
    case 'resume': {
      const [, taskRunId, action] = args._;
      // 凭据只从环境变量进入内存,不落盘、不回显、不进日志(redact 双保险)
      const credential = process.env.B_RESUME_CREDENTIAL;
      const payload = {};
      if (args.note) payload.note = args.note;
      if (args.evidence) payload.newEvidenceRefs = JSON.parse(args.evidence);
      if (args['new-fact-version']) payload.newFactVersion = args['new-fact-version'];
      try {
        const view = await rt.orchestrator.resume(taskRunId, {
          principalCredential: credential, action, stepId: args.step ?? null, payload,
        });
        log(JSON.stringify(view, null, 2));
        // DEF-03:授权重试在图内完成后,把终局收口回 A(恰一次新提交;fencing 过期自动重领)
        if (view.terminal && !args['no-settle']) {
          const { settleAfterResume } = await import('./worker/worker.mjs');
          const s = await settleAfterResume({
            contract: rt.contract, registryDir: `${dataDir}/worker`, taskRunId, view, logger: (m) => log(m),
          });
          log(`A 收口:${s.settled}${s.guidance ? `\n指引:${s.guidance}` : ''}`);
          if (!['submitted', 'submitted-replayed', 'still-running'].includes(s.settled)) process.exitCode = 2;
        }
      } catch (e) {
        log(`resume 被拒绝:${e.code ?? ''} ${redactText(e.message)}`);
        process.exitCode = 2;
      }
      break;
    }
    case 'seed-demo': {
      if (rt.contract.stubVersion === undefined) { log('仅 stub 契约支持 seed-demo'); process.exitCode = 2; break; }
      await rt.contract.seedGoal({ goalId: 'goal-demo-1', projectId: 'proj-demo-1', goalKey: 'model_review', inputVersions: { factVersion: '1', ruleVersion: '1' } });
      await rt.contract.seedGoal({ goalId: 'goal-demo-2', projectId: 'proj-demo-1', goalKey: 'cash_flow_coverage', params: { monthlyOperatingCashFlow: 120000, monthlyDebtService: 100000, currency: 'CNY' } });
      log('已灌入 goal-demo-1/2(合成目标)');
      break;
    }
    case 'status': {
      log(JSON.stringify({
        transport: rt.transport.configFingerprint(),
        router: rt.router.configFingerprint(),
        contract: rt.contract.stubVersion ?? 'http-client',
        costEntries: rt.transport.costSnapshot().length,
      }, null, 2));
      break;
    }
    default:
      console.log('用法: node src/cli.mjs <worker|recover|view|resume|cancel|seed-demo|status> [--data-dir D] [--config F]');
      process.exitCode = cmd ? 2 : 0;
  }
}

main().catch((e) => {
  console.error(redactText(`CLI 错误:${e.code ?? ''} ${e.message}`));
  process.exitCode = 1;
});
