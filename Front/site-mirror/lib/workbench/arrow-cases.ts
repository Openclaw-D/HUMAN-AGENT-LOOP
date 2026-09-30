// 十案例演示目录（2026-09-30-final · 01-front）：消费服务端显式案例清单 GET /api/jw/v2/arrow-cases。
// 纪律（00_SCOPE）：案例映射来自服务端 manifest（A 权威∩角色授权），禁止前端按名称/顺序推断；
// scenarioLabel 是案例分类（差/中/好），不是结果承诺（scenarioIsOutcome=false）；本模块全部只读 GET。
// 案例要点/检查点/下一动作字段名由 02 CONTRACT_DELTA 一次明确；本读取器按兼容加法容错消费多个候选名，
// 未提供时如实显示"待服务端提供"，不编造。服务端未提供清单 → unavailable，调用方诚实显示。
import type { WbClient } from './wb-client';
import type { ColumnReceipt } from './advance-client';

/** manifest 内单个案例（只取展示所需字段；02 定稿字段名前按候选名容错）。 */
export interface ArrowCase {
  caseId: string;
  customerId: string;
  displayName: string;
  scenarioKey?: string;
  scenarioLabel?: string;
  displayOrder?: number;
  industry?: string;
  annualRevenueCny?: number | null;
  sourceMode?: string;
  /** 案例要点/一句话主旨（02 定稿前容错：summary/caseSummary/point/synopsis）。 */
  summary?: string | null;
  /** 初始检查点说明（容错：checkpoint/checkpointText/checkpointNote）。 */
  checkpoint?: string | null;
  /** 服务端建议的下一动作（容错：nextAction/nextActionText/nextStep）。 */
  nextAction?: string | null;
  transaction?: Record<string, unknown> | null;
}

export type ArrowCasesResult =
  | { kind: 'ok'; manifestVersion: string | null; cases: ArrowCase[] }
  | { kind: 'unavailable'; status: number; code: string };

