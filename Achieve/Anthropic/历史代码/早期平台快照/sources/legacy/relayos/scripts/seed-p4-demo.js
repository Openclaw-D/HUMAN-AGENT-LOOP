import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { RelayService } from '../src/application/service.js';
import { MockExternalSystemAdapter } from '../src/connectors/mock-adapter.js';
import { loadScenarioConfigs } from '../src/config/scenario-loader.js';
import { EventStore } from '../src/persistence/event-store.js';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const databasePath = resolve(argument('--db', process.env.RELAYOS_DB_PATH ?? 'work/runtime/p4-demo.db'));
const scenarioDirectory = resolve(process.env.RELAYOS_SCENARIO_DIR ?? 'scenarios');
mkdirSync(dirname(databasePath), { recursive: true });

let minute = 0;
const clock = () => new Date(Date.UTC(2026, 7, 26, 6, minute++, 0)).toISOString();
const store = new EventStore(databasePath);
const service = new RelayService({
  store,
  scenarioConfigs: loadScenarioConfigs(scenarioDirectory),
  connector: new MockExternalSystemAdapter({ clock }),
  clock,
});

let commandSequence = 0;
function envelope(workCaseId, commandType, payload, actor = { kind: 'human', id: 'human-owner' }) {
  commandSequence += 1;
  const suffix = `${workCaseId}-${commandSequence}`;
  return {
    commandId: `p4-seed-command-${suffix}`,
    idempotencyKey: `p4-seed-idempotency-${suffix}`,
    expectedStreamVersion: store.getProjection(workCaseId)?.projectionVersion ?? 0,
    configurationVersion: 1,
    commandType,
    demoActorRef: actor,
    identityAssurance: 'demo_unverified',
    traceId: `trace-p4-seed-${suffix}`,
    payload,
  };
}

async function send(id, commandType, payload, actor) {
  return service.executeCommand(id, envelope(id, commandType, payload, actor));
}

async function createBase(spec) {
  if (store.getProjection(spec.id)) return false;
  await send(spec.id, 'workCase.create', {
    id: spec.id,
    organizationId: 'org-demo',
    scenarioKey: spec.scenarioKey,
    title: spec.title,
    ownerActorRef: spec.ownerActorRef,
    nextAction: spec.nextAction,
    trigger: {
      id: `${spec.id}:trigger:1`,
      type: 'representativeTrigger',
      sourceRef: { systemId: 'core-system' },
      observedAt: '2026-08-26T05:55:00.000Z',
      dedupeKey: `${spec.scenarioKey}:${spec.id}`,
      payloadRef: { systemId: 'core-system', recordType: 'synthetic-demo-trigger', recordId: spec.id, observedVersion: '1' },
    },
    scenarioExtensions: spec.scenarioExtensions,
  }, spec.ownerActorRef);
  await send(spec.id, 'goal.propose', {
    id: `${spec.id}:goal:1`,
    statement: spec.goal,
    constraints: ['责任只有被指定接收者明确接受后才转移', '外部动作必须保留明确回执'],
    evidenceIds: [],
  }, spec.ownerActorRef);
  await send(spec.id, 'goal.accept', { goalId: `${spec.id}:goal:1` });
  for (const [index, summary] of spec.evidence.entries()) {
    await send(spec.id, 'evidence.attach', {
      evidence: {
        id: `${spec.id}:evidence:${index + 1}`,
        sourceRef: { systemId: 'core-system' },
        recordRef: { systemId: 'core-system', recordType: 'synthetic-demo-evidence', recordId: `${spec.id}:${index + 1}`, observedVersion: '1' },
        observedAt: '2026-08-26T05:56:00.000Z',
        contentHash: String(index + 1).repeat(64),
        classification: 'internal',
        summary,
      },
    }, spec.ownerActorRef);
  }
  await send(spec.id, 'context.publish', {
    id: `${spec.id}:context:1`,
    evidenceIds: spec.evidence.map((_, index) => `${spec.id}:evidence:${index + 1}`),
    purpose: '连续性关系图与只读 advisory 演示',
    allowedDecisionUses: ['conflict.identify', 'configuration.suggest', 'action.suggest', 'action.authorize'],
    freshnessPolicy: { maxAgeMinutes: 240 },
  }, spec.ownerActorRef);
  return true;
}

const offered = {
  id: 'p4-offered-supply',
  scenarioKey: 'supplyChain',
  title: '供应延迟：替代方案与合同复核',
  ownerActorRef: { kind: 'human', id: 'human-owner' },
  nextAction: '等待具名复核人接受交接，并处理合同变更 Gate',
  goal: '在不越过合同与付款权限的前提下恢复供应连续性',
  evidence: ['ERP 到货窗口显示延迟风险。', '合同版本与替代供应方案等待人工复核。'],
  scenarioExtensions: { supplyChain: { supplierId: 'supplier-demo', purchaseOrderId: 'po-demo-221' } },
};

