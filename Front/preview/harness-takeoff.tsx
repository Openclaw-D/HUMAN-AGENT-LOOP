// TAKEOFF 视觉验收夹具（dev-only，不进 build/dist）：以行为测试同款夹具形状挂载真实
// TakeoffScreen 组件，供 1920×1080 / 1366×768 视觉证据截图。
// 纪律：页面顶部常驻"合成夹具"横幅；数据全部为标记的合成客户/合成材料；不连接任何后台；
// 真实读写由 preview/test/behavior/takeoff-board.behavior.test.mjs 与 04 路集成联调覆盖。
import { StrictMode } from 'react';
import { DesktopFrame } from '../site-mirror/app/takeoff/desktop-frame';
import { createRoot } from 'react-dom/client';
import { TakeoffScreen } from '../site-mirror/app/takeoff/takeoff-screen';
import type { WbApi } from '../site-mirror/lib/workbench/use-workbench';

const wb: WbApi = {
  phase: 'live',
  session: { sessionId: 'sess-fixture', principalId: 'biz1', roles: ['business'], expiresAt: Date.now() + 3_600_000 },
  identities: null,
  buildId: 'fixture-visual',
  customerId: 'cus_synthetic_mfg_01',
  snapshotVersion: 7,
  notes: [],
  error: null,
  lastEvent: { type: 'assessment_candidate', at: new Date().toISOString() },
  client: {
    session: { sessionId: 'sess-fixture', principalId: 'biz1', roles: ['business'], expiresAt: Date.now() + 3_600_000 },
    workspace: async () => ({ ok: true, snapshot: wb.snapshot }),
    readDecisions: async (customerId: string, assistant: string) => ({ ok: true, authority: 'none', customerId, assistant, revision: 0, pending: null, latest: null }),
    analyzeDecisions: async () => { throw Object.assign(new Error('离线夹具不调用模型'), { code: 'MODEL_NOT_CONFIGURED' }); },
    saveDecisionFeedback: async () => { throw Object.assign(new Error('离线夹具不保存业务反馈'), { code: 'FORBIDDEN' }); },
    read: async (path: string) => {
      if (path.endsWith('/artifacts')) {
        return {
          artifacts: [
            { artifactId: 'art_a1', kind: 'entity_register', current: true, grade: 'verified', materialMeta: { period: '2026-08' }, createdAt: '2026-09-19T02:10:00Z' },
            { artifactId: 'art_a2', kind: 'bank_statement', current: true, factKey: 'cash_balance', grade: 'source_supported', materialMeta: { period: '2026-07' }, createdAt: '2026-09-19T02:12:00Z' },
            { artifactId: 'art_a3', kind: 'equipment_list', current: true, grade: 'unverified', materialMeta: { period: '2026-08' }, createdAt: '2026-09-19T02:15:00Z' },
            { artifactId: 'art_a4', kind: 'purchase_contract', current: true, factKey: 'equipment_value', grade: 'source_supported', materialMeta: { period: '2026-08' }, createdAt: '2026-09-19T03:02:00Z' },
            { artifactId: 'art_a5', kind: 'invoice', current: false, supersededBy: 'art_a4', createdAt: '2026-09-18T09:00:00Z' },
          ],
          factConflicts: [{ factKey: 'equipment_value', assertionCount: 2 }],
        };
      }
      if (path.endsWith('/reports')) return { reports: [{ reportId: 'rep_1', kind: 'internal_summary', version: 1 }] };
      return {};
    },
    channelStatus: async () => ({
      tasks: [
        { task_id: 'tk_1', kind: 'bank_statement', status: 'done', stage_cursor: 'done', aRegistered: true, bridgeState: 'registered' },
        { task_id: 'tk_2', kind: 'equipment_list', status: 'running', stage_cursor: 'analyze' },
        { task_id: 'tk_3', kind: 'invoice', status: 'needs_followup', stage_cursor: 'questions' },
      ],
      rulesetVersion: 'sim-pack@7',
    }),
    packageDetail: async () => ({
      package: { packageId: 'pkg_syn_9f2', revision: 3 },
      domainResults: [
        { domain: 'policy', opinionVersion: 3, adoption: { adopted: true, rationale: '行业/地区要求满足（合成政策）' }, opinion: { findingType: 'observation', summary: '合成：政策要求齐备' } },
        { domain: 'credit', opinionVersion: 2, adoption: { adopted: true, rationale: '现金流覆盖可支撑候选（合成）' }, opinion: { findingType: 'observation', summary: '合成：偿付压力可接受' } },
      ],
      gaps: ['asset 域结论缺失：设备权属材料未核验'],
    }),
    listMessages: async () => ({
      messages: [
        { messageId: 'm1', seq: 1, requestId: 'r1', audience: 'internal', text: '政策域意见已登记（引用运行 run_9c1），请复核。', senderPrincipalId: 'cred1', at: '2026-09-20T10:02:00Z' },
        { messageId: 'm2', seq: 2, requestId: 'r2', audience: 'internal', text: '设备清单为未核验等级：资产域需补权属文件后再收口。', senderPrincipalId: 'asset1', at: '2026-09-20T10:05:00Z' },
        { messageId: 'm3', seq: 3, requestId: 'r3', audience: 'customer', text: '您好，请补传设备购买发票原件（2026-08）。', senderPrincipalId: 'biz1', at: '2026-09-20T10:08:00Z' },
      ],
      cursor: 'c3',
    }),
    sendMessage: async () => ({ ok: true, requestId: 'r-fix', delivery: { messageId: 'm9', state: 'sent' } }),
    artifactContent: async (_customerId: string, artifactId: string) => ({ ok: true, artifact: { content: { label: '合成原件预览测试', artifactId, equipment: '数控车床', note: '只用于离线交互验收，不是业务原件。' } } }),
    action: async () => ({ ok: true }),
    eventsPage: async () => ({
      ok: true,
      events: [
        { eventId: 'e1', payloadRef: { type: 'customer_created' }, payload: { at: '2026-09-19T01:58:00Z' }, aggregateVersion: '1' },
        { eventId: 'e2', payloadRef: { type: 'artifact_registered' }, payload: { at: '2026-09-19T02:10:00Z' }, aggregateVersion: '2' },
        { eventId: 'e3', payloadRef: { type: 'assessment_created' }, payload: { at: '2026-09-19T02:20:00Z' }, aggregateVersion: '3' },
        { eventId: 'e4', payloadRef: { type: 'assessment_candidate' }, payload: { at: '2026-09-19T04:40:00Z' }, aggregateVersion: '4' },
        { eventId: 'e5', payloadRef: { type: 'package_frozen' }, payload: { at: '2026-09-19T05:01:00Z' }, aggregateVersion: '5' },
        { eventId: 'e6', payloadRef: { type: 'domain_result_recorded' }, payload: { at: '2026-09-19T05:12:00Z' }, aggregateVersion: '6' },
      ],
      nextAfterSeq: '6',
      hasMore: false,
    }),
  } as unknown as NonNullable<WbApi['client']>,
  loginWithIdentity: async () => {},
  loginWithCredential: async () => {},
  redeemCode: async () => ({ ok: true }),
  enterCustomerPortal: () => {},
  logout: () => {},
  openCustomer: async () => true,
  closeCustomer: () => {},
  refresh: async () => {},
  setError: () => {},
  snapshot: {
    customer: { customerId: 'cus_synthetic_mfg_01', displayName: '合成制造（演示）', status: 'active' },
    openItems: [
      { kind: 'followup', needRole: 'asset', detail: '设备权属证明未核验：补权属登记材料', blockers: ['REVIEW_REQUIRED'] },
      { kind: 'conflict', needRole: 'credit', detail: 'equipment_value 存在 2 个现行断言', blockers: [] },
    ],
    decisionStatus: {
      basis: {
        packageId: 'pkg_syn_9f2', revision: 3, basisVersion: 'bv3', status: 'frozen', decisionReadiness: false,
        blockedActions: [], gate: { result: 'approved', rulePackVersion: 'sim-pack@7' },
        currency: [
          { domain: 'policy', currency: 'current' },
          { domain: 'credit', currency: 'current' },
          { domain: 'commerce', currency: 'missing' },
          { domain: 'asset', currency: 'changed', reasons: ['new_evidence'] },
        ],
      },
      facilityTotalsMinor: { proposed: 0, approvedInactive: 0, active: 0, suspended: 0, available: 0 },
      reviewQueue: [{ findingId: 'fd_1', findingType: 'conflict', severity: 'high', status: 'open' }],
    },
    facilities: [],
    assessments: [
      {
        assessmentId: 'asm_syn_01', status: 'candidate_ready', stale: false, ruleVersion: 'sim-pack@7',
        version: 5, candidateRevision: 3, inputVersion: 2, requestedAmountMinor: 80_000_000_00,
        candidate: { tendency: 'do_with_adjusted_terms', supportableAmountMinor: 12_000_000_00, currency: 'CNY', producedBy: 'channel:synthetic', suggestedTermMonths: 36, referencePriceMinor: 960_000_00, priceUnit: '元/年', priceBasis: '固定租金口径（合成示例）' },
      },
    ],
    financingRequests: [],
    totalsMinor: { exposureNow: 0, outstanding: 0 },
    session: {
      sessionId: 'insp_syn', runStatus: 'in_progress', openQuestions: 1,
      coverage: { total: 4, required: 3, verified: 2, open: 1 },
      followups: [{ followupId: 'f1', ownerRole: 'asset', reason: '设备权属文件未提供', nextAction: '补件后人工复核' }],
      items: [],
    },
    findings: [{ findingId: 'fd_1', findingType: 'conflict', severity: 'high', status: 'open', summary: '设备价值两处矛盾断言' }],
    admission: {
      scope: { customerId: 'cus_synthetic_mfg_01', assessmentId: 'asm_syn_01', revision: 5, sourceStatus: 'candidate_ready' },
      request: { requestedAmount: 80_000_000_00, equipmentRefs: null },
      assessmentState: 'candidate_ready',
      stale: false,
      inputVersion: 2,
      candidateRevision: 3,
      candidate: { version: 3, suggestedAmount: 12_000_000_00, suggestedTermMonths: 36, referencePriceMinor: 960_000_00, priceUnit: '元/年', priceBasis: '固定租金口径（合成示例）', conditions: null, tendency: 'do_with_adjusted_terms', inputVersion: 2, isCurrent: true },
      preassessment: null,
      frozen: { active: false, reasons: [], scope: [], note: '霜冻仅投影' },
      cells: [
        { domain: 'business', row: 'input', satisfiedItemCount: 1, running: false, blockers: [] },
        { domain: 'policy', row: 'input', satisfiedItemCount: 1, running: false, blockers: [] },
        { domain: 'credit', row: 'input', satisfiedItemCount: 1, running: false, blockers: [] },
        { domain: 'commerce', row: 'input', satisfiedItemCount: 2, running: false, blockers: [] },
        { domain: 'asset', row: 'input', satisfiedItemCount: 1, running: true, blockers: [{ scope: 'artifact', reason: 'PROCESSING_FAILED', detail: '解析失败（合成示例）', requiredAction: 'retry_or_manual' }] },
      ],
      blockers: [{ scope: 'finding', reason: 'conflict', detail: '设备价值两处矛盾断言', requiredAction: 'resolve_finding' }],
      projectionNote: '合成夹具：Edge admission 投影形状 mirror（视觉验收用）',
    },
    refsExhaustive: true,
  },
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode><DesktopFrame><TakeoffScreen wb={wb} onBackToDirectory={() => {}} onLogout={() => {}}/><div className="tk-fixture-tag">离线视觉夹具 · 合成材料 · 不连接业务服务</div></DesktopFrame></StrictMode>,
);
