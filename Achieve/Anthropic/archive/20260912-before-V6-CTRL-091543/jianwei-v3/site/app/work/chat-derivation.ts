// Case Chat 状态摘要的纯派生（主 Agent 整合层，2026-09-04）
// 全部内容来自 canonical Projection，不含任何预写回答或虚构状态。

import type { V4LifeActor, V4LifeProjection, WorkActorId } from './workspace-contract';

const ROLE_NAMES: Record<string, string> = {
  business: '业务',
  policy: '政策',
  credit: '信审',
  commerce: '商务',
  asset: '资产',
  system: '系统',
};

export interface OpenGateBrief {
  gateId: string;
  title: string;
  requiredRoleName: string;
}

export function selectOpenGatesBrief(projection: V4LifeProjection): OpenGateBrief[] {
  return projection.openGates.map((gate) => ({
    gateId: gate.gateId,
    title: gate.title,
    requiredRoleName: gate.requiredRole === 'system' ? '系统' : (ROLE_NAMES[gate.requiredRole] ?? gate.requiredRole),
  }));
}

export interface ChatSummary {
  actorName: string;
  lines: string[];
}

function actorDisplayName(projection: V4LifeProjection, actorId: WorkActorId): string {
  return (
    projection.actors.find((actor) => actor.actorId === actorId)?.displayName ??
    (ROLE_NAMES[actorId] ?? actorId)
  );
}

export function selectChatSummary(projection: V4LifeProjection, actorId: WorkActorId): ChatSummary {
  const actor: V4LifeActor | undefined = projection.actors.find((entry) => entry.actorId === actorId);
  const lines: string[] = [];

  const openGatesForMyRole = projection.openGates.filter((gate) => gate.requiredRole === actor?.role);
  if (openGatesForMyRole.length > 0) {
    lines.push(
      `有 ${openGatesForMyRole.length} 个 Human Gate 等待你决定：${openGatesForMyRole.map((gate) => gate.title).join('、')}。`,
    );
  }

  const myItems = projection.domains
    .flatMap((domain) => domain.workItems)
    .filter((item) => item.assignedRole === actor?.role);
  const inProgress = myItems.filter((item) => item.status === 'in_progress');
  const blocked = myItems.filter((item) => item.status === 'blocked');
  const stopped = myItems.filter((item) => item.status === 'stopped_dependency');
  const completed = myItems.filter((item) => item.status === 'completed');

  if (inProgress.length > 0) {
    lines.push(`你名下有 ${inProgress.length} 个进行中事项：${inProgress.map((item) => item.title).join('、')}。`);
  }
  if (blocked.length > 0) {
    lines.push(`${blocked.length} 个事项仍在等待前置依赖（Evidence/WorkItem/Receipt）。`);
  }
  if (stopped.length > 0) {
    lines.push(
      `${stopped.length} 个事项因上游否决停止依赖；已形成的 Evidence、判断与贡献全部保留，不因否决归零。`,
    );
  }
  if (completed.length > 0) {
    lines.push(`你已完成 ${completed.length} 个事项，贡献已留痕。`);
  }

  if (actor?.role === 'business') {
    const receipts = projection.receipts;
    if (receipts.length > 0) {
      lines.push(`本 Case 已产生 ${receipts.length} 份正式 Receipt，可在检查轨查看。`);
    }
    const candidates = projection.domains.flatMap((domain) => domain.candidates);
    if (candidates.length > 0) {
      lines.push(`四域模型 Candidate 共 ${candidates.length} 条（authority=none，仅供参考）。`);
    }
  }

  if (lines.length === 0) {
    lines.push('当前没有需要你处理的事项；可切换角色或刷新查看最新状态。');
  }

  return { actorName: actorDisplayName(projection, actorId), lines };
}
