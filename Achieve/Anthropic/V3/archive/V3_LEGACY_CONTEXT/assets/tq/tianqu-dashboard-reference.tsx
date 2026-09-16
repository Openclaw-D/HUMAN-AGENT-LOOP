"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

const guideSteps = ["说明目标", "补充资料", "确认边界", "选择产物"];

type AgentProfile = {
  name: string;
  stage: string;
  tagline: string;
  summary: string;
  signals: Array<[string, string]>;
  inputs: string[];
  outputs: string[];
  mcps: string[];
  skills: string[];
  handoffs: string[];
};

type DataDomainKey = "projects" | "mcps" | "skills" | "conversations" | "files";

type DataMapItem = {
  name: string;
  category: string;
  summary: string;
  facts: Array<[string, string]>;
  x: number;
  y: number;
  size: number;
};

type DataDomain = {
  title: string;
  subtitle: string;
  summary: string;
  items: DataMapItem[];
};

const dataDomains: Record<DataDomainKey, DataDomain> = {
  projects: {
    title: "项目开发",
    subtitle: "所有业务与系统项目的统一开发视图",
    summary: "查看不同项目处于什么位置、由哪些 Agent 负责，以及下一步需要谁继续处理。",
    items: [
      { name: "新回模式项目", category: "前线业务", summary: "高风险、高专业度的新模式回租项目。", facts: [["责任 Agent", "新回 · 风控"], ["关键内容", "结构 · 风险 · 收益"], ["数据状态", "待接入项目系统"]], x: 14, y: 22, size: 154 },
      { name: "存量续作项目", category: "前线业务", summary: "基于历史履约和现有资产开展存量客户续作。", facts: [["责任 Agent", "存回 · 风控"], ["关键内容", "履约 · 敞口 · 定价"], ["数据状态", "待接入项目系统"]], x: 38, y: 15, size: 136 },
      { name: "直租设备项目", category: "前线业务", summary: "围绕新设备、供应商和交付计划推进直租。", facts: [["责任 Agent", "直租 · 渠道"], ["关键内容", "设备 · 供应商 · 付款"], ["数据状态", "待接入项目系统"]], x: 70, y: 20, size: 148 },
      { name: "系统辅助任务", category: "支撑项目", summary: "承接流程、系统和数据处理需求。", facts: [["责任 Agent", "辅助 · 网安"], ["关键内容", "需求 · 流程 · 数据"], ["数据状态", "待接入任务系统"]], x: 86, y: 51, size: 132 },
      { name: "专业复核任务", category: "中台任务", summary: "将前线项目交给专业能力进行独立判断。", facts: [["责任 Agent", "风控 · 产品"], ["关键内容", "证据 · 规则 · 条件"], ["数据状态", "待接入任务系统"]], x: 66, y: 79, size: 144 },
      { name: "经营治理任务", category: "后台任务", summary: "处理指标、预算、组织和安全保障事项。", facts: [["责任 Agent", "企划 · 业管 · 财务 · 网安"], ["关键内容", "资源 · 执行 · 治理"], ["数据状态", "待接入任务系统"]], x: 28, y: 77, size: 150 },
    ],
  },
  mcps: {
    title: "MCP 连接",
    subtitle: "Agent 与真实系统之间的连接地图",
    summary: "查看系统连接负责提供什么数据、允许哪些操作，以及哪些 Agent 可以调用。",
    items: [
      { name: "客户与项目系统", category: "业务数据", summary: "提供客户档案、项目阶段和跟进记录。", facts: [["主要调用方", "前线 · 销推"], ["建议权限", "读取与任务回写"], ["连接状态", "待管理员配置"]], x: 14, y: 22, size: 154 },
      { name: "合同与资产系统", category: "交易数据", summary: "提供合同条款、租赁资产和履约信息。", facts: [["主要调用方", "存回 · 直租 · 风控"], ["建议权限", "只读"], ["连接状态", "待管理员配置"]], x: 39, y: 14, size: 142 },
      { name: "风险数据", category: "专业数据", summary: "提供征信、外部风险和历史风险记录。", facts: [["主要调用方", "新回 · 风控"], ["建议权限", "按项目授权读取"], ["连接状态", "待管理员配置"]], x: 71, y: 20, size: 138 },
      { name: "财务与回款", category: "财务数据", summary: "提供预算、支付、回款和项目收益数据。", facts: [["主要调用方", "财务 · 企划"], ["建议权限", "分级读取"], ["连接状态", "待管理员配置"]], x: 86, y: 52, size: 144 },
      { name: "文档知识中心", category: "内容数据", summary: "提供文件、制度、模板和历史正式产物。", facts: [["主要调用方", "全部 Agent"], ["建议权限", "按项目与角色"], ["连接状态", "待管理员配置"]], x: 66, y: 79, size: 150 },
      { name: "身份权限系统", category: "安全能力", summary: "控制人员、Agent 和系统连接的访问边界。", facts: [["主要调用方", "网安 · 业管"], ["建议权限", "最小权限"], ["连接状态", "待管理员配置"]], x: 27, y: 77, size: 142 },
    ],
  },
  skills: {
    title: "Skills 能力",
    subtitle: "可复用的专业工作方法与交付模板",
    summary: "查看每项能力解决什么问题、适用于哪些 Agent，以及必须形成什么正式结果。",
    items: [
      { name: "新模式结构设计", category: "新回方法", summary: "设计交易结构、收益方案和风险假设。", facts: [["适用 Agent", "新回 · 产品 · 风控"], ["正式产物", "交易结构方案"], ["配置状态", "待维护方法模板"]], x: 14, y: 22, size: 154 },
      { name: "存量客户分析", category: "存回方法", summary: "分析历史履约、存量敞口和续作空间。", facts: [["适用 Agent", "存回 · 风控"], ["正式产物", "续作评估"], ["配置状态", "待维护方法模板"]], x: 39, y: 14, size: 140 },
      { name: "直租方案设计", category: "直租方法", summary: "组织设备、供应商、付款和交付条件。", facts: [["适用 Agent", "直租 · 渠道"], ["正式产物", "直租项目包"], ["配置状态", "待维护方法模板"]], x: 71, y: 20, size: 144 },
      { name: "风险证据核验", category: "风控方法", summary: "核验证据并形成可解释的风险条件。", facts: [["适用 Agent", "风控"], ["正式产物", "风险意见"], ["配置状态", "待维护方法模板"]], x: 86, y: 52, size: 150 },
      { name: "产品通道匹配", category: "产品方法", summary: "匹配产品规则、资金通道和定价边界。", facts: [["适用 Agent", "产品 · 财务"], ["正式产物", "产品与通道方案"], ["配置状态", "待维护方法模板"]], x: 66, y: 79, size: 148 },
      { name: "经营分析", category: "企划方法", summary: "分析目标、指标偏差和阶段经营重点。", facts: [["适用 Agent", "企划 · 业管"], ["正式产物", "经营分析与计划"], ["配置状态", "待维护方法模板"]], x: 27, y: 77, size: 136 },
    ],
  },
  conversations: {
    title: "对话记录",
    subtitle: "人类与 Agent、Agent 与 Agent 的协作轨迹",
    summary: "查看任务从提出、拆解、专业复核到最终回流的完整上下文和责任交接。",
    items: [
      { name: "人类决策会话", category: "目标入口", summary: "记录目标、优先级、授权边界和最终确认。", facts: [["参与者", "人类决策"], ["保留内容", "目标 · 边界 · 授权"], ["记录状态", "模型接入后生成"]], x: 14, y: 22, size: 154 },
      { name: "前线项目协同", category: "业务对话", summary: "记录客户、项目和材料准备过程。", facts: [["参与者", "新回 · 存回 · 直租 · 辅助"], ["保留内容", "事实 · 进度 · 请求"], ["记录状态", "模型接入后生成"]], x: 39, y: 14, size: 142 },
      { name: "风险复核", category: "专业对话", summary: "记录证据质询、风险条件和人工待决事项。", facts: [["参与者", "前线 · 风控"], ["保留内容", "证据 · 质询 · 条件"], ["记录状态", "模型接入后生成"]], x: 71, y: 20, size: 142 },
      { name: "产品渠道协同", category: "赋能对话", summary: "记录产品、渠道、销售推动之间的能力协同。", facts: [["参与者", "渠道 · 产品 · 销推"], ["保留内容", "规则 · 通道 · 推动"], ["记录状态", "模型接入后生成"]], x: 86, y: 52, size: 148 },
      { name: "后台资源协调", category: "保障对话", summary: "记录指标、资源、预算和安全保障事项。", facts: [["参与者", "企划 · 业管 · 财务 · 网安"], ["保留内容", "资源 · 任务 · 约束"], ["记录状态", "模型接入后生成"]], x: 66, y: 79, size: 148 },
      { name: "结果回流", category: "决策回路", summary: "汇总正式产物、异常、风险和待决问题。", facts: [["参与者", "全部 Agent → 人类"], ["保留内容", "结果 · 风险 · 待决"], ["记录状态", "模型接入后生成"]], x: 27, y: 77, size: 136 },
    ],
  },
  files: {
    title: "文件资料",
    subtitle: "从任务输入到正式产物的统一文件空间",
    summary: "查看材料属于哪个项目、由谁使用、如何形成正式产物，以及需要保留的版本。",
    items: [
      { name: "客户与项目材料", category: "输入资料", summary: "客户背景、项目说明和业务需求材料。", facts: [["主要使用方", "前线 Agent"], ["管理要求", "归属项目并标记来源"], ["文件状态", "待接入文件中心"]], x: 14, y: 22, size: 154 },
      { name: "合同文件", category: "交易文件", summary: "合同文本、条款版本和履约相关资料。", facts: [["主要使用方", "直租 · 存回 · 风控"], ["管理要求", "版本与审批留痕"], ["文件状态", "待接入文件中心"]], x: 39, y: 14, size: 138 },
      { name: "资产材料", category: "资产文件", summary: "设备清单、报价、权属和估值资料。", facts: [["主要使用方", "直租 · 新回 · 风控"], ["管理要求", "关联资产与项目"], ["文件状态", "待接入文件中心"]], x: 71, y: 20, size: 138 },
      { name: "风险证据", category: "判断依据", summary: "支撑风险意见的事实、查询和人工复核记录。", facts: [["主要使用方", "风控 Agent"], ["管理要求", "可追溯、不可覆盖"], ["文件状态", "待接入文件中心"]], x: 86, y: 52, size: 146 },
      { name: "测算与分析", category: "过程文件", summary: "收益、现金流、预算和经营分析表。", facts: [["主要使用方", "财务 · 企划 · 产品"], ["管理要求", "保留口径和版本"], ["文件状态", "待接入文件中心"]], x: 66, y: 79, size: 146 },
      { name: "正式产物", category: "输出文件", summary: "任务完成后需要交付、审批和归档的正式结果。", facts: [["主要使用方", "全部 Agent · 人类决策"], ["管理要求", "审批后锁定版本"], ["文件状态", "待接入文件中心"]], x: 27, y: 77, size: 140 },
    ],
  },
};

