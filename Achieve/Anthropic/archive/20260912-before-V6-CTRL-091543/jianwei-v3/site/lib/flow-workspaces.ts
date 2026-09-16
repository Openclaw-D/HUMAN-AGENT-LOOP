import { POLICY_WORKSPACES } from './policy-workspaces.ts';

export type FlowWorkspace = {
  id: string;
  type: string;
  headline: string;
  objective: string;
  visualization: {
    type: string;
    title: string;
    description: string;
    items: Array<{ id: string; label: string; value: string; status: string }>;
  };
  matrix: {
    title: string;
    columns: Array<{ key: string; label: string }>;
    rows: Array<{ id: string; cells: Record<string, string> }>;
  };
  graph: {
    nodes: Array<{ id: string; label: string; kind: string; active: boolean }>;
    edges: Array<{ id: string; source: string; target: string; label: string }>;
  };
  indicators: Array<{ label: string; value: string; note: string }>;
  evidenceGaps: string[];
  nextActions: string[];
  currentSituation: string;
  whyMe: string;
  aiCompleted: string[];
  primaryHumanAction: { action: string; owner: string; evidenceGap: string; humanGate: string };
  nextHandoff: { target: string; receiver: string; contextPacket: string[] };
  successReceiptCondition: string;
};

const LEGACY_FLOW_WORKSPACES: Record<string, FlowWorkspace> = {
  'policy-rules': {
    id: 'policy-rules',
    type: 'policy-rules-workspace',
    headline: '规则配置：租赁准入规则 v2.4 候选定稿进入人工复核',
    objective: '复核本地合成规则依赖与适用例外，形成可追溯的政策规则候选基线。',
    visualization: {
      type: '规则依赖画布',
      title: '准入规则依赖画布',
      description: '本地合成候选规则关系，仅使用进程内演示数据，全部结论未经集团生产验证。',
      items: [
        { id: 'rule-customer', label: '承租人准入', value: '12 类主体', status: '候选已映射' },
        { id: 'rule-equipment', label: '设备准入', value: '6 类设备', status: '候选已映射' },
        { id: 'rule-structure', label: '租赁结构', value: '4 类结构', status: '待例外确认' },
        { id: 'rule-exception', label: '例外条款', value: '2 项待定', status: '候选待复核' },
      ],
    },
    matrix: {
      title: '规则 × 客户、主体、设备与结构适用性矩阵',
      columns: [
        { key: 'rule', label: '规则' },
        { key: 'customer', label: '客户/主体' },
        { key: 'equipment', label: '设备' },
        { key: 'structure', label: '租赁结构' },
        { key: 'exception', label: '例外' },
        { key: 'evidence', label: '证据' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'rule-row-001',
          cells: {
            rule: '公共承租人准入线', customer: '公开招标承租人', equipment: '通用生产设备', structure: '直租', exception: '无', evidence: '本地合成准入底稿', status: '候选可复核',
          },
        },
        {
          id: 'rule-row-002',
          cells: {
            rule: '制造主体集中度', customer: '民营制造企业', equipment: '数控机床', structure: '售后回租', exception: '需补充设备评估', evidence: '候选主体清单', status: '待政策确认',
          },
        },
        {
          id: 'rule-row-003',
          cells: {
            rule: '医疗设备专项', customer: '非营利医疗机构', equipment: '影像设备', structure: '直租', exception: '预算证明缺口', evidence: '候选预算说明', status: '候选阻断',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'policy-source', label: '本地合成政策底稿', kind: 'policy', active: true },
        { id: 'rule-core', label: '租赁准入规则 v2.4', kind: 'rule', active: true },
        { id: 'rule-agent', label: '候选规则抽取 Agent', kind: 'agent', active: true },
        { id: 'rules-gate', label: '政策规则复核 Gate（周宁）', kind: 'gate', active: true },
        { id: 'model-target', label: '模型参数', kind: 'target', active: false },
      ],
      edges: [
        { id: 'policy-rules-e1', source: 'policy-source', target: 'rule-agent', label: '提供候选素材' },
        { id: 'policy-rules-e2', source: 'rule-agent', target: 'rule-core', label: '生成候选规则' },
        { id: 'policy-rules-e3', source: 'rule-core', target: 'rules-gate', label: '等待人工定稿' },
        { id: 'policy-rules-e4', source: 'rules-gate', target: 'model-target', label: '定稿后接续' },
      ],
    },
    indicators: [
      { label: '候选规则', value: '18 条', note: '本地合成，未验证' },
      { label: '例外条款', value: '2 项', note: '缺少责任人与正式依据' },
      { label: '人工覆盖', value: '100%', note: '发布前必须经周宁复核' },
    ],
    evidenceGaps: ['两项例外条款缺少正式制度依据。', '医疗设备预算证明仍为候选材料。'],
    nextActions: ['由周宁确认例外条款责任人。', '补齐医疗设备预算证明候选缺口。', '在规则复核 Gate 记录接受或否决理由。'],
    currentSituation: '规则集 v2.4 已形成候选定稿，但两项例外和医疗预算证据未确认。',
    whyMe: '周宁维护政策准入口径；模型 authority=none，只能提供候选规则。',
    aiCompleted: ['已生成候选规则差异清单。', '已标记例外条款证据缺口。'],
    primaryHumanAction: {
      action: '复核 18 条候选规则并决定是否进入参数包。',
      owner: '政策经理·周宁',
      evidenceGap: '例外条款正式依据与医疗预算证明。',
      humanGate: '政策规则复核 Gate',
    },
    nextHandoff: {
      target: 'policy-model',
      receiver: '模型治理·徐朔',
      contextPacket: ['项目 FL-DEMO-001', '规则版本 POLICY-RULES-v2.4-candidate', '例外条款缺口', '周宁复核决定', '模型参数接续目标'],
    },
    successReceiptCondition: '周宁在政策规则复核 Gate 提交后返回带版本与时间的定稿 Receipt。',
  },
  'policy-model': {
    id: 'policy-model',
    type: 'policy-model-workspace',
    headline: '模型参数：残值与集中度参数待模型治理确认',
    objective: '检查候选参数依赖、允许区间与校验记录，防止未验证参数进入策略。',
    visualization: {
      type: '参数依赖画布',
      title: '评分参数依赖画布',
      description: '本地合成参数依赖候选图，未接集团系统，参数当前值不可作为生产决策。',
      items: [
        { id: 'param-residual', label: '设备残值', value: '候选区间 62%-74%', status: '待校准' },
        { id: 'param-concentration', label: '主体集中度', value: '候选上限 15%', status: '待复核' },
        { id: 'param-cutoff', label: '评分切点', value: '候选 682', status: '候选' },
        { id: 'param-missing', label: '缺失惩罚', value: '-18 分', status: '待确认' },
      ],
    },
    matrix: {
      title: '变量、当前值、来源与校验状态矩阵',
      columns: [
        { key: 'variable', label: '变量' },
        { key: 'current', label: '当前值' },
        { key: 'range', label: '允许区间' },
        { key: 'source', label: '来源' },
        { key: 'version', label: '版本' },
        { key: 'validation', label: '校验' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'param-row-001',
          cells: {
            variable: '通用设备残值率', current: '68%', range: '62%-74%', source: '本地合成评估样本', version: 'PARAM-2026Q3-c2', validation: '回溯样本不足', status: '候选待批',
          },
        },
        {
          id: 'param-row-002',
          cells: {
            variable: '单一承租人集中度', current: '15%', range: '10%-18%', source: '候选组合口径', version: 'PARAM-2026Q3-c2', validation: '压力测试未完成', status: '待模型治理',
          },
        },
        {
          id: 'param-row-003',
          cells: {
            variable: '信用评分切点', current: '682', range: '670-700', source: '候选政策映射', version: 'PARAM-2026Q3-c2', validation: '规则一致性通过', status: '待复核',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'rules-input', label: '规则集候选定稿', kind: 'policy', active: true },
        { id: 'param-core', label: '参数包 PARAM-c2', kind: 'parameter', active: true },
        { id: 'param-agent', label: '候选依赖检查 Agent', kind: 'agent', active: true },
        { id: 'param-gate', label: '模型参数复核 Gate（徐朔）', kind: 'gate', active: true },
        { id: 'strategy-target', label: '量化策略', kind: 'target', active: false },
      ],
      edges: [
        { id: 'policy-model-e1', source: 'rules-input', target: 'param-agent', label: '输入规则约束' },
        { id: 'policy-model-e2', source: 'param-agent', target: 'param-core', label: '输出候选依赖' },
        { id: 'policy-model-e3', source: 'param-core', target: 'param-gate', label: '等待参数确认' },
        { id: 'policy-model-e4', source: 'param-gate', target: 'strategy-target', label: '确认后接续' },
      ],
    },
    indicators: [
      { label: '候选参数', value: '24 个', note: '本地候选，不可直接发布' },
      { label: '未完成校验', value: '3 项', note: '残值、集中度与压力测试' },
      { label: '模型权限', value: 'none', note: '徐朔确认后才进入策略' },
    ],
    evidenceGaps: ['设备残值校准记录不足。', '集中度压力测试未返回正式回执。'],
    nextActions: ['复核三个未完成校验项。', '确认参数区间与规则一致性。', '在参数复核 Gate 记录决定。'],
    currentSituation: '24 个参数已形成候选包，其中三个关键校验还没有正式回执。',
    whyMe: '徐朔负责模型治理；模型只做候选映射，authority=none。',
    aiCompleted: ['已生成参数依赖候选图。', '已识别缺失校验记录。'],
    primaryHumanAction: {
      action: '批准、退回或阻断候选参数包。',
      owner: '模型治理·徐朔',
      evidenceGap: '残值校准与集中度压力测试回执。',
      humanGate: '模型参数复核 Gate',
    },
    nextHandoff: {
      target: 'policy-strategy',
      receiver: '量化策略·沈知行',
      contextPacket: ['项目 FL-DEMO-001', '参数包 PARAM-2026Q3-c2', '未完成校验清单', '徐朔 Gate 决定', '策略接续目标'],
    },
    successReceiptCondition: '徐朔提交后 Receipt 必须列出批准参数、退回参数和阻断原因。',
  },
  'policy-strategy': {
    id: 'policy-strategy',
    type: 'policy-strategy-workspace',
    headline: '量化策略：三段决策阈值等待策略组定稿',
    objective: '把规则和参数转化为可回退的候选策略，并保留人工权限边界。',
    visualization: {
      type: '策略决策树',
      title: '客群与场景策略决策树',
      description: '本地合成策略树候选，阈值未验证，任何动作都需要人工授权。',
      items: [
        { id: 'strategy-standard', label: '标准直租', value: '评分≥700', status: '候选建议' },
        { id: 'strategy-review', label: '人工复核区', value: '670-699', status: '待确认' },
        { id: 'strategy-block', label: '阻断区', value: '评分<670', status: '候选规则' },
        { id: 'strategy-fallback', label: '失效回退', value: '规则 v2.3', status: '待授权' },
      ],
    },
    matrix: {
      title: '客群、触发阈值、动作与人工权限矩阵',
      columns: [
        { key: 'scene', label: '客群/场景' },
        { key: 'threshold', label: '触发阈值' },
        { key: 'action', label: '动作' },
        { key: 'authority', label: '人工权限' },
        { key: 'failure', label: '失效条件' },
        { key: 'evidence', label: '证据' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'strategy-row-001',
          cells: {
            scene: 'AAA 制造客户直租', threshold: '评分≥700 且集中度≤15%', action: '建议进入标准信审', authority: '沈知行批准', failure: '规则版本变更', evidence: '候选策略说明', status: '待定稿',
          },
        },
        {
          id: 'strategy-row-002',
          cells: {
            scene: '民营主体售后回租', threshold: '评分670-699', action: '转人工复核', authority: '沈知行与周宁共同确认', failure: '设备评估缺口', evidence: '候选组合快照', status: '待授权',
          },
        },
        {
          id: 'strategy-row-003',
          cells: {
            scene: '新建主体大额项目', threshold: '评分<670 或预算缺口', action: '阻断并说明缺口', authority: '政策委员会批准解除', failure: '证据更新后失效', evidence: '候选阻断清单', status: '候选阻断',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'params-input', label: '参数包候选', kind: 'parameter', active: true },
        { id: 'strategy-tree', label: '三段策略树', kind: 'strategy', active: true },
        { id: 'strategy-agent', label: '候选冲突检查 Agent', kind: 'agent', active: true },
        { id: 'strategy-gate', label: '策略复核 Gate（沈知行）', kind: 'gate', active: true },
        { id: 'release-target', label: '版本发布', kind: 'target', active: false },
      ],
      edges: [
        { id: 'policy-strategy-e1', source: 'params-input', target: 'strategy-agent', label: '输入参数边界' },
        { id: 'policy-strategy-e2', source: 'strategy-agent', target: 'strategy-tree', label: '输出候选树' },
        { id: 'policy-strategy-e3', source: 'strategy-tree', target: 'strategy-gate', label: '等待策略授权' },
        { id: 'policy-strategy-e4', source: 'strategy-gate', target: 'release-target', label: '定稿后发布' },
      ],
    },
    indicators: [
      { label: '策略分支', value: '3 段', note: '本地候选，未验证' },
      { label: '冲突提示', value: '1 项', note: '售后回租与集中度需复核' },
      { label: '自动执行权', value: '0%', note: '模型 authority=none' },
    ],
    evidenceGaps: ['售后回租失效条件缺少业务确认。', '压力情景下的阈值证据不足。'],
    nextActions: ['确认三段阈值与回退版本。', '补齐售后回租失效依据。', '在策略 Gate 决定是否可发布。'],
    currentSituation: '策略树已有候选分支，但压力情景和回退依据尚未确认。',
    whyMe: '沈知行负责量化策略；模型只能提出候选阈值，authority=none。',
    aiCompleted: ['已构建候选决策树。', '已标注一处理论冲突。'],
    primaryHumanAction: {
      action: '确认策略分支、人工权限和失效条件。',
      owner: '量化策略·沈知行',
      evidenceGap: '压力测试与售后回租业务依据。',
      humanGate: '策略复核 Gate',
    },
    nextHandoff: {
      target: 'policy-release',
      receiver: '版本发布·陆一鸣',
      contextPacket: ['项目 FL-DEMO-001', '候选策略树 STG-c1', '冲突说明', '沈知行授权状态', '发布接续目标'],
    },
    successReceiptCondition: '沈知行提交后 Receipt 必须包含策略版本、授权人和可回退点。',
  },
  'policy-release': {
    id: 'policy-release',
    type: 'policy-release-workspace',
    headline: '版本发布：V3 候选缺少回执与回退授权',
    objective: '检查版本血缘、影响范围和回退点，确保未验证版本不能自动生效。',
    visualization: {
      type: '版本血缘与回滚画布',
      title: '政策版本血缘与回滚画布',
      description: '本地合成版本血缘候选，发布状态未验证，不表示生产已经接入。',
      items: [
        { id: 'release-v1', label: 'V1', value: '已归档基线', status: '本地历史' },
        { id: 'release-v2', label: 'V2', value: '当前候选对照', status: '未验证' },
        { id: 'release-v3', label: 'V3', value: '待发布候选', status: '缺回执' },
        { id: 'release-rollback', label: '回退点', value: 'V2-tag-0819', status: '待授权' },
      ],
    },
    matrix: {
      title: 'V1/V2/V3 差异、发布人与回退点矩阵',
      columns: [
        { key: 'version', label: '版本' },
        { key: 'diff', label: '差异' },
        { key: 'impact', label: '影响范围' },
        { key: 'publisher', label: '发布人' },
        { key: 'receipt', label: '回执' },
        { key: 'rollback', label: '回退点' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'release-row-001',
          cells: {
            version: 'V1-2025Q4', diff: '基础准入规则', impact: '通用直租', publisher: '政策委员会', receipt: '本地归档', rollback: '无', status: '历史候选',
          },
        },
        {
          id: 'release-row-002',
          cells: {
            version: 'V2-2026Q2', diff: '增加医疗与售后回租限制', impact: '3 类客群', publisher: '周宁', receipt: '候选回执', rollback: 'V1-tag-1201', status: '未验证',
          },
        },
        {
          id: 'release-row-003',
          cells: {
            version: 'V3-2026Q3', diff: '新增集中度与残值参数', impact: '政策、信审与资产', publisher: '陆一鸣待批', receipt: '缺失', rollback: 'V2-tag-0819', status: '阻断',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'strategy-input', label: '策略树候选', kind: 'strategy', active: true },
        { id: 'release-line', label: 'V1-V3 血缘', kind: 'version', active: true },
        { id: 'release-agent', label: '候选血缘检查 Agent', kind: 'agent', active: true },
        { id: 'release-gate', label: '发布复核 Gate（陆一鸣）', kind: 'gate', active: true },
        { id: 'monitor-target', label: '效果监测', kind: 'target', active: false },
      ],
      edges: [
        { id: 'policy-release-e1', source: 'strategy-input', target: 'release-agent', label: '输入候选变更' },
        { id: 'policy-release-e2', source: 'release-agent', target: 'release-line', label: '生成血缘差异' },
        { id: 'policy-release-e3', source: 'release-line', target: 'release-gate', label: '等待发布授权' },
        { id: 'policy-release-e4', source: 'release-gate', target: 'monitor-target', label: '批准后监测' },
      ],
    },
    indicators: [
      { label: '待发布版本', value: 'V3', note: '候选状态，无生产回执' },
      { label: '影响对象', value: '3 个板块', note: '需要变更说明确认' },
      { label: '发布权', value: '0%', note: '模型 authority=none' },
    ],
    evidenceGaps: ['V3 发布回执缺失。', '回退授权人尚未确认。'],
    nextActions: ['补录 V3 发布回执模板。', '确认 V2 回退点可用。', '由陆一鸣决定发布或阻断。'],
    currentSituation: 'V3 已形成候选包，但发布回执和回退授权都未完成。',
    whyMe: '陆一鸣控制版本发布；模型只能比对血缘，authority=none。',
    aiCompleted: ['已抽取 V1-V3 差异候选。', '已标出缺失回执。'],
    primaryHumanAction: {
      action: '批准发布、退回修改或阻断 V3。',
      owner: '版本发布·陆一鸣',
      evidenceGap: '正式发布回执与回退授权。',
      humanGate: '发布复核 Gate',
    },
    nextHandoff: {
      target: 'policy-monitor',
      receiver: '效果监测·方遥',
      contextPacket: ['项目 FL-DEMO-001', '候选版本 V3', '影响范围清单', '回退点 V2-tag-0819', '陆一鸣决定'],
    },
    successReceiptCondition: '陆一鸣提交后 Receipt 必须给出发布状态、时间戳和回退点。',
  },
  'policy-monitor': {
    id: 'policy-monitor',
    type: 'policy-monitor-workspace',
    headline: '效果监测：候选指标仅完成初始抽取',
    objective: '建立策略命中、误报和漂移的候选观察闭环，等待监测口径确认。',
    visualization: {
      type: '策略反馈闭环',
      title: '策略命中与漂移反馈闭环',
      description: '本地合成监测闭环候选，样本窗口未冻结，结果不能代表线上效果。',
      items: [
        { id: 'monitor-hit', label: '命中', value: '候选 78%', status: '样本不足' },
        { id: 'monitor-false', label: '误报', value: '候选 12%', status: '待核实' },
        { id: 'monitor-drift', label: '漂移', value: 'PSI 候选 0.09', status: '待复核' },
        { id: 'monitor-window', label: '样本窗口', value: '08-01 至 08-20', status: '未冻结' },
      ],
    },
    matrix: {
      title: '命中、误报、漂移与 Owner 调整建议矩阵',
      columns: [
        { key: 'metric', label: '指标' },
        { key: 'hit', label: '命中' },
        { key: 'false', label: '误报' },
        { key: 'drift', label: '漂移' },
        { key: 'window', label: '样本窗口' },
        { key: 'owner', label: 'Owner' },
        { key: 'advice', label: '调整建议' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'monitor-row-001',
          cells: {
            metric: '标准直租命中', hit: '82%', false: '9%', drift: 'PSI 0.07', window: '08-01 至 08-20', owner: '方遥', advice: '继续观察', status: '候选',
          },
        },
        {
          id: 'monitor-row-002',
          cells: {
            metric: '售后回租复核', hit: '71%', false: '16%', drift: 'PSI 0.12', window: '08-01 至 08-20', owner: '方遥与沈知行', advice: '补充压力样本', status: '待确认',
          },
        },
        {
          id: 'monitor-row-003',
          cells: {
            metric: '医疗设备阻断', hit: '64%', false: '18%', drift: 'PSI 0.15', window: '样本不足', owner: '方遥', advice: '暂停阈值调整', status: '待复核',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'release-input', label: '候选版本 V3', kind: 'version', active: true },
        { id: 'monitor-loop', label: '反馈闭环候选', kind: 'monitor', active: true },
        { id: 'monitor-agent', label: '候选指标抽取 Agent', kind: 'agent', active: true },
        { id: 'monitor-gate', label: '监测口径 Gate（方遥）', kind: 'gate', active: true },
        { id: 'credit-target', label: '信审模型解析', kind: 'target', active: false },
      ],
      edges: [
        { id: 'policy-monitor-e1', source: 'release-input', target: 'monitor-agent', label: '提供候选版本' },
        { id: 'policy-monitor-e2', source: 'monitor-agent', target: 'monitor-loop', label: '生成候选指标' },
        { id: 'policy-monitor-e3', source: 'monitor-loop', target: 'monitor-gate', label: '等待口径确认' },
        { id: 'policy-monitor-e4', source: 'monitor-gate', target: 'credit-target', label: '跨板块接续' },
      ],
    },
    indicators: [
      { label: '样本天数', value: '20 天', note: '本地合成，窗口未冻结' },
      { label: '高漂移指标', value: '1 项', note: '医疗设备阻断 PSI 候选 0.15' },
      { label: '模型权限', value: 'none', note: '调整必须由方遥确认' },
    ],
    evidenceGaps: ['监测窗口尚未冻结。', '医疗设备样本量不足。'],
    nextActions: ['确认 08-01 至 08-20 样本口径。', '补充医疗设备对照组证据。', '由方遥批准监测基线。'],
    currentSituation: '候选指标显示售后与医疗场景漂移，但样本证据不足。',
    whyMe: '方遥负责效果口径；模型只能抽取候选指标，authority=none。',
    aiCompleted: ['已汇总候选命中与误报。', '已提示一个高漂移项。'],
    primaryHumanAction: {
      action: '冻结监测窗口并决定是否调整策略。',
      owner: '效果监测·方遥',
      evidenceGap: '冻结样本清单与医疗对照组。',
      humanGate: '监测口径 Gate',
    },
    nextHandoff: {
      target: 'credit-parse',
      receiver: '信审解析·顾青',
      contextPacket: ['项目 FL-DEMO-001', '候选监测基线', '高漂移说明', '冻结窗口待定', '信审材料接续目标'],
    },
    successReceiptCondition: '方遥提交后 Receipt 必须记录冻结窗口、指标版本和调整决定。',
  },
  'credit-parse': {
    id: 'credit-parse',
    type: 'credit-parse-workspace',
    headline: '模型解析：六份材料候选字段已进入核验队列',
    objective: '维护多模态解析管线候选输出，确保原始定位可追溯且不替代人工确认。',
    visualization: {
      type: '多模态解析管线',
      title: '信审材料解析管线',
      description: '本地合成材料解析候选，字段值未验证，必须由信审人员复核。',
      items: [
        { id: 'parse-contract', label: '租赁合同', value: '42 字段', status: '候选已抽取' },
        { id: 'parse-invoice', label: '设备发票', value: '18 字段', status: '候选已抽取' },
        { id: 'parse-audit', label: '审计报告', value: '27 字段', status: '待复核' },
        { id: 'parse-bank', label: '银行流水', value: '31 字段', status: '低可信' },
      ],
    },
    matrix: {
      title: '材料、候选值、可信度与原始定位矩阵',
      columns: [
        { key: 'material', label: '材料' },
        { key: 'field', label: '提取字段' },
        { key: 'candidate', label: '候选值' },
        { key: 'confidence', label: '可信度' },
        { key: 'location', label: '原始定位' },
        { key: 'verification', label: '核验状态' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'parse-row-001',
          cells: {
            material: '设备租赁合同', field: '租赁物总价', candidate: '人民币 1,280 万元', confidence: '94%', location: 'PDF 第4页 2.1 条', verification: '待顾青确认', status: '候选',
          },
        },
        {
          id: 'parse-row-002',
          cells: {
            material: '设备发票', field: '序列号', candidate: 'NC-2026-08841', confidence: '91%', location: '发票行项 3', verification: '待与物流单核对', status: '候选',
          },
        },
        {
          id: 'parse-row-003',
          cells: {
            material: '银行流水', field: '月均经营回流', candidate: '人民币 386 万元', confidence: '58%', location: '流水第11-13页', verification: '低可信待补证', status: '待核验',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'material-input', label: '六份合成材料', kind: 'evidence', active: true },
        { id: 'parse-pipeline', label: '候选解析管线', kind: 'agent', active: true },
        { id: 'parse-reviewer', label: '候选字段核对（顾青）', kind: 'human', active: true },
        { id: 'parse-gate', label: '解析交付 Gate', kind: 'gate', active: true },
        { id: 'fact-target', label: '事实核验', kind: 'target', active: false },
      ],
      edges: [
        { id: 'credit-parse-e1', source: 'material-input', target: 'parse-pipeline', label: '输入候选影像' },
        { id: 'credit-parse-e2', source: 'parse-pipeline', target: 'parse-reviewer', label: '输出候选字段' },
        { id: 'credit-parse-e3', source: 'parse-reviewer', target: 'parse-gate', label: '完成人工核对' },
        { id: 'credit-parse-e4', source: 'parse-gate', target: 'fact-target', label: '交付核验' },
      ],
    },
    indicators: [
      { label: '候选字段', value: '118 个', note: '本地候选，未验证' },
      { label: '低可信字段', value: '9 个', note: '银行流水占 6 个' },
      { label: '模型权限', value: 'none', note: '只做候选解析' },
    ],
    evidenceGaps: ['银行流水缺少完整页码定位。', '发票序列号未与现场照片核对。'],
    nextActions: ['核对低可信字段的原始页码。', '提交发票与合同一致性问题。', '由顾青确认可进入事实核验的字段。'],
    currentSituation: '解析完成率 100%，但候选字段仍需人工核验，不能视为正式事实。',
    whyMe: '顾青负责信审材料核对；模型 authority=none，仅输出候选值。',
    aiCompleted: ['已抽取 118 个候选字段。', '已保留原始页码定位。'],
    primaryHumanAction: {
      action: '确认或退回候选字段清单。',
      owner: '信审解析·顾青',
      evidenceGap: '完整流水页码与设备照片。',
      humanGate: '解析交付 Gate',
    },
    nextHandoff: {
      target: 'credit-fact',
      receiver: '事实核验·白棠',
      contextPacket: ['项目 FL-DEMO-001', '候选字段包', '低可信清单', '原始定位索引', '事实核验接续目标'],
    },
    successReceiptCondition: '顾青提交后 Receipt 必须列出通过字段、退回字段和补证要求。',
  },
  'credit-fact': {
    id: 'credit-fact',
    type: 'credit-fact-workspace',
    headline: '事实核验：三组候选事实存在证据冲突',
    objective: '比对来源、冲突和证据，防止候选事实被误认为已确认事实。',
    visualization: {
      type: '事实冲突图',
      title: '合同、发票与流水事实冲突图',
      description: '本地合成事实冲突候选，正式状态未冻结，需白棠完成人工核验。',
      items: [
        { id: 'fact-amount', label: '设备金额', value: '合同与报价差 20 万元', status: '冲突' },
        { id: 'fact-serial', label: '序列号', value: '1 处不一致', status: '待核' },
        { id: 'fact-cash', label: '经营回流', value: '流水口径不稳', status: '低可信' },
        { id: 'fact-insurance', label: '保险受益人', value: '待补充批单', status: '缺口' },
      ],
    },
    matrix: {
      title: '事实、来源、冲突与正式状态矩阵',
      columns: [
        { key: 'fact', label: '事实' },
        { key: 'source', label: '来源' },
        { key: 'conflict', label: '冲突' },
        { key: 'evidence', label: '证据' },
        { key: 'verifier', label: '核验人' },
        { key: 'formal', label: '正式状态' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'fact-row-001',
          cells: {
            fact: '租赁物总价', source: '合同与供应商报价', conflict: '差额 20 万元', evidence: '候选合同第4页、报价单行8', verifier: '白棠', formal: '未确认', status: '冲突待决',
          },
        },
        {
          id: 'fact-row-002',
          cells: {
            fact: '设备序列号', source: '发票、合同与照片', conflict: '发票行项少一位校验码', evidence: '候选发票与现场照片', verifier: '白棠与石澜', formal: '未确认', status: '待补证',
          },
        },
        {
          id: 'fact-row-003',
          cells: {
            fact: '月均经营回流', source: '银行流水', conflict: '三个月波动超过 40%', evidence: '候选流水第11-13页', verifier: '白棠', formal: '未确认', status: '低可信',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'parse-input', label: '候选字段包', kind: 'evidence', active: true },
        { id: 'fact-core', label: '三组冲突事实', kind: 'fact', active: true },
        { id: 'fact-agent', label: '候选冲突检查 Agent', kind: 'agent', active: true },
        { id: 'fact-gate', label: '事实核验 Gate（白棠）', kind: 'gate', active: true },
        { id: 'link-target', label: '证据回链', kind: 'target', active: false },
      ],
      edges: [
        { id: 'credit-fact-e1', source: 'parse-input', target: 'fact-agent', label: '输入候选字段' },
        { id: 'credit-fact-e2', source: 'fact-agent', target: 'fact-core', label: '识别候选冲突' },
        { id: 'credit-fact-e3', source: 'fact-core', target: 'fact-gate', label: '等待人工裁决' },
        { id: 'credit-fact-e4', source: 'fact-gate', target: 'link-target', label: '确认后回链' },
      ],
    },
    indicators: [
      { label: '冲突事实', value: '3 组', note: '候选冲突，未裁决' },
      { label: '确认事实', value: '11 项', note: '均带具名人工记录' },
      { label: '模型权限', value: 'none', note: '不得确认事实' },
    ],
    evidenceGaps: ['设备差价缺少供应商说明。', '保险受益人批单缺失。'],
    nextActions: ['要求供应商补充差价说明。', '核验序列号校验码。', '由白棠裁决冲突事实。'],
    currentSituation: '11 项事实已确认，三组关键冲突仍阻断正式结论。',
    whyMe: '白棠维护事实口径；模型只做候选比对，authority=none。',
    aiCompleted: ['已识别三组候选冲突。', '已汇总来源页码与缺口。'],
    primaryHumanAction: {
      action: '裁决三组冲突并决定补证要求。',
      owner: '事实核验·白棠',
      evidenceGap: '供应商差价说明与保险批单。',
      humanGate: '事实核验 Gate',
    },
    nextHandoff: {
      target: 'credit-link',
      receiver: '证据回链·秦峄',
      contextPacket: ['项目 FL-DEMO-001', '冲突事实清单', '已确认事实集', '补证要求', '证据回链接续目标'],
    },
    successReceiptCondition: '白棠提交后 Receipt 必须记录每项事实的确认、退回或阻断状态。',
  },
  'credit-link': {
    id: 'credit-link',
    type: 'credit-link-workspace',
    headline: '证据回链：两项结论缺少可复核血缘',
    objective: '把候选结论与原始证据、页码和时效绑定，暴露不可回链缺口。',
    visualization: {
      type: '结论—证据血缘图',
      title: '信审结论与证据血缘图',
      description: '本地合成血缘候选，结论影响未验证，回链完整度待人工检查。',
      items: [
        { id: 'link-revenue', label: '经营回流结论', value: '3 份流水', status: '部分回链' },
        { id: 'link-equipment', label: '设备归属结论', value: '合同与发票', status: '待核验' },
        { id: 'link-insurance', label: '保险有效结论', value: '缺批单', status: '不可回链' },
        { id: 'link-expiry', label: '时效', value: '2 项临期', status: '候选提醒' },
      ],
    },
    matrix: {
      title: '结论、证据、定位、时效与影响矩阵',
      columns: [
        { key: 'conclusion', label: '结论' },
        { key: 'evidence', label: '证据' },
        { key: 'location', label: '页码/字段定位' },
        { key: 'timeliness', label: '时效' },
        { key: 'gap', label: '缺口' },
        { key: 'impact', label: '影响' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'link-row-001',
          cells: {
            conclusion: '经营回流可覆盖租金', evidence: '三个月银行流水', location: '流水第11-13页转入汇总', timeliness: '至2026-08-20', gap: '缺少第四个月流水', impact: '候选额度下调', status: '待人工复核',
          },
        },
        {
          id: 'link-row-002',
          cells: {
            conclusion: '设备归承租人运营使用', evidence: '现场照片与物流单', location: '照片 EXIF 与物流节点4', timeliness: '至2026-08-31', gap: '序列号校验码缺失', impact: '设备归属待定', status: '候选',
          },
        },
        {
          id: 'link-row-003',
          cells: {
            conclusion: '保险受益人合规', evidence: '保险单', location: '保单第2页受益人栏', timeliness: '至2026-09-30', gap: '受益人批单缺失', impact: '起租前置阻断', status: '不可回链',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'fact-input', label: '事实核验结果', kind: 'fact', active: true },
        { id: 'link-lineage', label: '结论证据血缘', kind: 'evidence', active: true },
        { id: 'link-agent', label: '候选血缘检查 Agent', kind: 'agent', active: true },
        { id: 'link-gate', label: '回链复核 Gate（秦峄）', kind: 'gate', active: true },
        { id: 'coordinate-target', label: '协调沟通', kind: 'target', active: false },
      ],
      edges: [
        { id: 'credit-link-e1', source: 'fact-input', target: 'link-agent', label: '输入待链结论' },
        { id: 'credit-link-e2', source: 'link-agent', target: 'link-lineage', label: '生成候选血缘' },
        { id: 'credit-link-e3', source: 'link-lineage', target: 'link-gate', label: '等待完整性确认' },
        { id: 'credit-link-e4', source: 'link-gate', target: 'coordinate-target', label: '移交补证协调' },
      ],
    },
    indicators: [
      { label: '可回链结论', value: '14 项', note: '候选完整度，未验证' },
      { label: '不可回链', value: '2 项', note: '保险批单与序列号' },
      { label: '临期证据', value: '2 项', note: '需人工跟踪' },
    ],
    evidenceGaps: ['保险受益人批单缺失。', '第四个月经营流水未提供。'],
    nextActions: ['标记两项不可回链结论。', '跟踪临期证据的补交责任。', '由秦峄确认血缘完整性。'],
    currentSituation: '多数结论已有候选血缘，保险与序列号结论仍不能复核。',
    whyMe: '秦峄负责证据血缘；模型只生成候选链接，authority=none。',
    aiCompleted: ['已生成结论血缘候选图。', '已识别临期证据。'],
    primaryHumanAction: {
      action: '确认血缘完整或发起定点补证。',
      owner: '证据回链·秦峄',
      evidenceGap: '保险批单和第四个月流水。',
      humanGate: '回链复核 Gate',
    },
    nextHandoff: {
      target: 'credit-coordinate',
      receiver: '协调沟通·林澈',
      contextPacket: ['项目 FL-DEMO-001', '不可回链清单', '临期证据表', '补证责任人候选', '协调接续目标'],
    },
    successReceiptCondition: '秦峄提交后 Receipt 必须列出每条结论的回链状态和补证任务。',
  },
  'credit-coordinate': {
    id: 'credit-coordinate',
    type: 'credit-coordinate-workspace',
    headline: '协调沟通：两项补证请求尚未取得正式回执',
    objective: '追踪人与 Agent 的接续任务、截止时间和上下文版本，避免沟通失序。',
    visualization: {
      type: '人与Agent接续图',
      title: '信审补证协调接续图',
      description: '本地合成协调链候选，回执未收到，责任与时限需业务组确认。',
      items: [
        { id: 'coord-insurer', label: '保险批单', value: '待保险公司回执', status: '已发起' },
        { id: 'coord-supplier', label: '供应商说明', value: '待盖章文件', status: '待接收' },
        { id: 'coord-bank', label: '补充流水', value: '待客户授权', status: '候选请求' },
        { id: 'coord-context', label: '上下文版本', value: 'CTX-20260820-03', status: '候选' },
      ],
    },
    matrix: {
      title: '问题、责任人、截止时间、上下文版本与回执矩阵',
      columns: [
        { key: 'issue', label: '问题' },
        { key: 'initiator', label: '发起人' },
        { key: 'responsible', label: '责任人' },
        { key: 'deadline', label: '截止时间' },
        { key: 'context', label: '上下文版本' },
        { key: 'receipt', label: '回执' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'coord-row-001',
          cells: {
            issue: '保险受益人批单', initiator: '秦峄', responsible: '客户财务联系人周敏', deadline: '2026-08-22', context: 'CTX-20260820-03', receipt: '未收到', status: '待外部回复',
          },
        },
        {
          id: 'coord-row-002',
          cells: {
            issue: '设备差价说明', initiator: '白棠', responsible: '供应商商务刘兆', deadline: '2026-08-23', context: 'CTX-20260820-03', receipt: '候选口头说明', status: '待正式文件',
          },
        },
        {
          id: 'coord-row-003',
          cells: {
            issue: '第四个月流水授权', initiator: '林澈', responsible: '承租人财务部', deadline: '2026-08-25', context: 'CTX-20260820-04-candidate', receipt: '未发起正式请求', status: '候选',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'link-input', label: '证据缺口清单', kind: 'evidence', active: true },
        { id: 'coord-board', label: '补证协调任务', kind: 'context', active: true },
        { id: 'coord-agent', label: '候选提醒 Agent', kind: 'agent', active: true },
        { id: 'coord-gate', label: '协调确认 Gate（林澈）', kind: 'gate', active: true },
        { id: 'review-target', label: '人工复核', kind: 'target', active: false },
      ],
      edges: [
        { id: 'credit-coordinate-e1', source: 'link-input', target: 'coord-agent', label: '生成候选提醒' },
        { id: 'credit-coordinate-e2', source: 'coord-agent', target: 'coord-board', label: '更新候选任务' },
        { id: 'credit-coordinate-e3', source: 'coord-board', target: 'coord-gate', label: '等待业务确认' },
        { id: 'credit-coordinate-e4', source: 'coord-gate', target: 'review-target', label: '移交复核' },
      ],
    },
    indicators: [
      { label: '待外部回执', value: '3 项', note: '均未验证' },
      { label: '最早截止', value: '08-22', note: '保险批单任务' },
      { label: 'Agent 权限', value: '提醒', note: '只能生成候选沟通' },
    ],
    evidenceGaps: ['外部批单回执缺失。', '流水授权请求尚未正式发起。'],
    nextActions: ['向保险公司确认批单时限。', '将供应商口头说明升级为盖章文件。', '由林澈批准流水授权请求。'],
    currentSituation: '三项补证任务已识别，但没有一项取得可验证回执。',
    whyMe: '林澈负责信审内外协调；模型只能整理候选提醒，authority=none。',
    aiCompleted: ['已汇总三项补证缺口。', '已生成候选截止时间提醒。'],
    primaryHumanAction: {
      action: '确认补证责任人、时限和正式请求文本。',
      owner: '协调沟通·林澈',
      evidenceGap: '外部回执与客户授权文件。',
      humanGate: '协调确认 Gate',
    },
    nextHandoff: {
      target: 'credit-review',
      receiver: '人工复核·罗砚',
      contextPacket: ['项目 FL-DEMO-001', '补证任务清单', '外部回执状态', '上下文版本 CTX-03', '复核接续目标'],
    },
    successReceiptCondition: '林澈提交后 Receipt 必须记录每项任务的确认文本、责任人和时限。',
  },
  'credit-review': {
    id: 'credit-review',
    type: 'credit-review-workspace',
    headline: '人工复核：等待罗砚基于候选判断作出决定',
    objective: '呈现支持与反对证据、候选结论和理由，确保复核人拥有完整决定权。',
    visualization: {
      type: '候选判断—人工决定图',
      title: '信审候选判断与人工决定图',
      description: '本地合成判断候选，未接集团系统，人工结论尚无正式 Receipt。',
      items: [
        { id: 'review-quota', label: '建议额度', value: '候选 900 万元', status: '待人工决定' },
        { id: 'review-condition', label: '前置条件', value: '批单与差价说明', status: '缺口' },
        { id: 'review-term', label: '建议期限', value: '36 期', status: '候选' },
        { id: 'review-decision', label: '人工结论', value: '未作出', status: '等待 Gate' },
      ],
    },
    matrix: {
      title: '判断项、模型候选、支持反对证据与人工结论矩阵',
      columns: [
        { key: 'judgment', label: '判断项' },
        { key: 'model', label: '模型候选' },
        { key: 'support', label: '支持证据' },
        { key: 'oppose', label: '反对证据' },
        { key: 'decision', label: '人工结论' },
        { key: 'reason', label: '理由' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'review-row-001',
          cells: {
            judgment: '授信额度', model: '候选 900 万元', support: '确认合同与部分流水', oppose: '月度回流波动 40%', decision: '未决定', reason: '等待补证回执', status: '待罗砚复核',
          },
        },
        {
          id: 'review-row-002',
          cells: {
            judgment: '设备归属', model: '候选通过', support: '现场照片与物流单', oppose: '序列号校验码缺失', decision: '未决定', reason: '需供应商正式说明', status: '待复核',
          },
        },
        {
          id: 'review-row-003',
          cells: {
            judgment: '起租前置条件', model: '候选暂缓', support: '保险单已提供', oppose: '受益人批单缺失', decision: '未决定', reason: '外部回执未收到', status: '阻断',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'coord-input', label: '补证协调状态', kind: 'context', active: true },
        { id: 'review-candidate', label: '候选信审结论', kind: 'agent', active: true },
        { id: 'review-human', label: '复核人罗砚', kind: 'human', active: true },
        { id: 'review-gate', label: '信审人工复核 Gate', kind: 'gate', active: true },
        { id: 'commerce-target', label: '商务合同审批', kind: 'target', active: false },
      ],
      edges: [
        { id: 'credit-review-e1', source: 'coord-input', target: 'review-candidate', label: '输入补证状态' },
        { id: 'credit-review-e2', source: 'review-candidate', target: 'review-human', label: '提供候选建议' },
        { id: 'credit-review-e3', source: 'review-human', target: 'review-gate', label: '行使决定权' },
        { id: 'credit-review-e4', source: 'review-gate', target: 'commerce-target', label: '跨板块移交' },
      ],
    },
    indicators: [
      { label: '候选额度', value: '900 万元', note: '未验证，不构成授信' },
      { label: '前置缺口', value: '2 项', note: '批单与差价说明' },
      { label: '模型权限', value: 'none', note: '罗砚拥有唯一决定权' },
    ],
    evidenceGaps: ['保险受益人批单未收到。', '设备差价正式说明缺失。'],
    nextActions: ['查看支持与反对证据全文。', '决定通过、暂缓或否决候选结论。', '在复核 Gate 记录理由。'],
    currentSituation: '信审候选已完整呈现，但人工结论和正式回执均未形成。',
    whyMe: '罗砚是信审复核责任人；模型 authority=none，不能代替决定。',
    aiCompleted: ['已整理支持与反对证据。', '已生成候选额度与期限。'],
    primaryHumanAction: {
      action: '作出通过、暂缓或否决的信审决定。',
      owner: '人工复核·罗砚',
      evidenceGap: '外部批单与供应商差价说明。',
      humanGate: '信审人工复核 Gate',
    },
    nextHandoff: {
      target: 'commerce-contract',
      receiver: '合同审批·贺临',
      contextPacket: ['项目 FL-DEMO-001', '候选信审结论', '前置条件清单', '罗砚决定', '商务接续目标'],
    },
    successReceiptCondition: '罗砚提交或否决后 Receipt 必须包含决定、理由、时间和前置条件。',
  },
  'commerce-contract': {
    id: 'commerce-contract',
    type: 'commerce-contract-workspace',
    headline: '合同审批：付款与交付条款存在两处偏差',
    objective: '核对合同条款、信审条件和法务意见，确保偏差在人工 Gate 中处理。',
    visualization: {
      type: '合同义务与条件图',
      title: '商务合同义务与条件图',
      description: '本地合成合同候选条款，偏差未裁决，合同不具生产签署状态。',
      items: [
        { id: 'contract-payment', label: '付款节点', value: '3 期候选', status: '偏差待定' },
        { id: 'contract-delivery', label: '交付义务', value: '供应商负责', status: '待确认' },
        { id: 'contract-condition', label: '信审条件', value: '2 项未落款', status: '缺口' },
        { id: 'contract-legal', label: '法务意见', value: '候选通过', status: '待复签' },
      ],
    },
    matrix: {
      title: '条款、信审条件、偏差、法务意见与 Owner 矩阵',
      columns: [
        { key: 'clause', label: '条款' },
        { key: 'condition', label: '信审条件' },
        { key: 'deviation', label: '偏差' },
        { key: 'legal', label: '法务意见' },
        { key: 'owner', label: 'Owner' },
        { key: 'evidence', label: '证据' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'contract-row-001',
          cells: {
            clause: '预付款 20%', condition: '信审通过后支付', deviation: '缺少罗砚决定编号', legal: '候选无障碍', owner: '贺临', evidence: '候选合同第6页', status: '待落款',
          },
        },
        {
          id: 'contract-row-002',
          cells: {
            clause: '设备交付', condition: '供应商负责运输与安装', deviation: '现场安装责任未明确', legal: '建议补充附件', owner: '贺临与石澜', evidence: '候选交付方案', status: '待修订',
          },
        },
        {
          id: 'contract-row-003',
          cells: {
            clause: '保险维持', condition: '受益人合规', deviation: '批单未取得', legal: '暂不满足', owner: '林澈', evidence: '候选保单', status: '阻断',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'credit-input', label: '信审前置条件', kind: 'context', active: true },
        { id: 'contract-core', label: '合同义务候选', kind: 'contract', active: true },
        { id: 'contract-agent', label: '候选条款比对 Agent', kind: 'agent', active: true },
        { id: 'contract-gate', label: '合同审批 Gate（贺临）', kind: 'gate', active: true },
        { id: 'logistics-target', label: '物流查验', kind: 'target', active: false },
      ],
      edges: [
        { id: 'commerce-contract-e1', source: 'credit-input', target: 'contract-agent', label: '输入前置条件' },
        { id: 'commerce-contract-e2', source: 'contract-agent', target: 'contract-core', label: '生成条款偏差' },
        { id: 'commerce-contract-e3', source: 'contract-core', target: 'contract-gate', label: '等待审批' },
        { id: 'commerce-contract-e4', source: 'contract-gate', target: 'logistics-target', label: '批准后查验' },
      ],
    },
    indicators: [
      { label: '待批条款', value: '18 条', note: '候选条款，未验证' },
      { label: '关键偏差', value: '2 处', note: '安装责任与保险批单' },
      { label: '模型权限', value: 'none', note: '贺临决定合同放行' },
    ],
    evidenceGaps: ['罗砚决定编号未回填。', '现场安装责任附件缺失。'],
    nextActions: ['回填信审决定与前置条件。', '修订安装责任附件。', '由贺临审批候选合同。'],
    currentSituation: '合同已按信审条件生成候选，但两处偏差阻止签署。',
    whyMe: '贺临负责商务合同；模型只做候选比对，authority=none。',
    aiCompleted: ['已抽取合同义务候选。', '已比对信审前置条件。'],
    primaryHumanAction: {
      action: '批准、退回修订或阻断合同审批。',
      owner: '合同审批·贺临',
      evidenceGap: '信审决定编号和安装责任附件。',
      humanGate: '合同审批 Gate',
    },
    nextHandoff: {
      target: 'commerce-logistics',
      receiver: '物流查验·石澜',
      contextPacket: ['项目 FL-DEMO-001', '候选合同条款', '偏差处理决定', '交付责任清单', '物流接续目标'],
    },
    successReceiptCondition: '贺临提交后 Receipt 必须记录条款版本、偏差处理和签署前置条件。',
  },
  'commerce-logistics': {
    id: 'commerce-logistics',
    type: 'commerce-logistics-workspace',
    headline: '物流查验：设备运输完成两个候选节点',
    objective: '核对设备序列号、单据和现场证据，处理物流异常并明确责任人。',
    visualization: {
      type: '设备物流时间线',
      title: '设备出厂到现场物流时间线',
      description: '本地合成物流节点候选，现场证据未验证，不能证明设备已可起租。',
      items: [
        { id: 'logistics-factory', label: '出厂', value: '08-12', status: '候选完成' },
        { id: 'logistics-transit', label: '在途', value: '08-14 到达转运', status: '候选完成' },
        { id: 'logistics-site', label: '到场', value: '08-18', status: '待验收' },
        { id: 'logistics-install', label: '安装', value: '未开始', status: '异常' },
      ],
    },
    matrix: {
      title: '设备、物流节点、单据、现场证据与异常矩阵',
      columns: [
        { key: 'equipment', label: '设备/序列号' },
        { key: 'node', label: '物流节点' },
        { key: 'document', label: '单据' },
        { key: 'site', label: '现场证据' },
        { key: 'exception', label: '异常' },
        { key: 'responsible', label: '责任人' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'logistics-row-001',
          cells: {
            equipment: '数控机床 / NC-2026-08841', node: '出厂发运', document: '候选出厂单', site: '未到场', exception: '无', responsible: '供应商物流王璨', status: '候选完成',
          },
        },
        {
          id: 'logistics-row-002',
          cells: {
            equipment: '数控机床 / NC-2026-08841', node: '到场卸货', document: '候选运输签收单', site: '3 张现场照片', exception: '序列号校验码不清', responsible: '石澜', status: '待验收',
          },
        },
        {
          id: 'logistics-row-003',
          cells: {
            equipment: '数控机床 / NC-2026-08841', node: '安装调试', document: '安装方案附件缺失', site: '无', exception: '责任条款未签署', responsible: '供应商项目经理刘兆', status: '阻断',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'contract-input', label: '交付责任条款', kind: 'contract', active: true },
        { id: 'logistics-line', label: '设备物流时间线', kind: 'logistics', active: true },
        { id: 'logistics-agent', label: '候选单据检查 Agent', kind: 'agent', active: true },
        { id: 'logistics-gate', label: '物流查验 Gate（石澜）', kind: 'gate', active: true },
        { id: 'funding-target', label: '资金匹配', kind: 'target', active: false },
      ],
      edges: [
        { id: 'commerce-logistics-e1', source: 'contract-input', target: 'logistics-agent', label: '输入交付义务' },
        { id: 'commerce-logistics-e2', source: 'logistics-agent', target: 'logistics-line', label: '输出候选节点' },
        { id: 'commerce-logistics-e3', source: 'logistics-line', target: 'logistics-gate', label: '等待现场验收' },
        { id: 'commerce-logistics-e4', source: 'logistics-gate', target: 'funding-target', label: '通过后匹配资金' },
      ],
    },
    indicators: [
      { label: '完成节点', value: '2/5', note: '候选状态，未验证' },
      { label: '现场照片', value: '3 张', note: '序列号不清晰' },
      { label: '阻断节点', value: '安装', note: '责任附件缺失' },
    ],
    evidenceGaps: ['清晰序列号照片缺失。', '安装责任附件未签署。'],
    nextActions: ['补拍设备铭牌照片。', '确认安装责任人和时间。', '由石澜验收到场节点。'],
    currentSituation: '设备已到场候选记录，但清晰序列号和安装责任证据不足。',
    whyMe: '石澜负责物流查验；模型只检查候选单据，authority=none。',
    aiCompleted: ['已汇总物流节点候选。', '已发现序列号异常。'],
    primaryHumanAction: {
      action: '验收到场证据并处理安装异常。',
      owner: '物流查验·石澜',
      evidenceGap: '清晰铭牌照片和安装责任附件。',
      humanGate: '物流查验 Gate',
    },
    nextHandoff: {
      target: 'commerce-funding',
      receiver: '资金匹配·桑野',
      contextPacket: ['项目 FL-DEMO-001', '物流节点状态', '异常处理记录', '现场证据清单', '资金接续目标'],
    },
    successReceiptCondition: '石澜提交后 Receipt 必须记录每个节点的通过、异常和责任人。',
  },
  'commerce-funding': {
    id: 'commerce-funding',
    type: 'commerce-funding-workspace',
    headline: '资金匹配：候选方案缺少额度与前置确认',
    objective: '比较资金方案成本、期限和前置条件，确保可用额度由资金组人工确认。',
    visualization: {
      type: '资金方案匹配图',
      title: '资金方、成本与前置条件匹配图',
      description: '本地合成资金方案候选，额度未冻结，不表示任何资金方已承诺。',
      items: [
        { id: 'funding-bank', label: '方案 A', value: '年化候选 5.2%', status: '额度待确认' },
        { id: 'funding-lease', label: '方案 B', value: '年化候选 5.8%', status: '待复核' },
        { id: 'funding-term', label: '期限', value: '36 期候选', status: '待批准' },
        { id: 'funding-condition', label: '前置条件', value: '3 项', status: '未满足' },
      ],
    },
    matrix: {
      title: '资金方案、成本、期限、前置条件与匹配状态矩阵',
      columns: [
        { key: 'plan', label: '资金方/方案' },
        { key: 'cost', label: '成本' },
        { key: 'term', label: '期限' },
        { key: 'precondition', label: '前置条件' },
        { key: 'amount', label: '可用额度' },
        { key: 'status', label: '匹配状态' },
        { key: 'evidence', label: '证据' },
      ],
      rows: [
        {
          id: 'funding-row-001',
          cells: {
            plan: '银行信贷方案 A', cost: '候选年化 5.2%', term: '36 期', precondition: '合同签署与设备验收', amount: '待资金组确认', status: '候选待确认', evidence: '本地合成报价单',
          },
        },
        {
          id: 'funding-row-002',
          cells: {
            plan: '租赁资金方案 B', cost: '候选年化 5.8%', term: '42 期', precondition: '保险批单与残值承诺', amount: '候选 1,000 万元', status: '待复核', evidence: '候选资金条款',
          },
        },
        {
          id: 'funding-row-003',
          cells: {
            plan: '自有资金过渡', cost: '内部机会成本候选 4.8%', term: '12 期', precondition: '司库额度授权', amount: '候选 300 万元', status: '未授权', evidence: '候选司库说明',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'logistics-input', label: '设备验收状态', kind: 'logistics', active: true },
        { id: 'funding-plan', label: '候选资金方案', kind: 'funding', active: true },
        { id: 'funding-agent', label: '候选条件检查 Agent', kind: 'agent', active: true },
        { id: 'funding-gate', label: '资金匹配 Gate（桑野）', kind: 'gate', active: true },
        { id: 'payment-target', label: '付款核验', kind: 'target', active: false },
      ],
      edges: [
        { id: 'commerce-funding-e1', source: 'logistics-input', target: 'funding-agent', label: '输入验收约束' },
        { id: 'commerce-funding-e2', source: 'funding-agent', target: 'funding-plan', label: '输出候选匹配' },
        { id: 'commerce-funding-e3', source: 'funding-plan', target: 'funding-gate', label: '等待额度确认' },
        { id: 'commerce-funding-e4', source: 'funding-gate', target: 'payment-target', label: '匹配后核验' },
      ],
    },
    indicators: [
      { label: '候选方案', value: '3 个', note: '本地合成，未承诺' },
      { label: '未满足条件', value: '3 项', note: '签署、验收与批单' },
      { label: '模型权限', value: 'none', note: '桑野确认资金方案' },
    ],
    evidenceGaps: ['银行可用额度证明缺失。', '保险批单尚未取得。'],
    nextActions: ['请求资金组冻结候选额度。', '核对方案 B 残值承诺。', '由桑野批准匹配路径。'],
    currentSituation: '方案 A 成本最低候选，但额度与前置条件都未满足。',
    whyMe: '桑野负责资金匹配；模型只做候选比较，authority=none。',
    aiCompleted: ['已生成三方案成本候选。', '已识别前置条件缺口。'],
    primaryHumanAction: {
      action: '选择、退回或阻断候选资金方案。',
      owner: '资金匹配·桑野',
      evidenceGap: '可用额度证明和保险批单。',
      humanGate: '资金匹配 Gate',
    },
    nextHandoff: {
      target: 'commerce-payment-check',
      receiver: '付款核验·柴可',
      contextPacket: ['项目 FL-DEMO-001', '候选方案选择', '额度状态', '前置条件清单', '付款接续目标'],
    },
    successReceiptCondition: '桑野提交后 Receipt 必须锁定方案、成本、期限和额度回执。',
  },
  'commerce-payment-check': {
    id: 'commerce-payment-check',
    type: 'commerce-payment-check-workspace',
    headline: '付款核验：首期付款等待完整证据链',
    objective: '核验付款条件、证据和收款账户，未通过前不得生成任何付款动作。',
    visualization: {
      type: '付款条件依赖图',
      title: '首期付款条件依赖图',
      description: '本地合成付款依赖候选，账户未验证，付款状态为零进度。',
      items: [
        { id: 'payment-contract', label: '合同生效', value: '未签署', status: '未满足' },
        { id: 'payment-acceptance', label: '设备验收', value: '未通过', status: '未满足' },
        { id: 'payment-account', label: '收款账户', value: '候选户名待核', status: '待验证' },
        { id: 'payment-invoice', label: '预付款发票', value: '未收到', status: '缺口' },
      ],
    },
    matrix: {
      title: '付款条件、证据、收款账户、核验人与缺口矩阵',
      columns: [
        { key: 'condition', label: '付款条件' },
        { key: 'evidence', label: '证据' },
        { key: 'account', label: '收款账户' },
        { key: 'verifier', label: '核验人' },
        { key: 'status', label: '状态' },
        { key: 'gap', label: '缺口' },
        { key: 'amount', label: '金额' },
      ],
      rows: [
        {
          id: 'payment-row-001',
          cells: {
            condition: '合同生效', evidence: '候选合同文本', account: '不适用', verifier: '贺临', status: '未满足', gap: '签署件与决定编号缺失', amount: '不适用',
          },
        },
        {
          id: 'payment-row-002',
          cells: {
            condition: '设备到场验收', evidence: '3 张候选照片', account: '不适用', verifier: '石澜', status: '未满足', gap: '序列号校验码不清', amount: '不适用',
          },
        },
        {
          id: 'payment-row-003',
          cells: {
            condition: '支付预付款 256 万元', evidence: '无发票', account: '候选供应商账户 1100****8841', verifier: '柴可与司库复核员', status: '阻断', gap: '账户户名、发票与付款确认书缺失', amount: '人民币 256 万元',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'funding-input', label: '资金匹配状态', kind: 'funding', active: true },
        { id: 'payment-dependency', label: '首期付款条件', kind: 'payment', active: true },
        { id: 'payment-agent', label: '候选核验 Agent', kind: 'agent', active: true },
        { id: 'payment-gate', label: '付款核验 Gate（柴可）', kind: 'gate', active: true },
        { id: 'final-target', label: '最终付款', kind: 'target', active: false },
      ],
      edges: [
        { id: 'commerce-payment-check-e1', source: 'funding-input', target: 'payment-agent', label: '输入额度条件' },
        { id: 'commerce-payment-check-e2', source: 'payment-agent', target: 'payment-dependency', label: '生成候选依赖' },
        { id: 'commerce-payment-check-e3', source: 'payment-dependency', target: 'payment-gate', label: '等待人工核验' },
        { id: 'commerce-payment-check-e4', source: 'payment-gate', target: 'final-target', label: '通过后接续' },
      ],
    },
    indicators: [
      { label: '满足条件', value: '0/4', note: '候选检查，未验证' },
      { label: '候选付款额', value: '256 万元', note: '不得触发支付' },
      { label: '模型权限', value: 'none', note: '柴可控制核验结论' },
    ],
    evidenceGaps: ['收款账户户名证明缺失。', '预付款发票未收到。'],
    nextActions: ['核验收款账户户名与账户证明。', '催收预付款发票。', '由柴可决定是否进入付款 Gate。'],
    currentSituation: '首期付款未满足合同、验收、账户和发票条件，状态为阻断。',
    whyMe: '柴可负责付款核验；模型只整理候选依赖，authority=none。',
    aiCompleted: ['已列出四项付款前置条件。', '已标记账户候选风险。'],
    primaryHumanAction: {
      action: '核验证据链并批准或阻断首期付款。',
      owner: '付款核验·柴可',
      evidenceGap: '账户证明、签署合同和发票。',
      humanGate: '付款核验 Gate',
    },
    nextHandoff: {
      target: 'commerce-final-payment',
      receiver: '最终付款·费然',
      contextPacket: ['项目 FL-DEMO-001', '付款条件状态', '账户核验候选', '柴可决定', '结算接续目标'],
    },
    successReceiptCondition: '柴可提交后 Receipt 必须确认每项条件通过，且账户回执可追溯。',
  },
  'commerce-final-payment': {
    id: 'commerce-final-payment',
    type: 'commerce-final-payment-workspace',
    headline: '最终付款：结算清单尚未进入人工 Gate',
    objective: '汇总前置 Gate、外部回执和责任清单，未取得回执前不得形成最终付款。',
    visualization: {
      type: '付款Gate与Receipt图',
      title: '最终付款 Gate 与 Receipt 图',
      description: '本地合成结算候选，外部回执缺失，最终状态未验证。',
      items: [
        { id: 'final-contract', label: '合同签署', value: '未完成', status: '前置缺口' },
        { id: 'final-acceptance', label: '终验报告', value: '未提交', status: '缺口' },
        { id: 'final-external', label: '外部回执', value: '0/2', status: '未收到' },
        { id: 'final-receipt', label: '最终 Receipt', value: '未生成', status: '等待 Gate' },
      ],
    },
    matrix: {
      title: '最终清单、责任人、前置 Gate、外部回执与状态矩阵',
      columns: [
        { key: 'checklist', label: '最终清单' },
        { key: 'owner', label: '责任人' },
        { key: 'gate', label: '前置 Gate' },
        { key: 'external', label: '外部回执' },
        { key: 'status', label: '最终状态' },
        { key: 'evidence', label: '证据' },
        { key: 'amount', label: '金额' },
      ],
      rows: [
        {
          id: 'final-row-001',
          cells: {
            checklist: '合同签署件归档', owner: '贺临', gate: '合同审批 Gate', external: '无', status: '未开始', evidence: '候选合同目录', amount: '不适用',
          },
        },
        {
          id: 'final-row-002',
          cells: {
            checklist: '设备终验报告', owner: '石澜与供应商刘兆', gate: '物流查验 Gate', external: '供应商终验章缺失', status: '未开始', evidence: '候选验收模板', amount: '不适用',
          },
        },
        {
          id: 'final-row-003',
          cells: {
            checklist: '尾款人民币 128 万元', owner: '费然', gate: '最终付款 Gate', external: '银行回单缺失', status: '阻断', evidence: '候选结算清单', amount: '人民币 128 万元',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'payment-input', label: '首期核验状态', kind: 'payment', active: true },
        { id: 'final-checklist', label: '最终结算清单', kind: 'settlement', active: true },
        { id: 'final-agent', label: '候选清单检查 Agent', kind: 'agent', active: true },
        { id: 'final-gate', label: '最终付款 Gate（费然）', kind: 'gate', active: true },
        { id: 'asset-target', label: '起租建档', kind: 'target', active: false },
      ],
      edges: [
        { id: 'commerce-final-payment-e1', source: 'payment-input', target: 'final-agent', label: '输入付款状态' },
        { id: 'commerce-final-payment-e2', source: 'final-agent', target: 'final-checklist', label: '生成候选清单' },
        { id: 'commerce-final-payment-e3', source: 'final-checklist', target: 'final-gate', label: '等待最终授权' },
        { id: 'commerce-final-payment-e4', source: 'final-gate', target: 'asset-target', label: '完成后移交资产' },
      ],
    },
    indicators: [
      { label: '清单完成', value: '0/6', note: '候选清单，未验证' },
      { label: '外部回执', value: '0/2', note: '终验章与银行回单缺失' },
      { label: '模型权限', value: 'none', note: '费然才能触发结算 Gate' },
    ],
    evidenceGaps: ['供应商终验回执缺失。', '银行付款回单缺失。'],
    nextActions: ['冻结最终清单版本。', '跟踪终验章和银行回单。', '由费然决定是否提交最终付款 Gate。'],
    currentSituation: '最终付款处于零进度，清单、回执和授权均未完成。',
    whyMe: '费然负责商务结算；模型只汇总候选清单，authority=none。',
    aiCompleted: ['已生成最终清单候选。', '已列出缺失外部回执。'],
    primaryHumanAction: {
      action: '确认最终清单并决定是否进入付款授权。',
      owner: '最终付款·费然',
      evidenceGap: '终验章回执和银行回单。',
      humanGate: '最终付款 Gate',
    },
    nextHandoff: {
      target: 'asset-onboard',
      receiver: '起租建档·甄禾',
      contextPacket: ['项目 FL-DEMO-001', '最终清单状态', '外部回执缺口', '费然决定', '资产建档接续目标'],
    },
    successReceiptCondition: '费然提交后 Receipt 必须包含清单版本、付款回执和资产移交时间。',
  },
  'asset-onboard': {
    id: 'asset-onboard',
    type: 'asset-onboard-workspace',
    headline: '起租建档：资产谱系等待保险与终验收口',
    objective: '建立合同、设备、保险和租金计划候选谱系，确保档案完成后再起租。',
    visualization: {
      type: '合同—设备—保险—租金计划资产谱系',
      title: '资产起租谱系画布',
      description: '本地合成资产谱系候选，档案未冻结，起租状态未验证。',
      items: [
        { id: 'onboard-contract', label: '合同', value: '候选版本', status: '待归档' },
        { id: 'onboard-equipment', label: '设备', value: '1 台数控机床', status: '序列号待核' },
        { id: 'onboard-insurance', label: '保险', value: '批单缺失', status: '阻断' },
        { id: 'onboard-rent', label: '租金计划', value: '36 期候选', status: '待确认' },
      ],
    },
    matrix: {
      title: '资产、合同、设备、保险、起租日与档案状态矩阵',
      columns: [
        { key: 'asset', label: '资产' },
        { key: 'contract', label: '合同' },
        { key: 'equipment', label: '设备' },
        { key: 'insurance', label: '保险' },
        { key: 'start', label: '起租日' },
        { key: 'archive', label: '档案状态' },
        { key: 'evidence', label: '证据' },
      ],
      rows: [
        {
          id: 'onboard-row-001',
          cells: {
            asset: '资产卡 AST-001', contract: '候选租赁合同 v1', equipment: '数控机床 / NC-2026-08841', insurance: '主单已登记，批单缺失', start: '候选 2026-09-01', archive: '30% 候选', evidence: '合同目录与照片',
          },
        },
        {
          id: 'onboard-row-002',
          cells: {
            asset: '资产卡 AST-001', contract: '安装责任附件待签', equipment: '铭牌照片不清晰', insurance: '受益人待确认', start: '未批准', archive: '补证中', evidence: '物流异常记录',
          },
        },
        {
          id: 'onboard-row-003',
          cells: {
            asset: '租金计划 RENT-DRAFT', contract: '付款表待商务确认', equipment: '不适用', insurance: '不适用', start: '09-01候选', archive: '待甄禾复核', evidence: '候选现金流表',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'final-payment-input', label: '商务结算状态', kind: 'payment', active: true },
        { id: 'asset-lineage', label: '资产四类谱系', kind: 'asset', active: true },
        { id: 'asset-agent', label: '候选档案检查 Agent', kind: 'agent', active: true },
        { id: 'onboard-gate', label: '起租建档 Gate（甄禾）', kind: 'gate', active: true },
        { id: 'rent-target', label: '租金监测', kind: 'target', active: false },
      ],
      edges: [
        { id: 'asset-onboard-e1', source: 'final-payment-input', target: 'asset-agent', label: '输入移交材料' },
        { id: 'asset-onboard-e2', source: 'asset-agent', target: 'asset-lineage', label: '生成候选谱系' },
        { id: 'asset-onboard-e3', source: 'asset-lineage', target: 'onboard-gate', label: '等待档案确认' },
        { id: 'asset-onboard-e4', source: 'onboard-gate', target: 'rent-target', label: '建档后监测' },
      ],
    },
    indicators: [
      { label: '档案完整度', value: '30%', note: '候选比例，未验证' },
      { label: '阻断项', value: '2 个', note: '保险批单与序列号' },
      { label: '模型权限', value: 'none', note: '甄禾确认起租档案' },
    ],
    evidenceGaps: ['保险受益人批单仍缺失。', '清晰设备铭牌照片缺失。'],
    nextActions: ['接收商务移交回执。', '补齐保险与设备档案。', '由甄禾确认候选起租日。'],
    currentSituation: '资产卡已建立候选谱系，保险和设备核验仍是阻断项。',
    whyMe: '甄禾负责资产建档；模型只整理候选档案，authority=none。',
    aiCompleted: ['已生成合同与设备候选关联。', '已标出保险缺口。'],
    primaryHumanAction: {
      action: '确认资产谱系并批准或暂缓起租。',
      owner: '起租建档·甄禾',
      evidenceGap: '保险批单和清晰铭牌照片。',
      humanGate: '起租建档 Gate',
    },
    nextHandoff: {
      target: 'asset-rent',
      receiver: '租金监测·穆遥',
      contextPacket: ['项目 FL-DEMO-001', '资产档案候选', '起租日候选', '保险缺口', '租金接续目标'],
    },
    successReceiptCondition: '甄禾提交后 Receipt 必须记录档案版本、起租日和未闭合缺口。',
  },
  'asset-rent': {
    id: 'asset-rent',
    type: 'asset-rent-workspace',
    headline: '租金监测：首期现金流仅完成候选生成',
    objective: '跟踪应付、实付、逾期和核销状态，防止未验证现金流成为正式账务。',
    visualization: {
      type: '租金现金流时间线',
      title: '36 期租金现金流时间线',
      description: '本地合成现金流候选，未接入生产账务，实付状态未验证。',
      items: [
        { id: 'rent-first', label: '第1期', value: '候选 42.8 万元', status: '未到期' },
        { id: 'rent-schedule', label: '计划', value: '36 期', status: '待冻结' },
        { id: 'rent-paid', label: '实付', value: '0 笔', status: '未验证' },
        { id: 'rent-overdue', label: '逾期', value: '0 天候选', status: '待监测' },
      ],
    },
    matrix: {
      title: '期次、应付日、应付额、实付额、逾期与核销矩阵',
      columns: [
        { key: 'period', label: '期次' },
        { key: 'due', label: '应付日' },
        { key: 'dueAmount', label: '应付额' },
        { key: 'paidAmount', label: '实付额' },
        { key: 'overdue', label: '逾期天数' },
        { key: 'writeOff', label: '核销状态' },
        { key: 'evidence', label: '证据' },
      ],
      rows: [
        {
          id: 'rent-row-001',
          cells: {
            period: '第1期', due: '候选 2026-09-05', dueAmount: '人民币 428,000 元', paidAmount: '人民币 0 元', overdue: '0 天候选', writeOff: '未核销', evidence: '候选租金计划',
          },
        },
        {
          id: 'rent-row-002',
          cells: {
            period: '第2期', due: '候选 2026-10-05', dueAmount: '人民币 428,000 元', paidAmount: '人民币 0 元', overdue: '未到期', writeOff: '未核销', evidence: '候选租金计划',
          },
        },
        {
          id: 'rent-row-003',
          cells: {
            period: '保证金', due: '起租前候选', dueAmount: '人民币 800,000 元', paidAmount: '银行流水未收到', overdue: '不适用', writeOff: '待抵扣确认', evidence: '候选合同条款',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'onboard-input', label: '起租档案状态', kind: 'asset', active: true },
        { id: 'rent-cashflow', label: '租金现金流', kind: 'cashflow', active: true },
        { id: 'rent-agent', label: '候选现金流检查 Agent', kind: 'agent', active: true },
        { id: 'rent-gate', label: '租金口径 Gate（穆遥）', kind: 'gate', active: true },
        { id: 'warning-target', label: '风险预警', kind: 'target', active: false },
      ],
      edges: [
        { id: 'asset-rent-e1', source: 'onboard-input', target: 'rent-agent', label: '输入起租口径' },
        { id: 'asset-rent-e2', source: 'rent-agent', target: 'rent-cashflow', label: '生成候选现金流' },
        { id: 'asset-rent-e3', source: 'rent-cashflow', target: 'rent-gate', label: '等待账务确认' },
        { id: 'asset-rent-e4', source: 'rent-gate', target: 'warning-target', label: '异常进入预警' },
      ],
    },
    indicators: [
      { label: '候选首期', value: '42.8 万元', note: '未到期，未验证' },
      { label: '实付回单', value: '0 张', note: '不能确认收款' },
      { label: '模型权限', value: 'none', note: '穆遥冻结租金口径' },
    ],
    evidenceGaps: ['保证金付款回单缺失。', '起租日尚未正式批准。'],
    nextActions: ['确认租金计划版本。', '跟踪保证金到账回单。', '由穆遥批准监测口径。'],
    currentSituation: '租金计划已生成候选，但起租和收款均未正式确认。',
    whyMe: '穆遥负责租金账务口径；模型只做候选计算，authority=none。',
    aiCompleted: ['已生成 36 期现金流候选。', '已标记保证金缺口。'],
    primaryHumanAction: {
      action: '冻结租金计划并确认收款核销口径。',
      owner: '租金监测·穆遥',
      evidenceGap: '保证金回单和起租批准 Receipt。',
      humanGate: '租金口径 Gate',
    },
    nextHandoff: {
      target: 'asset-warning',
      receiver: '风险预警·宋湄',
      contextPacket: ['项目 FL-DEMO-001', '现金流候选', '首期应付日', '保证金状态', '风险接续目标'],
    },
    successReceiptCondition: '穆遥提交后 Receipt 必须记录租金版本、口径和到账核验规则。',
  },
  'asset-warning': {
    id: 'asset-warning',
    type: 'asset-warning-workspace',
    headline: '风险预警：候选信号仅处于观察期',
    objective: '识别阈值、观测值与证据传播链，由风险 Owner 决定是否升级处置。',
    visualization: {
      type: '风险信号传播图',
      title: '承租人与设备风险信号传播图',
      description: '本地合成风险信号候选，观测值未验证，不能触发生产处置。',
      items: [
        { id: 'warning-cash', label: '现金流', value: '保证金未到账', status: '观察' },
        { id: 'warning-operation', label: '设备开工', value: '候选下降 12%', status: '待核实' },
        { id: 'warning-severity', label: '严重度', value: '候选中低', status: '待确认' },
        { id: 'warning-owner', label: 'Owner', value: '宋湄', status: '待决策' },
      ],
    },
    matrix: {
      title: '信号、阈值、观测值、证据、Owner 与处置矩阵',
      columns: [
        { key: 'signal', label: '信号' },
        { key: 'threshold', label: '阈值' },
        { key: 'observed', label: '观测值' },
        { key: 'severity', label: '严重度' },
        { key: 'evidence', label: '证据' },
        { key: 'owner', label: 'Owner' },
        { key: 'status', label: '处置状态' },
      ],
      rows: [
        {
          id: 'warning-row-001',
          cells: {
            signal: '保证金未到账', threshold: '起租前 3 日到账', observed: '候选未到账', severity: '中', evidence: '无银行回单', owner: '宋湄', status: '观察',
          },
        },
        {
          id: 'warning-row-002',
          cells: {
            signal: '设备开工率下降', threshold: '连续两周下降 15%', observed: '候选下降 12%', severity: '中低', evidence: '候选物联网抽样', owner: '宋湄与穆遥', status: '待核实',
          },
        },
        {
          id: 'warning-row-003',
          cells: {
            signal: '供应商安装延期', threshold: '超过 5 个工作日', observed: '候选 6 个工作日', severity: '高', evidence: '物流异常记录', owner: '宋湄与贺临', status: '待升级',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'rent-input', label: '租金监测状态', kind: 'cashflow', active: true },
        { id: 'warning-chain', label: '风险传播候选', kind: 'risk', active: true },
        { id: 'warning-agent', label: '候选信号检查 Agent', kind: 'agent', active: true },
        { id: 'warning-gate', label: '风险处置 Gate（宋湄）', kind: 'gate', active: true },
        { id: 'collection-target', label: '催收处置', kind: 'target', active: false },
      ],
      edges: [
        { id: 'asset-warning-e1', source: 'rent-input', target: 'warning-agent', label: '输入现金流异常' },
        { id: 'asset-warning-e2', source: 'warning-agent', target: 'warning-chain', label: '生成候选信号' },
        { id: 'asset-warning-e3', source: 'warning-chain', target: 'warning-gate', label: '等待风险决策' },
        { id: 'asset-warning-e4', source: 'warning-gate', target: 'collection-target', label: '必要时催收' },
      ],
    },
    indicators: [
      { label: '观察信号', value: '3 个', note: '候选观测，未验证' },
      { label: '高严重度', value: '1 个', note: '安装延期待升级' },
      { label: '模型权限', value: 'none', note: '宋湄决定风险升级' },
    ],
    evidenceGaps: ['设备开工数据来源未确认。', '保证金到账回执缺失。'],
    nextActions: ['确认开工数据采集口径。', '升级供应商安装延期问题。', '由宋湄决定风险处置动作。'],
    currentSituation: '三个候选信号进入观察，安装延期已接近高严重度。',
    whyMe: '宋湄负责资产风险；模型只做候选监测，authority=none。',
    aiCompleted: ['已汇总三个风险信号。', '已给出候选严重度。'],
    primaryHumanAction: {
      action: '确认信号真实性并决定是否升级。',
      owner: '风险预警·宋湄',
      evidenceGap: '开工数据来源与保证金回执。',
      humanGate: '风险处置 Gate',
    },
    nextHandoff: {
      target: 'asset-collection',
      receiver: '催收处置·程雪',
      contextPacket: ['项目 FL-DEMO-001', '风险信号表', '严重度候选', '宋湄决定', '催收接续目标'],
    },
    successReceiptCondition: '宋湄提交后 Receipt 必须记录信号确认结果和处置授权。',
  },
  'asset-collection': {
    id: 'asset-collection',
    type: 'asset-collection-workspace',
    headline: '催收处置：无逾期确认，候选动作暂不执行',
    objective: '准备分级催收决策候选，确保任何动作都由催收责任人批准并取得回执。',
    visualization: {
      type: '分级催收决策树',
      title: '逾期桶与人工批准决策树',
      description: '本地合成催收策略候选，当前无确认逾期，动作未验证也未执行。',
      items: [
        { id: 'collection-bucket', label: '逾期桶', value: '无确认逾期', status: '观察' },
        { id: 'collection-action', label: '建议动作', value: '提醒函候选', status: '未批准' },
        { id: 'collection-promise', label: '还款承诺', value: '未取得', status: '无' },
        { id: 'collection-receipt', label: '回执', value: '0 张', status: '未生成' },
      ],
    },
    matrix: {
      title: '客户期次、逾期桶、建议动作、批准、承诺与回执矩阵',
      columns: [
        { key: 'customerPeriod', label: '客户/期次' },
        { key: 'bucket', label: '逾期桶' },
        { key: 'action', label: '建议动作' },
        { key: 'approval', label: '人工批准' },
        { key: 'promise', label: '还款承诺' },
        { key: 'receipt', label: '回执' },
        { key: 'status', label: '状态' },
      ],
      rows: [
        {
          id: 'collection-row-001',
          cells: {
            customerPeriod: '承租人 / 第1期', bucket: '未逾期候选', action: '仅发送提醒函候选', approval: '程雪未批准', promise: '无', receipt: '无', status: '观察',
          },
        },
        {
          id: 'collection-row-002',
          cells: {
            customerPeriod: '承租人 / 保证金', bucket: '未到账待核', action: '发送保证金提示候选', approval: '穆遥与程雪待批', promise: '无', receipt: '无', status: '待确认',
          },
        },
        {
          id: 'collection-row-003',
          cells: {
            customerPeriod: '承租人 / 全期', bucket: '无确认逾期', action: '暂缓升级', approval: '风险 Gate 未触发', promise: '无', receipt: '无', status: '不执行',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'warning-input', label: '风险处置状态', kind: 'risk', active: true },
        { id: 'collection-tree', label: '分级催收候选', kind: 'collection', active: true },
        { id: 'collection-agent', label: '候选话术检查 Agent', kind: 'agent', active: true },
        { id: 'collection-gate', label: '催收批准 Gate（程雪）', kind: 'gate', active: true },
        { id: 'litigation-target', label: '诉讼退出', kind: 'target', active: false },
      ],
      edges: [
        { id: 'asset-collection-e1', source: 'warning-input', target: 'collection-agent', label: '输入风险等级' },
        { id: 'asset-collection-e2', source: 'collection-agent', target: 'collection-tree', label: '生成候选动作' },
        { id: 'asset-collection-e3', source: 'collection-tree', target: 'collection-gate', label: '等待催收批准' },
        { id: 'asset-collection-e4', source: 'collection-gate', target: 'litigation-target', label: '必要时退出' },
      ],
    },
    indicators: [
      { label: '确认逾期', value: '0 期', note: '首期未到期' },
      { label: '待批准动作', value: '2 个', note: '候选提醒，未执行' },
      { label: '模型权限', value: 'none', note: '程雪批准催收动作' },
    ],
    evidenceGaps: ['保证金到账状态未确认。', '客户联系授权记录缺失。'],
    nextActions: ['确认当前无逾期口径。', '准备提醒函候选文本。', '由程雪决定是否批准发送。'],
    currentSituation: '尚无确认逾期，但保证金未到账需要观察。',
    whyMe: '程雪负责催收处置；模型只提供候选动作，authority=none。',
    aiCompleted: ['已生成提醒函候选。', '已划分候选逾期桶。'],
    primaryHumanAction: {
      action: '批准、修改或阻断候选催收动作。',
      owner: '催收处置·程雪',
      evidenceGap: '保证金回执和客户联系授权。',
      humanGate: '催收批准 Gate',
    },
    nextHandoff: {
      target: 'asset-litigation',
      receiver: '诉讼退出·韩铮',
      contextPacket: ['项目 FL-DEMO-001', '催收状态候选', '逾期桶口径', '程雪决定', '诉讼接续目标'],
    },
    successReceiptCondition: '程雪提交后 Receipt 必须记录动作版本、批准人和发送回执要求。',
  },
  'asset-litigation': {
    id: 'asset-litigation',
    type: 'asset-litigation-workspace',
    headline: '诉讼退出：无授权案件，资源路径保持候选',
    objective: '准备案由、主张、外部资源与成本候选，退出必须由诉讼责任人授权。',
    visualization: {
      type: '诉讼资源与退出路径图',
      title: '诉讼资源与资产退出路径图',
      description: '本地合成诉讼资源候选，无立案事实，成本与授权均未验证。',
      items: [
        { id: 'litigation-case', label: '案由', value: '无立案候选', status: '不适用' },
        { id: 'litigation-claim', label: '主张', value: '候选框架', status: '未授权' },
        { id: 'litigation-cost', label: '预算', value: '候选 18 万元', status: '未批准' },
        { id: 'litigation-exit', label: '退出路径', value: '解约/取回/处置', status: '候选' },
      ],
    },
    matrix: {
      title: '案由资产、主张、证据、外部资源、成本、授权与退出矩阵',
      columns: [
        { key: 'caseAsset', label: '案由/资产' },
        { key: 'claim', label: '主张' },
        { key: 'evidence', label: '证据' },
        { key: 'external', label: '外部资源' },
        { key: 'cost', label: '成本' },
        { key: 'authorization', label: '授权' },
        { key: 'status', label: '退出状态' },
      ],
      rows: [
        {
          id: 'litigation-row-001',
          cells: {
            caseAsset: '租金纠纷候选 / 数控机床', claim: '候选请求应付租金', evidence: '无生效判决依据', external: '候选外部律所金砚', cost: '候选 12 万元', authorization: '韩铮未发起', status: '不立案',
          },
        },
        {
          id: 'litigation-row-002',
          cells: {
            caseAsset: '设备取回候选 / 数控机床', claim: '候选取回与占有移转', evidence: '合同与物流候选', external: '候选评估机构', cost: '候选 6 万元', authorization: '资产委员会未授权', status: '未启动',
          },
        },
        {
          id: 'litigation-row-003',
          cells: {
            caseAsset: '资产处置候选 / 数控机床', claim: '候选拍卖或转让', evidence: '残值评估缺失', external: '候选产权交易所', cost: '候选费率未确认', authorization: '韩铮待评估', status: '候选冻结',
          },
        },
      ],
    },
    graph: {
      nodes: [
        { id: 'collection-input', label: '催收处置状态', kind: 'collection', active: true },
        { id: 'litigation-path', label: '退出路径候选', kind: 'legal', active: true },
        { id: 'litigation-agent', label: '候选资源检查 Agent', kind: 'agent', active: true },
        { id: 'litigation-gate', label: '诉讼授权 Gate（韩铮）', kind: 'gate', active: true },
        { id: 'exit-target', label: '资产退出归档', kind: 'target', active: false },
      ],
      edges: [
        { id: 'asset-litigation-e1', source: 'collection-input', target: 'litigation-agent', label: '输入催收结果' },
        { id: 'asset-litigation-e2', source: 'litigation-agent', target: 'litigation-path', label: '生成候选路径' },
        { id: 'asset-litigation-e3', source: 'litigation-path', target: 'litigation-gate', label: '等待法律授权' },
        { id: 'asset-litigation-e4', source: 'litigation-gate', target: 'exit-target', label: '授权后归档' },
      ],
    },
    indicators: [
      { label: '立案案件', value: '0 件', note: '无授权，无生产动作' },
      { label: '候选预算', value: '18 万元', note: '未批准' },
      { label: '模型权限', value: 'none', note: '韩铮控制法律路径' },
    ],
    evidenceGaps: ['设备残值评估缺失。', '外部律所费用报价未确认。'],
    nextActions: ['确认当前无立案事实。', '补充残值评估候选需求。', '由韩铮维护法律路径授权状态。'],
    currentSituation: '没有授权诉讼，只有解约、取回和处置候选路径。',
    whyMe: '韩铮负责诉讼退出；模型只整理候选资源，authority=none。',
    aiCompleted: ['已生成退出路径候选。', '已汇总外部资源类型。'],
    primaryHumanAction: {
      action: '确认不立案、准备授权材料或冻结路径。',
      owner: '诉讼退出·韩铮',
      evidenceGap: '残值评估和外部费用报价。',
      humanGate: '诉讼授权 Gate',
    },
    nextHandoff: {
      target: 'policy-material',
      receiver: '材料解析·周宁',
      contextPacket: ['项目 FL-DEMO-001', '诉讼状态候选', '退出路径缺口', '韩铮决定', '政策反馈接续目标'],
    },
    successReceiptCondition: '韩铮提交后 Receipt 必须记录授权范围、成本预算和退出归档条件。',
  },
};

export const FLOW_WORKSPACES: Record<string, FlowWorkspace> = {
  ...POLICY_WORKSPACES,
  'credit-parse': LEGACY_FLOW_WORKSPACES['credit-parse'],
  'credit-fact': LEGACY_FLOW_WORKSPACES['credit-fact'],
  'credit-link': LEGACY_FLOW_WORKSPACES['credit-link'],
  'credit-coordinate': LEGACY_FLOW_WORKSPACES['credit-coordinate'],
  'credit-review': LEGACY_FLOW_WORKSPACES['credit-review'],
  'commerce-contract': LEGACY_FLOW_WORKSPACES['commerce-contract'],
  'commerce-logistics': LEGACY_FLOW_WORKSPACES['commerce-logistics'],
  'commerce-funding': LEGACY_FLOW_WORKSPACES['commerce-funding'],
  'commerce-payment-check': LEGACY_FLOW_WORKSPACES['commerce-payment-check'],
  'commerce-final-payment': LEGACY_FLOW_WORKSPACES['commerce-final-payment'],
  'asset-onboard': LEGACY_FLOW_WORKSPACES['asset-onboard'],
  'asset-rent': LEGACY_FLOW_WORKSPACES['asset-rent'],
  'asset-warning': LEGACY_FLOW_WORKSPACES['asset-warning'],
  'asset-collection': LEGACY_FLOW_WORKSPACES['asset-collection'],
  'asset-litigation': LEGACY_FLOW_WORKSPACES['asset-litigation'],
};
