// V4-LIFE 进程内 runtime：组合根 + 测试隔离（契约 §10）。
// 演示态：引擎实例保存在进程 Map 中；未设置 V4LIFE_DATA_DIR 时为纯内存、重启即失（契约 §13 边界）。
// 持久化（opt-in）：设置 V4LIFE_DATA_DIR 后，demo 引擎经 createFileEventLog 把事件按 case 落盘
// （JSONL，append-only），进程重启时 loadAll 非空即 refold 完整重建写路径状态（rev/Gate/工作项/
// evidence 自然键幂等）。已知边界（engine.ts 头注释自述）：commandId 幂等缓存不跨重启，重启后
// 同 commandId 重发靠 evidenceId 自然键兜底；多实例共享同一目录需要文件锁，仍属单进程演示。
// 生产试点需要事务数据库/事件账本、唯一约束、认证 RBAC、审计与保留策略。
// 一切正式状态变化只来自引擎命令；本模块不生成任何权威状态。

import { createV4LifeEngine, V4LifeError, type V4LifeEngine } from './engine.ts';
import { createV4LifeDemoSeed, V4LIFE_DEMO_CASE_ID } from './seed.ts';
import { createFileEventLog } from './file-event-log.ts';
import { createCommandJournal } from './command-journal.ts';

const engines = new Map<string, V4LifeEngine>();

const PERSIST_DATA_DIR = process.env.V4LIFE_DATA_DIR;

let demoFileEventLog: ReturnType<typeof createFileEventLog> | undefined;
let demoCommandJournal: ReturnType<typeof createCommandJournal> | undefined;

/** 持久化开关：仅当 V4LIFE_DATA_DIR 设置为非空路径时启用文件事件账本（懒创建、进程内单例）。 */
function demoPersistence(): ReturnType<typeof createFileEventLog> | undefined {
  if (PERSIST_DATA_DIR === undefined || PERSIST_DATA_DIR.length === 0) {
    return undefined;
  }
  demoFileEventLog ??= createFileEventLog({ dir: PERSIST_DATA_DIR });
  return demoFileEventLog;
}

/** 命令日志：与事件账本同目录、成对注入/成对清盘——commandId 幂等跨重启（CONTRACT §15）。 */
function demoJournal(): ReturnType<typeof createCommandJournal> | undefined {
  if (PERSIST_DATA_DIR === undefined || PERSIST_DATA_DIR.length === 0) {
    return undefined;
  }
  demoCommandJournal ??= createCommandJournal({ dir: PERSIST_DATA_DIR });
  return demoCommandJournal;
}

/** 读取已注册引擎（含测试注入的实例）；不存在返回 undefined。 */
export function getV4LifeEngine(caseId: string): V4LifeEngine | undefined {
  return engines.get(caseId);
}

/** 组合根：懒创建并单例持有 demo case 引擎（seed 来自 createV4LifeDemoSeed）；
 *  持久化开启时传入文件事件账本 + 命令日志，重启后 refold 恢复状态、loadAll 恢复幂等记录。
 *  p1CandidateSemantics='demo'：本 runtime 是显式合成演示面（/work、/work/screen）——
 *  P1 candidate 语义（核验命令、收集窗口、种子隐含批次）只在此 opt-in 路径启用（P1-BE-01 隔离）；
 *  默认 createV4LifeEngine()（正式权威路径）不启用。 */
export function getOrCreateV4LifeDemoEngine(): V4LifeEngine {
  const existing = engines.get(V4LIFE_DEMO_CASE_ID);
  if (existing !== undefined) {
    return existing;
  }
  const eventLog = demoPersistence();
  const commandJournal = demoJournal();
  const engine = createV4LifeEngine(createV4LifeDemoSeed(), {
    p1CandidateSemantics: 'demo',
    ...(eventLog ? { eventLog } : {}),
    ...(commandJournal ? { commandJournal } : {}),
  });
  engines.set(V4LIFE_DEMO_CASE_ID, engine);
  return engine;
}

/** 测试隔离：显式注入/替换某 case 的引擎实例。 */
export function injectV4LifeEngine(caseId: string, engine: V4LifeEngine): void {
  engines.set(caseId, engine);
}

/** 测试隔离：清空全部引擎实例（每个集成测试前调用）。 */
export function resetV4LifeRuntime(): void {
  engines.clear();
}

/** §14.3 Demo reset：丢弃当前 demo 引擎单例，用 createV4LifeDemoSeed 重建全新引擎并注册，返回新引擎。
 *  只重建 demo case；其他已注册引擎（测试注入等）不受影响。
 *  reset 不进入事件账本（无 Reset 事件），旧实例直接丢弃；这是合成演示态重置，不是业务回滚。
 *  持久化开启时同步清空该 case 的落盘事件与命令日志：重启后不得把旧状态 refold 回来。 */
export function resetV4LifeDemoRuntime(): V4LifeEngine {
  demoPersistence()?.clear(V4LIFE_DEMO_CASE_ID);
  demoJournal()?.clear(V4LIFE_DEMO_CASE_ID);
  const eventLog = demoPersistence();
  const commandJournal = demoJournal();
  const engine = createV4LifeEngine(createV4LifeDemoSeed(), {
    p1CandidateSemantics: 'demo',
    ...(eventLog ? { eventLog } : {}),
    ...(commandJournal ? { commandJournal } : {}),
  });
  engines.set(V4LIFE_DEMO_CASE_ID, engine);
  return engine;
}

export { V4LifeError, V4LIFE_DEMO_CASE_ID };
