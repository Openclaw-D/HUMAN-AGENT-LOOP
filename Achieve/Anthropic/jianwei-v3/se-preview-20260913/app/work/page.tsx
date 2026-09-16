// /work —— 小微业务 + 政策/信审/商务/资产 四域 role-aware responsive 工作台（2026-09-04）
// 唯一产品 Route、一个服务端 V4LifeProjection；全部动作走真实 /api/v4life/**，
// 不使用任何静态演示投影作为数据来源（旧静态叙事已按整夜 Goal §3 移除）。

import { WorkShell } from './WorkShell';

export const dynamic = 'force-dynamic';

const DEMO_CASE_ID = 'demo-sme-robot-500w';

type WorkPageProps = {
  searchParams: Promise<{ caseId?: string | string[] }>;
};

function normalizeCaseId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim();
  return normalized ? normalized.slice(0, 80) : DEMO_CASE_ID;
}

export default async function WorkPage({ searchParams }: WorkPageProps) {
  const caseId = normalizeCaseId((await searchParams).caseId);
  return <WorkShell caseId={caseId} />;
}
