// V7-B 测试助手:真实 V6 adapter + 可编程 transport(故障注入);隔离临时目录。
// 跨 lane 只读 import(B 测试专用;正式集成路径由 A assembly 决定):
//   V6 adapter: Anthropic/V6/handoff/PARALLEL_MODEL_ADAPTER_20260913/src/adapter.mjs
//   C tool:     V7/backend/C/src/calculation-tool.mjs
import { createModelAdapter } from '../../../../V6/handoff/PARALLEL_MODEL_ADAPTER_20260913/src/adapter.mjs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileFactStore, FactStorePort, ReceiptsPort, LocalFileReceipts, ToolsPort, LocalStubCalculation } from '../src/ports.mjs';
import { createThinOrchestrator } from '../src/thin/orchestrator.mjs';
import { FileCheckpointSaver } from '../src/langgraph/file-checkpointer.mjs';
import { createLangGraphOrchestrator } from '../src/langgraph/orchestrator.mjs';
import { calculateCashFlowCoverage } from '../../C/src/calculation-tool.mjs';
import { createCToolsAdapter } from '../src/c-tools.mjs';

export const EVIDENCE = [
  { id: 'ev-001', version: 2, hash: 'aaaa1111' },
  { id: 'ev-002', version: 1, hash: 'bbbb2222' },
];

/**
 * 可编程 transport:按 role 返回预设 TransportResult(真实 adapter 仍做全部校验)。
 * behavior: {ok:true,findings,questions} | {ok:'indeterminate'} | {throw:true}
 *          | {hang:true} | {notConfigured? 走 adapter 构造}
 */
export function createScriptedTransport({ byRole = {}, calls } = {}) {
  return async (call) => {
    if (calls) calls.push({ role: call.payload.role, requestId: call.payload.requestId, text: call.payload.text });
    const spec = byRole[call.payload.role] ?? { ok: true };
    if (spec.hang) return new Promise(() => {}); // 永不 resolve(模拟进程崩溃在途)
    if (spec.throw) throw new Error('transport 爆炸(注入)');
    if (spec.ok === 'indeterminate') return { ok: 'indeterminate' };
    const refs = call.payload.evidenceRefs ?? [];
    const findings = (spec.findings ?? [{ text: `合成观察(${call.payload.role})` }]).map((f, i) => ({
      id: `f-${call.payload.role}-${i}`,
      text: f.text,
      evidenceRefs: f.noRef ? [] : [refs[0] ?? EVIDENCE[0]],
    }));
    return {
      ok: true,
      output: {
        findings: spec.noFindings ? [] : findings,
        questions: (spec.questions ?? []).map((q, i) => ({ id: `q-${i}`, text: q })),
      },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };
  };
}

export function createTestAdapter(transport, opts = {}) {
  return createModelAdapter({ transport, timeoutMs: 5000, ...opts });
}

export async function makeTempDir(label = 'v7b-test') {
  return mkdtemp(join(tmpdir(), `${label}-`));
}

export async function cleanupDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

/** 组装两端候选的完整 harness(同一 adapter 实例形状、同一端口实现、各自隔离目录)。
 *  缺省注入合成验证器(既有恢复流程走可信正例路径);显式传 null = 无验证器(失败关闭负例)。 */
export async function createHarness({ transport, tools, factVersions = { factVersion: '3', ruleVersion: '1' }, lgCheckpointerDir, principalVerifier = createTestPrincipalVerifier(), authorizer } = {}) {
  const dataDir = await makeTempDir();
  const factStore = new LocalFileFactStore(dataDir);
  await factStore.setVersions('proj-1', factVersions.factVersion, factVersions.ruleVersion);
  const ports = () => ({
    factStore: new FactStorePort(new LocalFileFactStore(dataDir)),
    receipts: new ReceiptsPort(new LocalFileReceipts(dataDir)),
    tools: new ToolsPort(tools ?? new LocalStubCalculation()),
  });
  const adapter = createTestAdapter(transport);
  const thin = createThinOrchestrator({ ports: ports(), adapter, dataDir: `${dataDir}/thin`, principalVerifier, authorizer });
  const lg = createLangGraphOrchestrator({
    ports: ports(),
    adapter,
    dataDir: `${dataDir}/lg`,
    checkpointer: new FileCheckpointSaver(lgCheckpointerDir ?? `${dataDir}/lg-ckpt`),
    principalVerifier, authorizer,
  });
  return {
    dataDir, thin, lg, factStore,
    makeThin: () => createThinOrchestrator({ ports: ports(), adapter: createTestAdapter(transport), dataDir: `${dataDir}/thin`, principalVerifier, authorizer }),
  };
}

export const TEST_PRINCIPAL_TOKEN = 'v7b-d9-synthetic-test-credential';

/**
 * D-9 测试用合成 principal 验证器(同步;token 允许列表;仅本机测试适配,非生产认证/账号体系)。
 * deny(verdict, ctx) 可选钩子:返回 true 时拒绝(模拟验证器按项目/动作上下文拒绝)。
 */
export function createTestPrincipalVerifier({ tokens = [TEST_PRINCIPAL_TOKEN], deny } = {}) {
  const set = new Set(tokens);
  return (credential, ctx) => {
    if (typeof credential !== 'string' || !set.has(credential)) return { ok: false };
    const verdict = { ok: true, principalId: `test-principal-${credential.slice(-6)}`, role: 'human' };
    if (deny && deny(verdict, ctx)) return { ok: false };
    return verdict;
  };
}

/** D-9 授权器样例(业务策略注入点演示):拒绝指定项目/动作;非真实岗位授权制度。 */
export function createDenyAuthorizer({ projects, actions } = {}) {
  return (verdict, ctx) => {
    if (projects?.includes(ctx.projectId)) return { ok: false, reasonZh: `项目 ${ctx.projectId} 未授权该 principal 操作` };
    if (actions?.includes(ctx.action)) return { ok: false, reasonZh: `动作 ${ctx.action} 未被授权` };
    return { ok: true };
  };
}

export const C_INPUTS_OK = {
  monthlyOperatingCashFlow: { value: 120000, caliber: '当月经营现金流(银行流水口径)', source: { evidenceId: 'ev-001', version: 2 } },
  monthlyDebtService: { value: 100000, caliber: '当月还本付息(合同口径)', source: { evidenceId: 'ev-002', version: 1 } },
  currency: 'CNY',
  periodMonths: 1,
};

export { calculateCashFlowCoverage, createCToolsAdapter };
