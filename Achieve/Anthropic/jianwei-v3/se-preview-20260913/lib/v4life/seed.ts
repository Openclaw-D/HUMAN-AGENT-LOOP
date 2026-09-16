// V4-LIFE 合成演示案例种子（Golden Case fixture，docs/v4/CONTRACT.md §11 ＋ §14.2 扩展）
// 全部事实为合成/公开信息构造的虚拟演示，不代表真实客户、授信或合作关系。
// 依赖图设计证明点：
//   1. Evidence 到达即跨域并行启动（WI-P1 / WI-C1 / WI-A1 同时就绪）；
//   2. 硬等待：WI-C3 必须等待 PG-1 的 Receipt，即使 WI-C1/WI-C2 已完成；
//   3. 否决语义：PG-1 rejected → WI-C3 stopped_dependency，已形成的贡献保留；
//   4. 无依赖工作不受阻：WI-B1 / WI-A1 不因政策流程等待或否决而停止。
// §14.2 扩展（四域正式承接链）：WI-B2 等待 CG-1 Receipt ＋ WI-B1 完成；WI-A2 等待 BG-1 Receipt ＋ WI-A1 完成；
//   仅 WI-C3 / WI-B2 / WI-A2 三个高成本正式承接等待前序 Receipt，可提前准备项一律不改为全串行。

import type { V4LifeActor } from './types.ts';
import type { V4LifeSeedInput } from './types.ts';

export const V4LIFE_DEMO_CASE_ID = 'demo-sme-robot-500w';

export function createV4LifeDemoSeed(): V4LifeSeedInput {
  const actors: readonly V4LifeActor[] = [
    { actorId: 'actor-business-chen', role: 'business', displayName: '陈经理（业务）' },
    { actorId: 'actor-policy-li', role: 'policy', displayName: '李审（政策）' },
    { actorId: 'actor-credit-zhang', role: 'credit', displayName: '张审（信审）' },
    { actorId: 'actor-commerce-wang', role: 'commerce', displayName: '王经理（商务）' },
    { actorId: 'actor-asset-zhou', role: 'asset', displayName: '周工（资产）' },
  ];

  return {
    case: {
      caseId: V4LIFE_DEMO_CASE_ID,
      displayName: '某四足机器人科技企业·流动资金与设备采购（合成演示案例）',
      disclaimer: '基于公开信息构造的虚拟演示，不代表真实客户、授信结论或合作关系。',
      financingAmountCny: 5_000_000,
      purpose: '补充经营流动资金并采购研发测试设备',
      upstreamNote: '业务已按现行制度完成受理与必要尽调核验，项目 Context 由上游送入。',
    },
    actors,
    workItems: [
      {
        workItemId: 'WI-P1',
        domain: 'policy',
        title: '政策准入规则符合性初核',
        dependencies: [{ kind: 'evidence', id: 'ev-upstream-context' }],
        assignedRole: 'policy',
        gateId: 'PG-1',
      },
      {
        workItemId: 'WI-C1',
        domain: 'credit',
        title: '信审材料完整性核验',
        dependencies: [{ kind: 'evidence', id: 'ev-upstream-context' }],
        assignedRole: 'credit',
      },
      {
        workItemId: 'WI-C2',
        domain: 'credit',
        title: '客户偿付能力交叉核验',
        dependencies: [{ kind: 'evidence', id: 'ev-financial-statement' }],
        assignedRole: 'credit',
      },
      {
        workItemId: 'WI-C3',
        domain: 'credit',
        title: '正式信审意见与签批',
        dependencies: [
          { kind: 'receipt', id: 'PG-1' },
          { kind: 'workitem', id: 'WI-C1' },
          { kind: 'workitem', id: 'WI-C2' },
        ],
        assignedRole: 'credit',
        gateId: 'CG-1',
      },
      {
        workItemId: 'WI-B1',
        domain: 'commerce',
        title: '商务方案与报价制式核对',
        dependencies: [{ kind: 'evidence', id: 'ev-contract-draft' }],
        assignedRole: 'commerce',
      },
      {
        workItemId: 'WI-B2',
        domain: 'commerce',
        title: '商务条款确认与合同承接',
        dependencies: [
          { kind: 'receipt', id: 'CG-1' },
          { kind: 'workitem', id: 'WI-B1' },
        ],
        assignedRole: 'commerce',
        gateId: 'BG-1',
      },
      {
        workItemId: 'WI-A1',
        domain: 'asset',
        title: '同客户历史资产表现反馈整理',
        dependencies: [{ kind: 'evidence', id: 'ev-upstream-context' }],
        assignedRole: 'asset',
      },
      {
        workItemId: 'WI-A2',
        domain: 'asset',
        title: '租赁物条件与贷后巡检计划确认',
        dependencies: [
          { kind: 'receipt', id: 'BG-1' },
          { kind: 'workitem', id: 'WI-A1' },
        ],
        assignedRole: 'asset',
        gateId: 'AG-1',
      },
    ],
    gates: [
      {
        gateId: 'PG-1',
        domain: 'policy',
        title: '政策准入 Gate',
        requiredRole: 'policy',
        workItemId: 'WI-P1',
      },
      {
        gateId: 'CG-1',
        domain: 'credit',
        title: '信审签批 Gate',
        requiredRole: 'credit',
        workItemId: 'WI-C3',
      },
      {
        gateId: 'BG-1',
        domain: 'commerce',
        title: '商务承接 Gate',
        requiredRole: 'commerce',
        workItemId: 'WI-B2',
      },
      {
        gateId: 'AG-1',
        domain: 'asset',
        title: '资产承接 Gate',
        requiredRole: 'asset',
        workItemId: 'WI-A2',
      },
    ],
    initialEvidence: [
      {
        evidenceId: 'ev-upstream-context',
        kind: 'upstream_context',
        title: '上游受理与尽调核验后的项目 Context',
        submittedBy: 'actor-business-chen',
        payload: {
          summary:
            '企业成立于 2016 年，四足机器人整机及行业解决方案；本次申请 500 万元用于流动资金与设备采购。受理与必要尽调核验已完成。',
          amountCny: 5_000_000,
          tags: ['business_license'],
        },
      },
    ],
  };
}