const accepted = {
  id: 'p4-accepted-finance',
  scenarioKey: 'finance',
  title: '异常交易：风险复核与回执查询',
  ownerActorRef: { kind: 'human', id: 'human-owner' },
  nextAction: '等待交接与受控动作',
  goal: '形成可审计的风险处置建议，并确认外部动作真实结果',
  evidence: ['交易流水出现与历史模式不一致的观测。', '客户档案与规则命中需要具名风控人员复核。'],
  scenarioExtensions: { finance: { transactionId: 'transaction-demo-1042', riskTier: 'high' } },
};

const agentOwned = {
  id: 'p4-agent-enterprise',
  scenarioKey: 'enterpriseAutomation',
  title: '跨部门请求：证据准备与系统更新',
  ownerActorRef: { kind: 'agent', id: 'agent-assistant' },
  nextAction: '由 Agent 整理证据，具名人员保留问责与动作授权',
  goal: '让跨部门请求在 Agent 与人员之间连续推进且不扩大权限',
  evidence: ['流程规则与数据权限来自受控知识源。', '系统字段更新必须经确定性校验。'],
  scenarioExtensions: { enterpriseAutomation: { requestId: 'request-demo-77', dataClassification: 'internal' } },
};

const seeded = [];
try {
  if (await createBase(offered)) {
    await send(offered.id, 'gate.open', {
      id: `${offered.id}:gate:contract`,
      policyId: 'protectedUpdate',
      question: '是否允许进入合同变更与外部写入准备？',
      assignedHumanId: 'human-reviewer',
      protectedActions: ['action.authorize'],
      evidenceIds: [`${offered.id}:evidence:1`, `${offered.id}:evidence:2`],
    });
    await send(offered.id, 'action.propose', {
      id: `${offered.id}:action:1`, systemId: 'core-system', operation: 'update',
      inputRef: { simulateStatus: 'succeeded' }, requiredGateIds: [`${offered.id}:gate:contract`], idempotencyKey: `${offered.id}:external:1`,
    });
    await send(offered.id, 'handoff.offer', {
      id: `${offered.id}:offer:1`, toActorRef: { kind: 'human', id: 'human-reviewer' },
      package: { evidenceIds: [`${offered.id}:evidence:1`, `${offered.id}:evidence:2`], commitments: ['复核合同版本', '不假定外部执行成功'] },
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    seeded.push(offered.id);
  }

  if (await createBase(accepted)) {
    await send(accepted.id, 'gate.open', {
      id: `${accepted.id}:gate:risk`, policyId: 'protectedUpdate', question: '是否允许准备风险处置动作？',
      assignedHumanId: 'human-reviewer', protectedActions: ['action.authorize'], evidenceIds: [`${accepted.id}:evidence:1`, `${accepted.id}:evidence:2`],
    });
    await send(accepted.id, 'gate.resolve', {
      gateId: `${accepted.id}:gate:risk`, decision: 'approved', rationale: '具名复核人已检查证据范围，仅批准进入受控执行。',
      evidenceIds: [`${accepted.id}:evidence:1`, `${accepted.id}:evidence:2`], nextAction: '执行并核验回执',
    }, { kind: 'human', id: 'human-reviewer' });
    await send(accepted.id, 'action.propose', {
      id: `${accepted.id}:action:1`, systemId: 'core-system', operation: 'update',
      inputRef: { simulateStatus: 'unknown' }, requiredGateIds: [`${accepted.id}:gate:risk`], idempotencyKey: `${accepted.id}:external:1`,
    });
    await send(accepted.id, 'action.authorize', { actionIntentId: `${accepted.id}:action:1` }, { kind: 'human', id: 'human-reviewer' });
    await send(accepted.id, 'action.execute', { actionIntentId: `${accepted.id}:action:1` }, { kind: 'human', id: 'human-reviewer' });
    await send(accepted.id, 'handoff.offer', {
      id: `${accepted.id}:offer:1`, toActorRef: { kind: 'human', id: 'human-reviewer' },
      package: { evidenceIds: [`${accepted.id}:evidence:1`, `${accepted.id}:evidence:2`], commitments: ['先查询 unknown 回执再决定是否重试'] },
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await send(accepted.id, 'handoff.accept', {
      offerId: `${accepted.id}:offer:1`, reason: '目标、证据与上下文完整，可以接续。', nextAction: '查询 unknown 回执，禁止直接重试副作用动作',
    }, { kind: 'human', id: 'human-reviewer' });
    seeded.push(accepted.id);
  }

  if (await createBase(agentOwned)) {
    await send(agentOwned.id, 'action.propose', {
      id: `${agentOwned.id}:action:1`, systemId: 'core-system', operation: 'update',
      inputRef: { simulateStatus: 'succeeded' }, requiredGateIds: [], idempotencyKey: `${agentOwned.id}:external:1`,
    }, { kind: 'agent', id: 'agent-assistant' });
    await send(agentOwned.id, 'action.authorize', { actionIntentId: `${agentOwned.id}:action:1` });
    await send(agentOwned.id, 'action.execute', { actionIntentId: `${agentOwned.id}:action:1` });
    seeded.push(agentOwned.id);
  }

  store.checkpoint();
  process.stdout.write(`${JSON.stringify({ status: 'seeded', databasePath, created: seeded, workCases: store.listProjections().map((item) => ({ id: item.workCaseId, version: item.projectionVersion, hash: item.canonicalStateHash })) })}\n`);
} finally {
  store.close();
}