const agentProfiles: Record<string, AgentProfile> = {
  "新回 Agent": {
    name: "新回 Agent", stage: "前线", tagline: "新模式回租业务",
    summary: "负责高风险、高专业度、高利润的新模式回租机会，从业务结构到风险假设形成完整方案。",
    signals: [["风险", "高"], ["专业度", "高"], ["利润", "高"]],
    inputs: ["客户与实控人背景", "资产与资金用途", "交易结构", "现金流与还款来源"],
    outputs: ["新模式机会简报", "交易结构方案", "风险假设清单", "收益测算"],
    mcps: ["客户 360", "资产估值", "风险数据", "合同系统"],
    skills: ["新模式筛选", "交易结构设计", "收益测算", "高风险边界识别"],
    handoffs: ["风控 Agent", "产品 Agent", "财务 Agent"],
  },
  "存回 Agent": {
    name: "存回 Agent", stage: "前线", tagline: "存量客户回租业务",
    summary: "基于既有客户历史和履约数据开展回租，风险相对较低，但仍需要专业定价和资产判断。",
    signals: [["风险", "中低"], ["专业度", "高"], ["利润", "尚可"]],
    inputs: ["存量客户档案", "历史合同", "履约与回款记录", "现有资产情况"],
    outputs: ["存量客户评估", "回租续作方案", "资产与额度建议", "定价建议"],
    mcps: ["客户系统", "合同系统", "回款记录", "风险数据"],
    skills: ["存量客户分析", "续作判断", "资产复核", "回租定价"],
    handoffs: ["风控 Agent", "产品 Agent", "业管 Agent"],
  },
  "直租 Agent": {
    name: "直租 Agent", stage: "前线", tagline: "传统直租基本盘",
    summary: "围绕新设备、供应商和客户需求开展传统直租，是小微业务稳定、标准化的基本盘。",
    signals: [["风险", "标准"], ["专业度", "中"], ["规模", "基本盘"]],
    inputs: ["客户需求", "设备报价", "供应商资料", "项目交付计划"],
    outputs: ["直租项目包", "供应商核验单", "设备与付款方案", "项目进度表"],
    mcps: ["供应商系统", "设备报价", "项目系统", "合同系统"],
    skills: ["供应商核验", "设备融资方案", "材料清单", "项目排期"],
    handoffs: ["渠道 Agent", "风控 Agent", "财务 Agent"],
  },
  "辅助 Agent": {
    name: "辅助 Agent", stage: "前线", tagline: "系统、流程与数据支持",
    summary: "为新回、存回和直租提供系统建设、流程优化、数据处理和协同作业支持。",
    signals: [["定位", "支撑"], ["覆盖", "三类业务"], ["重点", "效率"]],
    inputs: ["业务问题", "流程堵点", "系统需求", "数据处理需求"],
    outputs: ["系统需求单", "流程优化方案", "数据核验报告", "自动化任务"],
    mcps: ["流程平台", "数据平台", "文档中心", "开发任务系统"],
    skills: ["需求分析", "流程优化", "数据核验", "自动化编排"],
    handoffs: ["新回 Agent", "存回 Agent", "直租 Agent", "网安 Agent"],
  },
  "风控 Agent": {
    name: "风控 Agent", stage: "中台", tagline: "风险识别与专业判断",
    summary: "核验证据、识别风险、提出准入条件，并把模型判断转成可解释、可审批的风险意见。",
    signals: [["定位", "判断"], ["原则", "证据优先"], ["人工门槛", "必须"]],
    inputs: ["项目材料", "客户与资产数据", "交易结构", "政策与历史风险"],
    outputs: ["风险意见", "风险条件", "证据清单", "人工待决事项"],
    mcps: ["风险数据库", "征信数据", "政策库", "外部风险数据"],
    skills: ["证据核验", "风险评分", "交易结构审查", "风险解释"],
    handoffs: ["产品 Agent", "企划 Agent", "人类决策"],
  },
  "渠道 Agent": {
    name: "渠道 Agent", stage: "中台", tagline: "供应商与合作渠道",
    summary: "经营供应商和合作渠道，寻找能够持续带来设备、客户和项目机会的合作网络。",
    signals: [["对象", "供应商"], ["目标", "获客"], ["方式", "合作网络"]],
    inputs: ["供应商资料", "渠道线索", "产品需求", "区域机会"],
    outputs: ["渠道地图", "合作方案", "供应商清单", "渠道跟进任务"],
    mcps: ["供应商库", "渠道系统", "客户系统", "项目系统"],
    skills: ["渠道筛选", "供应商评价", "合作方案设计", "渠道运营"],
    handoffs: ["直租 Agent", "产品 Agent", "销推 Agent"],
  },
  "产品 Agent": {
    name: "产品 Agent", stage: "中台", tagline: "新产品与通道设计",
    summary: "围绕新业务需求设计产品，匹配不同资金和业务通道，形成可执行的产品规则。",
    signals: [["定位", "设计"], ["对象", "产品通道"], ["重点", "规则"]],
    inputs: ["市场需求", "客户场景", "资金通道政策", "风险边界"],
    outputs: ["产品方案", "通道匹配", "产品规则", "定价建议"],
    mcps: ["产品库", "通道政策库", "定价系统", "合同规则"],
    skills: ["产品设计", "政策匹配", "通道选择", "产品定价"],
    handoffs: ["新回 Agent", "存回 Agent", "销推 Agent", "风控 Agent"],
  },
  "销推 Agent": {
    name: "销推 Agent", stage: "中台", tagline: "客户发现与销售推动",
    summary: "寻找目标客户、形成销售打法并持续推动客户和项目，把产品能力转成真实业务机会。",
    signals: [["目标", "找客户"], ["动作", "推动"], ["结果", "业务机会"]],
    inputs: ["目标客群", "产品方案", "区域市场", "客户跟进记录"],
    outputs: ["目标客户清单", "销售推动计划", "沟通话术", "跟进优先级"],
    mcps: ["客户 360", "CRM", "市场活动", "项目线索库"],
    skills: ["线索发现", "客户画像", "销售话术", "机会优先级"],
    handoffs: ["新回 Agent", "存回 Agent", "直租 Agent"],
  },
  "企划 Agent": {
    name: "企划 Agent", stage: "后台", tagline: "企业规划与指标管理",
    summary: "负责企业规划和全部经营指标，判断阶段目标、完成情况和下一期重点。",
    signals: [["对象", "全部指标"], ["周期", "持续"], ["结果", "经营规划"]],
    inputs: ["经营数据", "项目进度", "年度目标", "各团队执行结果"],
    outputs: ["指标体系", "经营分析", "阶段规划", "偏差与改进建议"],
    mcps: ["指标平台", "数据仓库", "项目系统", "经营报表"],
    skills: ["指标设计", "经营分析", "差异分析", "规划编制"],
    handoffs: ["业管 Agent", "财务 Agent", "人类决策"],
  },
  "业管 Agent": {
    name: "业管 Agent", stage: "后台", tagline: "业务与组织管理",
    summary: "承接业务管理以及人事、行政、培训等组织保障工作，确保计划真正有人执行。",
    signals: [["定位", "组织保障"], ["范围", "人事行政培训"], ["结果", "执行"]],
    inputs: ["经营计划", "任务清单", "人员与组织信息", "培训和行政需求"],
    outputs: ["人员安排", "培训计划", "行政任务", "执行跟踪表"],
    mcps: ["人力系统", "流程平台", "知识库", "任务系统"],
    skills: ["任务编排", "培训规划", "组织协调", "执行跟踪"],
    handoffs: ["企划 Agent", "辅助 Agent", "各业务 Agent"],
  },
  "财务 Agent": {
    name: "财务 Agent", stage: "后台", tagline: "资金、预算与收益",
    summary: "管理资金、预算、回款和项目收益，为业务决策提供清晰的财务边界。",
    signals: [["对象", "资金"], ["原则", "预算约束"], ["结果", "收益清晰"]],
    inputs: ["项目预算", "现金流", "回款计划", "项目收益数据"],
    outputs: ["预算意见", "资金计划", "收益分析", "回款与成本提示"],
    mcps: ["财务系统", "预算系统", "支付与回款", "项目收益数据"],
    skills: ["财务测算", "预算控制", "现金流分析", "盈利分析"],
    handoffs: ["企划 Agent", "业管 Agent", "人类决策"],
  },
  "网安 Agent": {
    name: "网安 Agent", stage: "后台", tagline: "系统架构与安全保障",
    summary: "负责整体系统架构、访问权限、数据安全和运行安全，保证 Agent 与 MCP 在边界内工作。",
    signals: [["对象", "系统架构"], ["原则", "最小权限"], ["结果", "安全运行"]],
    inputs: ["系统变更", "MCP 接入申请", "权限需求", "日志与安全事件"],
    outputs: ["架构评审", "权限方案", "安全检查", "事件处置报告"],
    mcps: ["身份权限系统", "日志平台", "资产管理", "漏洞扫描"],
    skills: ["威胁建模", "权限审查", "架构评审", "安全事件响应"],
    handoffs: ["辅助 Agent", "业管 Agent", "人类决策"],
  },
};