function pickText(c: Record<string, unknown>, names: string[]): string | null {
  for (const n of names) {
    const v = c[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function normalizeCase(raw: unknown): ArrowCase | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.caseId !== 'string' || !c.caseId || typeof c.customerId !== 'string' || !c.customerId) return null;
  return {
    caseId: c.caseId,
    customerId: c.customerId,
    displayName: typeof c.displayName === 'string' && c.displayName ? c.displayName : '未命名案例',
    scenarioKey: typeof c.scenarioKey === 'string' ? c.scenarioKey : undefined,
    scenarioLabel: pickText(c, ['category', 'scenarioLabel']) ?? undefined,
    displayOrder: typeof c.displayOrder === 'number' && Number.isFinite(c.displayOrder) ? c.displayOrder : undefined,
    industry: typeof c.industry === 'string' ? c.industry : undefined,
    annualRevenueCny: typeof c.annualRevenueCny === 'number' ? c.annualRevenueCny : null,
    sourceMode: typeof c.sourceMode === 'string' ? c.sourceMode : undefined,
    summary: pickText(c, ['summary', 'caseSummary', 'point', 'synopsis', 'gist']),
    checkpoint: c.checkpoint && typeof c.checkpoint === 'object'
      ? pickText(c.checkpoint as Record<string, unknown>, ['label', 'detail', 'type'])
      : pickText(c, ['checkpoint', 'checkpointText', 'checkpointNote', 'checkpointSummary']),
    nextAction: Array.isArray(c.nextActions) && c.nextActions[0] && typeof c.nextActions[0] === 'object'
      ? pickText(c.nextActions[0] as Record<string, unknown>, ['label', 'hint', 'action'])
      : pickText(c, ['nextAction', 'nextActionText', 'nextStep', 'nextStepLabel']),
    transaction: (c.transaction && typeof c.transaction === 'object' ? c.transaction : null) as ArrowCase['transaction'],
  };
}

/** 开发夹具（?demoFixture=1）：按 00_SCOPE 十案例清单验证布局，不作联调验收。 */
export const DEMO_CASES_FIXTURE: ArrowCase[] = [
  { caseId: 'fixture-01', customerId: 'fixture-c01', displayName: '金盛贸易发展有限公司', scenarioLabel: '差', displayOrder: 1, industry: '商贸', summary: '年收入超过5000万红线（准入反例）', checkpoint: '已分析，红线阻断', nextAction: '查看收入原件与规则依据' },
  { caseId: 'fixture-02', customerId: 'fixture-c02', displayName: '恒昌精密部件有限公司', scenarioLabel: '差', displayOrder: 2, industry: '精密制造', summary: '资产权属冲突', checkpoint: '已核验，明确不通过', nextAction: '查看申报与核验冲突记录' },
  { caseId: 'fixture-03', customerId: 'fixture-c03', displayName: '蓝谷食联集团有限公司', scenarioLabel: '差', displayOrder: 3, industry: '食品', summary: '偿债能力不足', checkpoint: '已分析，风险意见待决定', nextAction: '查看现金流与偿债原件' },
  { caseId: 'fixture-04', customerId: 'fixture-c04', displayName: '新乡恒达重工设备有限公司', scenarioLabel: '中', displayOrder: 4, industry: '重工制造', summary: '现金流材料缺件', checkpoint: '已分析，信审待补件', nextAction: '补充现金流材料并重评' },
  { caseId: 'fixture-05', customerId: 'fixture-c05', displayName: '中州门窗科技有限公司', scenarioLabel: '中', displayOrder: 5, industry: '建材', summary: '金额/期间口径冲突', checkpoint: '分析已识别冲突，待核实', nextAction: '核实冲突材料后按版本重算' },
  { caseId: 'fixture-06', customerId: 'fixture-c06', displayName: '洛阳涧西精密装备有限公司', scenarioLabel: '中', displayOrder: 6, industry: '装备制造', summary: '人工核验未完成', checkpoint: '材料/分析已有，人工核验待办', nextAction: '完成收入/主体/权属核验' },
  { caseId: 'fixture-07', customerId: 'fixture-c07', displayName: '宛城新能源材料有限公司', scenarioLabel: '中', displayOrder: 7, industry: '新材料', summary: '新证据使旧结论需复核', checkpoint: '历史判断已保存，当前标陈旧', nextAction: '按新证据复核受影响步骤' },
  { caseId: 'fixture-08', customerId: 'fixture-c08', displayName: '郑州拓峰机械制造有限公司', scenarioLabel: '好', displayOrder: 8, industry: '机械制造', summary: '首次预评估收口', checkpoint: '五区已有结果与依据，待最终人类确认', nextAction: '完成预评估结论确认' },
  { caseId: 'fixture-09', customerId: 'fixture-c09', displayName: '汴梁纺机股份有限公司', scenarioLabel: '好', displayOrder: 9, industry: '纺织机械', summary: '履约等待外部回执', checkpoint: '已完成前序，履约后待回执', nextAction: '登记模拟外部回执（来源明确）' },
  { caseId: 'fixture-10', customerId: 'fixture-c10', displayName: '漯河食品机械有限公司', scenarioLabel: '好', displayOrder: 10, industry: '食品机械', summary: '已结清，可演示返单', checkpoint: '已有结清与关闭的可追溯演练记录', nextAction: '开启返单新周期' },
];

/** 读服务端显式案例清单。客户端错误/未接通都归入 unavailable（附状态码与错误码供诊断）。 */
export async function readArrowCases(client: WbClient): Promise<ArrowCasesResult> {
  try {
    const j = await client.read('/api/jw/v2/arrow-cases');
    const raw = Array.isArray(j.cases) ? j.cases : [];
    const cases = raw.map(normalizeCase).filter((c): c is ArrowCase => c !== null);
    if (raw.length > 0 && cases.length !== raw.length) {
      return { kind: 'unavailable', status: 0, code: 'INVALID_MANIFEST' };
    }
    return { kind: 'ok', manifestVersion: typeof j.manifestVersion === 'string' ? j.manifestVersion : null, cases };
  } catch (e) {
    const err = e as { status?: number; code?: string };
    return { kind: 'unavailable', status: err.status ?? 0, code: err.code ?? 'REQUEST_FAILED' };
  }
}

/** 差→中→好，再按 displayOrder/服务端顺序稳定排序。 */
export function sortCasesForDisplay(cases: ArrowCase[]): ArrowCase[] {
  const rank = (label?: string) => (label === '差' ? 0 : label === '中' ? 1 : label === '好' ? 2 : 3);
  return cases.map((c, i) => ({ c, i })).sort((a, b) => {
    const r = rank(a.c.scenarioLabel) - rank(b.c.scenarioLabel);
    if (r !== 0) return r;
    const oa = a.c.displayOrder ?? a.i;
    const ob = b.c.displayOrder ?? b.i;
    return oa - ob;
  }).map((x) => x.c);
}

/** 卡片分类档（视觉分类沿用既有好/中/差三色）。 */
export function caseGradeClass(scenarioLabel: string | undefined): 'good' | 'middle' | 'poor' | 'plain' {
  if (scenarioLabel === '好') return 'good';
  if (scenarioLabel === '中') return 'middle';
  if (scenarioLabel === '差') return 'poor';
  return 'plain';
}

const DOMAIN_ORDER = ['business', 'policy', 'credit', 'commerce', 'asset'] as const;
const DOMAIN_NAME: Record<string, string> = { business: '业务', policy: '政策', credit: '信审', commerce: '商务', asset: '资产' };
const STATE_TEXT: Record<string, string> = {
  not_started: '未开始', accepted: '已受理', running: '处理中', completed: '已完成', waiting_evidence: '待补件',
  awaiting_confirmation: '待确认', needs_reassessment: '待重评', rejected: '不通过', failed: '失败', unknown: '核对中',
  stopped: '已停止', stale: '依据变化', queued: '排队中',
};

export interface CaseProgress {
  domains: Array<{ domain: string; name: string; state: string; text: string }>;
  terminal: 'diamond' | 'rejection' | null;
  readError: boolean;
}

/** 目录卡片进度条：五区各取最新 current 回执状态（服务端只读投影；读取失败如实标注）。 */
export async function readCaseProgress(client: WbClient, customerId: string): Promise<CaseProgress> {
  const fallback = (readError: boolean): CaseProgress => ({
    domains: DOMAIN_ORDER.map((d) => ({ domain: d, name: DOMAIN_NAME[d], state: 'not_started', text: '未开始' })),
    terminal: null, readError,
  });
  try {
    const v = await client.advance.history(customerId);
    const latest = new Map<string, ColumnReceipt>();
    for (const r of v) {
      if (r.customerId !== customerId) continue;
      const old = latest.get(r.domain);
      if (!old || r.roundNo > old.roundNo || (r.roundNo === old.roundNo && r.version > old.version)) latest.set(r.domain, r);
    }
    const rejected = [...latest.values()].find((r) => r.current === true && r.caseOutcome?.status === 'rejected');
    const diamond = [...latest.values()].find((r) => r.current === true && r.caseOutcome?.ending === 'diamond');
    return {
      domains: DOMAIN_ORDER.map((d) => {
        const r = latest.get(d);
        const state = r && r.current !== false ? r.state : 'not_started';
        return { domain: d, name: DOMAIN_NAME[d], state, text: STATE_TEXT[state] ?? state };
      }),
      terminal: rejected ? 'rejection' : diamond ? 'diamond' : null,
      readError: false,
    };
  } catch {
    return fallback(true);
  }
}

/** 卡片"当前阶段"行：服务端 checkpoint 优先；未提供时由五区进度推导可读短语（不编造具体判断）。 */
export function caseStageText(c: ArrowCase, p: CaseProgress | undefined): string {
  if (c.checkpoint) return c.checkpoint;
  if (!p || p.readError) return '办理进度暂时无法读取';
  if (p.terminal === 'rejection') return '已拒绝并归档';
  if (p.terminal === 'diamond') return '已办结';
  const active = p.domains.filter((d) => !['not_started', 'completed'].includes(d.state));
  if (active.length === 0) return p.domains.some((d) => d.state === 'completed') ? '进行中：部分专业已完成' : '尚未开始办理';
  return `进行中：${active.map((d) => `${d.name}·${d.text}`).join('、')}`;
}

/** 年收入展示（manifest 数字字段；未知=未提供，不编造）。 */
export function formatAnnualRevenue(v: number | null | undefined): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return v >= 10_000 ? `${(v / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 万元` : `${v} 元`;
}
