// V7 backend-next B 运行时装配:把端口/契约/transport/路由/checkpointer/编排器/worker
// 组装为可运行实例。全部依赖显式注入;默认实现均为 B 目录内隔离落盘。
// 凭据纪律:transport 配置(含 apiKey)只经 config 文件显式注入,不从环境读取;
// configFingerprint 输出不含密钥。

import { createContractStub } from './contract/stub.mjs';
import { createContractClient } from './contract/client.mjs';
import { createModelTransport } from './transport/glm.mjs';
import { createRouter } from './router.mjs';
import { FileCheckpointSaver } from './langgraph/file-checkpointer.mjs';
import { createTaskRunOrchestrator } from './graph/task-run-orchestrator.mjs';
import { createWorker } from './worker/worker.mjs';
import { LocalFileReceipts, ToolsPort, LocalStubCalculation, ReceiptsPort } from './ports.mjs';

/** 事实版本端口:A 是事实权威,B 经契约只读投影(目标乐观版本+stale 投影)。 */
export function createContractFactVersions(contract) {
  return {
    async currentVersions(projectId, goalId) { return contract.getGoalVersions(projectId, goalId); },
  };
}

/**
 * 合成身份源(仅测试/组合环境;非生产认证):凭据形如 `cred:<principalId>` → human principal。
 * 生产身份源 = overrides.principalVerifier 注入,不经此路径。
 */
export function createSyntheticVerifier() {
  return (credential) => {
    if (typeof credential === 'string' && credential.startsWith('cred:') && credential.length > 5) {
      return { ok: true, principalId: credential.slice(5), role: 'human' };
    }
    return { ok: false };
  };
}

/**
 * @param p.dataDir B 运行时数据目录(回执/checkpoint/registry/契约stub 均在其下)
 * @param p.config { transport:{mode,real,mock,costLogPath}, routes:{roles,rules},
 *                    contract:{mode:'stub'|'http', dataDir?, baseUrl?}, worker:{...} }
 * @param p.overrides 测试注入覆盖(ports/verifier/authorizer/logger/now 等)
 */
export function createBRuntime({
  dataDir,
  config,
  overrides = {},
}) {
  const contractMode = config.contract?.mode ?? 'stub';
  const contract = overrides.contract
    ?? (contractMode === 'http'
      ? createContractClient({
          baseUrl: config.contract.baseUrl,
          principalCredential: config.contract.principalCredential,
          projectFilter: config.contract.projectFilter ?? null,
        })
      : createContractStub({ dataDir: `${dataDir}/contract-stub` }));

  const transport = overrides.transport
    ?? createModelTransport({
      mode: config.transport?.mode,
      real: config.transport?.real,
      mock: config.transport?.mock,
      // DEF-04 修复:budget 必须透传到 transport(账本/锁/失败关闭全在 glm.mjs 内部,不透传=死代码)。
      // 配置位置:顶层 config.budget(样例与 HANDOFF-D §2)或 config.transport.budget,前者优先。
      budget: config.budget ?? config.transport?.budget ?? null,
      costLogPath: config.transport?.costLogPath ?? `${dataDir}/cost-ledger.jsonl`,
    });

  const router = overrides.router ?? createRouter(config.routes);

  const receipts = overrides.receipts ?? new ReceiptsPort(new LocalFileReceipts(dataDir));
  const tools = overrides.tools ?? new ToolsPort(new LocalStubCalculation());
  const factVersions = overrides.factVersions ?? createContractFactVersions(contract);

  const checkpointer = overrides.checkpointer ?? new FileCheckpointSaver(`${dataDir}/checkpoints`);

  const logger = overrides.logger ?? (() => {});
  const now = overrides.now ?? (() => new Date().toISOString());

  // 身份源:缺省 none = D-9 失败关闭(无验证器,一切 resume 拒绝);
  // synthetic = B 本地合成身份源(凭据形如 cred:<principalId> → human principal),
  // 仅测试/组合环境;生产接真实身份源 = 在此注入(overrides.principalVerifier 或扩展 config.identity)。
  const identityMode = config.identity?.mode ?? 'none';
  const principalVerifier = overrides.principalVerifier
    ?? (identityMode === 'synthetic' ? createSyntheticVerifier() : null);

  const orchestrator = createTaskRunOrchestrator({
    ports: { receipts, tools, factVersions },
    contract, transport, router, checkpointer,
    principalVerifier,
    authorizer: overrides.authorizer ?? null,
    sinks: overrides.sinks ?? [],
    logger, now,
  });

  const worker = createWorker({
    contract, orchestrator, logger, now,
    workerId: config.worker?.workerId ?? 'b-worker-1',
    concurrency: config.worker?.concurrency ?? 2,
    pollIntervalMs: config.worker?.pollIntervalMs ?? 200,
    taskTimeoutMs: config.worker?.taskTimeoutMs ?? 120000,
    maxReclaims: config.worker?.maxReclaims ?? 1,
    registryDir: `${dataDir}/worker`,
    cancellationsDir: `${dataDir}/cancellations`,
  });

  return { contract, transport, router, orchestrator, worker, checkpointer, receipts, tools, factVersions };
}