const stages = [
  {
    key: "front",
    label: "前线",
    verb: "客户经营与项目落地",
    description: "面向客户、供应商和项目，对业务形成与落地结果负责",
    owners: "新回 · 存回 · 直租 · 辅助",
    agents: [
      ["新回 Agent", "高风险新模式回租"],
      ["存回 Agent", "存量客户续作经营"],
      ["直租 Agent", "设备与供应商直租"],
      ["辅助 Agent", "系统流程数据支持"],
    ],
    metrics: [["核心对象", "客户 / 项目"], ["责任结果", "项目落地"]],
    output: "标准项目包",
  },
  {
    key: "middle",
    label: "中台",
    verb: "专业判断与能力供给",
    description: "面向专业规则与通用能力，为项目提供独立判断和业务赋能",
    owners: "风控 · 渠道 · 产品 · 销推",
    agents: [
      ["风控 Agent", "证据、风险与准入条件"],
      ["渠道 Agent", "供应商与合作网络"],
      ["产品 Agent", "产品、通道与定价规则"],
      ["销推 Agent", "客户发现与销售推动"],
    ],
    metrics: [["核心对象", "规则 / 能力"], ["责任结果", "专业意见"]],
    output: "可解释判断",
  },
  {
    key: "back",
    label: "后台",
    verb: "经营资源与治理保障",
    description: "面向经营资源与组织治理，保证任务有人、资金可用、系统安全",
    owners: "企划 · 业管 · 财务 · 网安",
    agents: [
      ["企划 Agent", "规划、目标与指标"],
      ["业管 Agent", "组织、培训与执行"],
      ["财务 Agent", "资金、预算与收益"],
      ["网安 Agent", "架构、权限与安全"],
    ],
    metrics: [["核心对象", "资源 / 治理"], ["责任结果", "执行保障"]],
    output: "可执行任务",
  },
];

