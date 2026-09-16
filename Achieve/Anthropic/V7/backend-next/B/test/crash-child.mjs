// 崩溃测试子进程:领任务 → 启动执行(阻塞在慢 transport 上)→ 被父进程 SIGKILL。
// 用法: node test/crash-child.mjs <dataDir> <mockBaseUrl> <taskRunId>
// 数据目录/契约 stub 由父进程预先 seed;子进程只 claim+start。

import { createBRuntime } from '../src/runtime.mjs';
import { testRoutes } from './helpers.mjs';

const [, , dataDir, baseUrl, taskRunId] = process.argv;
const rt = createBRuntime({
  dataDir,
  config: { transport: { mode: 'mock', mock: { baseUrl, timeoutMs: 30000 } }, routes: testRoutes(), contract: { mode: 'stub' } },
  overrides: { logger: () => {} },
});
const claim = await rt.contract.pollWork({ workerId: 'crash-child' });
if (!claim.ok) { console.error('child: no claimable task'); process.exit(3); }
console.log(`child claimed ${claim.task.taskId} fencing=${claim.assignment.fencingToken}`);
// 有意不 await 完成:父进程在 intent 回执落盘后 SIGKILL 本进程
rt.orchestrator.start({ taskRunId, taskId: claim.task.goalId, goalId: claim.task.goalId, projectId: claim.task.projectId, assignment: claim.assignment, task: claim.task })
  .then((v) => console.log(`child finished unexpectedly: ${v.state}`))
  .catch((e) => console.error(`child error: ${e.message}`));
setTimeout(() => {}, 1 << 30);