const agentTabs = ["工作定位", "输入资料", "MCP 连接", "Skills 方法", "产物交付"];

function AgentWorkspace({ profile, onClose }: { profile: AgentProfile; onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const [task, setTask] = useState("");

  return (
    <div className="agent-overlay">
      <section className="agent-workspace" role="dialog" aria-modal="true" aria-labelledby="agent-workspace-title">
        <header className="agent-workspace-header">
          <div>
            <small>{profile.stage} · 新手模式 · 引导式工作台</small>
            <h2 id="agent-workspace-title">{profile.name} 工作台</h2>
            <p>{profile.tagline}</p>
          </div>
          <button type="button" onClick={onClose}>← 返回总览</button>
        </header>

        <div className="agent-workspace-body">
          <nav className="agent-tabs" aria-label={`${profile.name}配置步骤`}>
            <strong>认识并配置这个 Agent</strong>
            {agentTabs.map((item, index) => (
              <button type="button" key={item} className={tab === index ? "is-current" : ""} onClick={() => setTab(index)}>
                <span>0{index + 1}</span>{item}
              </button>
            ))}
            <p>普通用户只需提交任务；管理员才需要维护 MCP、Skills 和权限。</p>
          </nav>

          <div className="agent-workspace-main">
            <div className="agent-tab-progress"><span style={{ width: `${((tab + 1) / agentTabs.length) * 100}%` }} /></div>
            <div className="agent-tab-content">
              {tab === 0 && (
                <section className="agent-overview">
                  <small>这个 Agent 是做什么的</small>
                  <h3>{profile.tagline}</h3>
                  <p>{profile.summary}</p>
                  <div className="agent-signals">
                    {profile.signals.map(([name, value]) => <span key={name}><small>{name}</small><b>{value}</b></span>)}
                  </div>
                  <div className="agent-simple-flow">
                    <span><small>收到</small><b>{profile.inputs[0]}</b></span><i>→</i>
                    <span className="is-agent"><small>处理</small><b>{profile.name}</b></span><i>→</i>
                    <span><small>交付</small><b>{profile.outputs[0]}</b></span>
                  </div>
                </section>
              )}

              {tab === 1 && (
                <section className="agent-list-panel">
                  <small>运行前需要准备</small><h3>输入资料</h3>
                  <div className="agent-config-grid">
                    {profile.inputs.map((item, index) => <label key={item}><input type="checkbox" aria-label={item} defaultChecked={index < 2} /><span><b>{item}</b><small>{index < 2 ? "已选择" : "等待补充"}</small></span></label>)}
                  </div>
                  <label className="agent-upload"><input type="file" multiple aria-label="添加文件" /><b>＋ 添加文件</b><span>接入模型后自动识别并归类</span></label>
                </section>
              )}

              {tab === 2 && (
                <section className="agent-list-panel">
                  <small>这个 Agent 可以连接什么</small><h3>MCP 连接</h3>
                  <div className="agent-tool-grid">
                    {profile.mcps.map((item, index) => <article key={item}><span>{index + 1}</span><div><b>{item}</b><small>读取范围待配置</small></div><em>待连接</em></article>)}
                  </div>
                  <p className="agent-config-note">MCP 负责连接真实系统和数据；账号、密钥和读写权限由管理员配置。</p>
                </section>
              )}

              {tab === 3 && (
                <section className="agent-list-panel">
                  <small>这个 Agent 应该怎样工作</small><h3>Skills 方法</h3>
                  <div className="agent-tool-grid is-skills">
                    {profile.skills.map((item, index) => <article key={item}><span>0{index + 1}</span><div><b>{item}</b><small>方法、步骤与模板</small></div><em>待配置</em></article>)}
                  </div>
                  <p className="agent-config-note">Skills 规定工作方法；模型负责理解场景并选择正确方法。</p>
                </section>
              )}

              {tab === 4 && (
                <section className="agent-list-panel">
                  <small>完成后必须留下正式结果</small><h3>产物交付</h3>
                  <div className="agent-output-grid">
                    {profile.outputs.map((item, index) => <article key={item}><span>0{index + 1}</span><b>{item}</b></article>)}
                  </div>
                  <div className="agent-handoff-line"><strong>完成后交给</strong>{profile.handoffs.map((item) => <span key={item}>{item}</span>)}</div>
                </section>
              )}
            </div>

            <div className="agent-composer">
              <textarea value={task} onChange={(event) => setTask(event.target.value)} placeholder={`向${profile.name}说明任务……`} aria-label={`${profile.name}任务输入`} />
              <button type="button" disabled title="接入模型 API 后启用">发送</button>
            </div>
          </div>

          <aside className="agent-runtime-preview">
            <small>接入模型后的运行方式</small>
            <div className="agent-runtime-state"><i /><span>当前状态</span><b>等待任务</b></div>
            <ol>
              <li><span>01</span><b>理解你的任务</b></li>
              <li><span>02</span><b>读取授权数据</b></li>
              <li><span>03</span><b>选择 MCP / Skills</b></li>
              <li><span>04</span><b>请求其他 Agent 协作</b></li>
              <li><span>05</span><b>生成正式产物</b></li>
            </ol>
            <section><small>主要协作对象</small>{profile.handoffs.map((item) => <span key={item}>{item}</span>)}</section>
            <p>模型负责理解和生成；系统负责权限、顺序、记录与人工确认。</p>
          </aside>
        </div>
      </section>
    </div>
  );
}

export function TianquDashboard() {
  const [active, setActive] = useState("all");
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [goal, setGoal] = useState("");
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [outputType, setOutputType] = useState("完整协同包");
  const [drafted, setDrafted] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedDataDomain, setSelectedDataDomain] = useState<DataDomainKey | null>(null);
  const [selectedDataItem, setSelectedDataItem] = useState<string | null>(null);
  const [dataMapZoom, setDataMapZoom] = useState(0.82);
  const [dataMapOffset, setDataMapOffset] = useState({ x: 0, y: 0 });
  const dataDrag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const activeDataDomain = selectedDataDomain ? dataDomains[selectedDataDomain] : null;
  const activeDataItem = activeDataDomain?.items.find((item) => item.name === selectedDataItem) ?? null;

  useEffect(() => {
    if (!decisionOpen && !selectedAgent && !selectedDataDomain) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDecisionOpen(false);
        setSelectedAgent(null);
        setSelectedDataDomain(null);
        setSelectedDataItem(null);
        setActive("all");
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [decisionOpen, selectedAgent, selectedDataDomain]);

  function openDecisionGuide() {
    setDrafted(false);
    setGuideStep(0);
    setDecisionOpen(true);
  }

  function closeAgentWorkspace() {
    setSelectedAgent(null);
    setActive("all");
  }

  function openDataDomain(domain: DataDomainKey) {
    setSelectedDataDomain(domain);
    setSelectedDataItem(null);
    setDataMapZoom(0.82);
    setDataMapOffset({ x: 0, y: 0 });
  }

  function closeDataDomain() {
    setSelectedDataDomain(null);
    setSelectedDataItem(null);
  }

  function changeDataMapZoom(delta: number) {
    setDataMapZoom((zoom) => Math.min(1.5, Math.max(0.5, Number((zoom + delta).toFixed(2)))));
  }

  function handleDataMapWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    changeDataMapZoom(event.deltaY > 0 ? -0.08 : 0.08);
  }

  function handleDataMapPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    dataDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: dataMapOffset.x,
      originY: dataMapOffset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDataMapPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dataDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDataMapOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  }

  function handleDataMapPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dataDrag.current?.pointerId !== event.pointerId) return;
    dataDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><strong>天驱</strong><small>人类决策智能协同</small></div>
        <button type="button" className="human-command" onClick={openDecisionGuide} aria-label="打开人类决策新手引导">
          <span className="decision-side">定义目标与优先级</span>
          <div className="human-core"><strong>人类决策</strong></div>
          <span className="decision-side">确认授权与边界 →</span>
        </button>
      </header>

      <section className="board">
        <section className={`story-stage active-${active}`} aria-label="天驱协作主流程">
          <div className="stage-grid" aria-hidden="true" />

          <div className="downlink" aria-hidden="true"><i /><span>目标、规则与边界同步</span></div>

          <section className="process-flow" aria-label="前线中台后台协作流程">
            <div className="topology-bus" aria-hidden="true"><i /></div>
            <div className="process-beam" aria-hidden="true"><i className="beam-token" /></div>
            {stages.map((stage, index) => (
              <div key={stage.key} className={`process-wrap wrap-${stage.key}`}>
                {index > 0 && <div className="handoff" aria-hidden="true"><span>{index === 1 ? "事实 + 能力" : "判断 + 任务"}</span><i>→</i></div>}
                <div
                  className={`process-node node-${stage.key} ${active === stage.key ? "is-active" : ""}`}
                >
                  <header><span>0{index + 1}</span><div><small>{stage.label}</small><h2>{stage.verb}</h2></div></header>
                  <p>{stage.description}</p>
                  <div className="owner-line">{stage.owners}</div>
                  <div className={`agent-chain chain-${stage.agents.length}`}>
                    <div className="chain-track" aria-hidden="true"><i /></div>
                    {stage.agents.map(([agent, capability], agentIndex) => (
                      <button
                        type="button"
                        key={agent}
                        className={`agent-step step-${agentIndex + 1}`}
                        aria-label={`打开${agent}工作台`}
                        onClick={() => { setActive(stage.key); setSelectedAgent(agent); }}
                      >
                        <span>{String(agentIndex + 1).padStart(2, "0")}</span>
                        <div><b>{agent}</b><small>{capability}</small></div>
                      </button>
                    ))}
                  </div>
                  <div className="node-bottom">
                    <div className="metric-pair">
                      {stage.metrics.map(([name, value]) => <span key={name}><small>{name}</small><b>{value}</b></span>)}
                    </div>
                    <div className="output"><small>输出</small><b>{stage.output}</b></div>
                  </div>
                </div>
              </div>
            ))}
          </section>

          <div className="command-loop" aria-hidden="true"><span>任务与边界下发</span><i /></div>
          <div className="return-loop" aria-hidden="true"><span>结果与待决回流</span><i /></div>

          <section className="data-foundation" aria-label="共同数据底层">
            <div className="floor-depth" aria-hidden="true" />
            <div className="data-title">共同数据底层</div>
            <div className="data-domains">
              <i className="data-flow" aria-hidden="true" />
              <button type="button" onClick={() => openDataDomain("projects")} aria-label="打开项目开发数据面板"><strong>项目开发</strong><b>项目 · 进度</b></button>
              <button type="button" onClick={() => openDataDomain("mcps")} aria-label="打开MCP连接数据面板"><strong>MCP 连接</strong><b>系统 · 工具</b></button>
              <button type="button" onClick={() => openDataDomain("skills")} aria-label="打开Skills能力数据面板"><strong>Skills 能力</strong><b>方法 · 模板</b></button>
              <button type="button" onClick={() => openDataDomain("conversations")} aria-label="打开对话记录数据面板"><strong>对话记录</strong><b>人机 · Agent</b></button>
              <button type="button" onClick={() => openDataDomain("files")} aria-label="打开文件资料数据面板"><strong>文件资料</strong><b>输入 · 产物</b></button>
            </div>
          </section>
        </section>
      </section>

      <div
        className={`decision-overlay ${decisionOpen ? "is-open" : ""}`}
        aria-hidden={!decisionOpen}
      >
        <section className="decision-wireframe" role="dialog" aria-modal={decisionOpen} aria-labelledby="decision-title">
          <header className="wire-header">
            <div><small>新手模式 · 决策引导</small><h2 id="decision-title">人类决策工作台</h2></div>
            <button type="button" className="wire-close" onClick={() => setDecisionOpen(false)}>← 返回总览</button>
          </header>

          <div className="wire-body">
            <nav className="wire-steps" aria-label="新手引导步骤">
              <strong>只需四步</strong>
              {guideSteps.map((step, index) => (
                <button
                  type="button"
                  key={step}
                  className={guideStep === index ? "is-current" : ""}
                  onClick={() => { setDrafted(false); setGuideStep(index); }}
                >
                  <span>0{index + 1}</span>{step}
                </button>
              ))}
              <p>普通用户不需要配置模型、MCP 或 Skills。</p>
            </nav>

            <div className="wire-main">
              {!drafted ? (
                <>
                  <div className="wire-progress"><span style={{ width: `${((guideStep + 1) / guideSteps.length) * 100}%` }} /></div>

                  <div className="wire-content">
                    {guideStep === 0 && (
                      <section className="wire-step-panel">
                        <small>第 1 步</small><h3>告诉系统，你最终想得到什么</h3>
                        <div className="wire-goal-map" aria-label="目标处理路径">
                          <span><b>你描述目标</b><small>只需一句话</small></span><i>→</i>
                          <span><b>模型理解</b><small>识别意图</small></span><i>→</i>
                          <span><b>自动协同</b><small>选择 Agent</small></span><i>→</i>
                          <span><b>返回产物</b><small>交给你确认</small></span>
                        </div>
                        <p>直接从页面底部的输入框开始，不用写提示词，也不用指定 Agent。</p>
                      </section>
                    )}

                    {guideStep === 1 && (
                      <section className="wire-step-panel">
                        <small>第 2 步</small><h3>补充系统可以使用的资料</h3>
                        <label className="wire-upload">
                          <input
                            type="file"
                            multiple
                            onChange={(event) => setFileNames(Array.from(event.target.files ?? []).map((file) => file.name))}
                          />
                          <b>选择文件</b><span>{fileNames.length ? `已选择 ${fileNames.length} 个文件` : "支持表格、文档、图片等资料"}</span>
                        </label>
                        <div className="wire-checks">
                          <label><input type="checkbox" defaultChecked />使用项目数据</label>
                          <label><input type="checkbox" defaultChecked />使用历史对话</label>
                          <label><input type="checkbox" defaultChecked />使用共享文件</label>
                        </div>
                      </section>
                    )}

                    {guideStep === 2 && (
                      <section className="wire-step-panel">
                        <small>第 3 步</small><h3>哪些事情必须回来问你</h3>
                        <div className="wire-boundaries">
                          <label><input type="checkbox" defaultChecked /><span><b>风险结论</b>形成正式风险判断前确认</span></label>
                          <label><input type="checkbox" defaultChecked /><span><b>预算变化</b>新增或调整预算前确认</span></label>
                          <label><input type="checkbox" defaultChecked /><span><b>对外承诺</b>向客户或合作方承诺前确认</span></label>
                        </div>
                      </section>
                    )}

                    {guideStep === 3 && (
                      <section className="wire-step-panel">
                        <small>第 4 步</small><h3>选择你希望拿到的最终产物</h3>
                        <div className="wire-outputs">
                          {["决策摘要", "行动计划", "完整协同包"].map((option) => (
                            <label key={option} className={outputType === option ? "is-selected" : ""}>
                              <input type="radio" name="output" value={option} checked={outputType === option} onChange={() => setOutputType(option)} />
                              <b>{option}</b>
                            </label>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>

                  <div className="decision-composer">
                    <textarea
                      id="decision-goal"
                      value={goal}
                      onChange={(event) => setGoal(event.target.value)}
                      placeholder="输入你希望天驱完成的任务……"
                      aria-label="任务输入"
                    />
                    <button type="button" disabled title="接入模型 API 后启用">发送</button>
                  </div>

                  <footer className="wire-actions">
                    <button type="button" onClick={() => setGuideStep((step) => Math.max(0, step - 1))} disabled={guideStep === 0}>上一步</button>
                    {guideStep < guideSteps.length - 1 ? (
                      <button type="button" className="is-primary" onClick={() => setGuideStep((step) => Math.min(guideSteps.length - 1, step + 1))}>下一步</button>
                    ) : (
                      <button type="button" className="is-primary" onClick={() => setDrafted(true)}>生成任务草稿</button>
                    )}
                  </footer>
                </>
              ) : (
                <section className="draft-ready">
                  <span>✓</span><h3>任务草稿已准备</h3>
                  <p>接入模型 API 后，系统会理解目标、选择 Agent、调用 MCP 与 Skills，并持续汇总结果。</p>
                  <dl><div><dt>目标</dt><dd>{goal || "尚未填写"}</dd></div><div><dt>产物</dt><dd>{outputType}</dd></div></dl>
                  <button type="button" onClick={() => { setDrafted(false); setGuideStep(0); }}>再建一个</button>
                </section>
              )}
            </div>

            <aside className="wire-preview">
              <small>模型接入后的运行路径</small>
              <ol>
                <li><span>01</span><b>理解目标</b></li>
                <li><span>02</span><b>拆解任务</b></li>
                <li><span>03</span><b>选择 Agent</b></li>
                <li><span>04</span><b>调用 MCP / Skills</b></li>
                <li><span>05</span><b>生成并汇总产物</b></li>
              </ol>
              <div className="wire-result"><span>最终返回</span><strong>{outputType}</strong></div>
              <p>系统规则负责权限、顺序和审计；模型负责理解、判断和生成。</p>
            </aside>
          </div>
        </section>
      </div>

      {activeDataDomain && (
        <div className="data-map-overlay">
          <section className="data-map-workspace" role="dialog" aria-modal="true" aria-labelledby="data-map-title">
            <header className="data-map-header">
              <div>
                <small>共同数据底层 · 内容地图</small>
                <h2 id="data-map-title">{activeDataDomain.title}</h2>
                <p>{activeDataDomain.subtitle}</p>
              </div>
              <button type="button" onClick={closeDataDomain}>← 返回总览</button>
            </header>

            <div className="data-map-body">
              <div className="data-map-intro">
                <strong>{activeDataDomain.items.length}</strong>
                <span>个核心内容域</span>
                <p>{activeDataDomain.summary}</p>
                <small>拖动画布 · 滚轮缩放 · 点击节点查看内容</small>
              </div>

              <div className="data-map-toolbar" aria-label="内容地图缩放">
                <button type="button" onClick={() => changeDataMapZoom(-0.1)} aria-label="缩小内容地图">−</button>
                <span>{Math.round(dataMapZoom * 100)}%</span>
                <button type="button" onClick={() => changeDataMapZoom(0.1)} aria-label="放大内容地图">＋</button>
                <button type="button" onClick={() => { setDataMapZoom(0.82); setDataMapOffset({ x: 0, y: 0 }); }}>适应</button>
              </div>

              <div
                className="data-map-viewport"
                onWheel={handleDataMapWheel}
                onPointerDown={handleDataMapPointerDown}
                onPointerMove={handleDataMapPointerMove}
                onPointerUp={handleDataMapPointerUp}
                onPointerCancel={handleDataMapPointerUp}
              >
                <div className="data-map-grid" aria-hidden="true" />
                <div
                  className="data-map-canvas"
                  style={{ transform: `translate(${dataMapOffset.x}px, ${dataMapOffset.y}px) scale(${dataMapZoom})` }}
                >
                  <div className="data-map-orbit orbit-one" aria-hidden="true" />
                  <div className="data-map-orbit orbit-two" aria-hidden="true" />
                  <div className="data-map-core"><small>天驱</small><strong>{activeDataDomain.title}</strong></div>
                  {activeDataDomain.items.map((item) => (
                    <button
                      type="button"
                      key={item.name}
                      className={`data-map-node ${selectedDataItem === item.name ? "is-selected" : ""}`}
                      style={{ left: `${item.x}%`, top: `${item.y}%`, width: item.size, height: item.size }}
                      onClick={() => setSelectedDataItem(item.name)}
                      aria-pressed={selectedDataItem === item.name}
                      aria-label={`查看${item.name}内容`}
                    >
                      <small>{item.category}</small>
                      <strong>{item.name}</strong>
                      <span>查看内容</span>
                    </button>
                  ))}
                </div>
              </div>

              {activeDataItem && (
                <aside className="data-map-detail" aria-label={`${activeDataItem.name}详情`}>
                  <button type="button" className="data-map-detail-close" onClick={() => setSelectedDataItem(null)} aria-label="关闭内容详情">×</button>
                  <small>{activeDataItem.category}</small>
                  <h3>{activeDataItem.name}</h3>
                  <p>{activeDataItem.summary}</p>
                  <dl>
                    {activeDataItem.facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
                  </dl>
                </aside>
              )}
            </div>
          </section>
        </div>
      )}

      {selectedAgent && (
        <AgentWorkspace profile={agentProfiles[selectedAgent]} onClose={closeAgentWorkspace} />
      )}
    </main>
  );
}
