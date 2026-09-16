import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Workbook } from "@oai/artifact-tool";

const workDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(workDir);
const researchDir = path.join(projectDir, "research");
const outputDir = path.join(projectDir, "outputs");
const seedPath = "C:\\Users\\22673\\Documents\\Codex\\2026-08-25\\realtime-voice-chat\\outputs\\中国AI招聘市场证据库-2026-08-26.csv";
const outputCsvPath = path.join(outputDir, "中国AI招聘市场证据库-2026-08-26.csv");
const outputMdPath = path.join(outputDir, "中国AI招聘市场证据库-2026-08-26.md");

const finalHeaders = [
  "record_id", "record_type", "source_type", "company", "business_line", "title_or_signal",
  "city", "job_id", "salary_text", "monthly_min_k", "monthly_max_k", "salary_months",
  "annual_min_k", "annual_max_k", "layer", "industry", "scenario", "technical_route",
  "production_metrics", "ai_relevance", "evidence_grade", "evidence_status", "url", "captured_at",
];

const verificationFiles = [
  "boss-verification.tsv",
  "byte-ali-verification.tsv",
  "main-verification.tsv",
  "jd-misc-verification.tsv",
];

const text = (value) => value === null || value === undefined ? "" : String(value).trim();

function parseTsv(content) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = lines[0].split("\t").map(text);
  return lines.slice(1).map((line, index) => {
    const cells = line.split("\t");
    if (cells.length > headers.length) {
      cells.splice(headers.length - 1, cells.length, cells.slice(headers.length - 1).join(" | "));
    }
    return Object.fromEntries([...headers.map((header, i) => [header, text(cells[i])]), ["__line", index + 2]]);
  });
}

function csvEscape(value) {
  const valueText = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(valueText) ? `"${valueText.replaceAll('"', '""')}"` : valueText;
}

const rowsToCsv = (matrix) => `${matrix.map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
const number = (value) => value === "" || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
const pct = (count, total) => total ? `${((count / total) * 100).toFixed(1)}%` : "0.0%";
const mdCell = (value) => text(value).replaceAll("|", "\\|").replaceAll("\n", " ");

function mdTable(headers, rows) {
  return [
    `| ${headers.map(mdCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`),
  ].join("\n");
}

function countBy(rows, getter) {
  const counts = new Map();
  for (const row of rows) {
    const key = getter(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-CN"));
}

const rowLink = (row) => row.url
  ? `[${row.record_id} ${row.company}｜${row.title_or_signal}](${row.url})`
  : `${row.record_id} ${row.company}｜${row.title_or_signal}（无公开 URL）`;

const evidenceList = (rows) => rows.map((row) => `  - ${rowLink(row)} — ${row.evidence_grade}级，${row.evidence_status}`).join("\n");

function matrixToObjects(matrix) {
  const headers = matrix[0].map(text);
  return matrix.slice(1).filter((row) => row.some((cell) => text(cell))).map((row) => {
    const item = {};
    headers.forEach((header, i) => item[header] = text(row[i]));
    return item;
  });
}

function selectEvidence(allRows, preferredIds, regex, limit = 5) {
  const selected = [];
  const seen = new Set();
  for (const id of preferredIds) {
    const row = allRows.find((item) => item.record_id === id && item.url);
    if (row) {
      selected.push(row);
      seen.add(row.record_id);
    }
  }
  for (const row of allRows) {
    if (selected.length >= limit) break;
    const haystack = `${row.company} ${row.business_line} ${row.title_or_signal} ${row.industry} ${row.scenario} ${row.technical_route}`;
    if (row.url && regex.test(haystack) && !seen.has(row.record_id)) {
      selected.push(row);
      seen.add(row.record_id);
    }
  }
  return selected.slice(0, limit);
}

const workflowClusters = [
  {
    name: "电商：经营、推荐与准入治理",
    preferred: ["BYTE-016", "JD-008", "JD-004", "TENCENT-001", "TENCENT-006"],
    regex: /电商|零售|商家|商品|GMV|推荐|广告/u,
    trigger: "有证据的推断：商品/商家准入、流量与转化异常、营销投放或经营诊断。",
    roles: "事实：岗位出现算法、产品运营、内容/准入治理；推断：商家运营、风控审核、类目与客服共同参与。",
    agents: "推断：商品理解/推荐 Agent、经营诊断 Agent、准入审核 Agent；待验证：是否共享同一任务状态。",
    systems: "推断：商品库、订单/流量日志、商家后台、审核与申诉系统；具体系统名待验证。",
    decision: "事实：材料出现准入、拒绝解释、GMV/转化等目标；待验证：审核、业务和算法负责人各自的最终权限。",
    handoff: "推断：机器初筛 → 业务/风控复核 → 商家申诉 → 规则或模型回灌。",
    gate: "待验证假设：高风险封禁、重大流量调整、规则变更与申诉终局必须人工批准。",
    metric: "事实：GMV、转化、AI penetration、拒绝原因可解释；部分只给目标，未给阈值。",
  },
  {
    name: "金融：支付、风控与智能投研",
    preferred: ["BOSS-001", "BYTE-018", "JD-005", "BOSS-021", "BOSS-022"],
    regex: /金融|支付|投研|反欺诈|反洗钱|风控|安全评测/u,
    trigger: "有证据的推断：支付/交易异常、风险告警、投研问题、合规复核与客户尽调。",
    roles: "事实：材料出现支付 AI、反欺诈/反洗钱、安全评测与投研；推断：业务、风控、合规、运营和技术共同处置。",
    agents: "推断：交易风险 Agent、证据检索 Agent、投研分析 Agent、合规检查 Agent。",
    systems: "推断：交易流水、客户/商户档案、规则引擎、案例库、研究与行情数据；具体接口待验证。",
    decision: "待验证：冻结/放行交易、提升风险等级、发布投研结论的最终决策权。",
    handoff: "推断：异常识别 → 证据聚合 → 专业复核 → 处置/申诉 → 规则更新。",
    gate: "待验证假设：资金处置、客户拒绝、重大风险结论和外发内容必须人工签核。",
    metric: "事实：材料强调准确性、稳定性、风险与客户成功；待验证误杀率、漏检率、损失率阈值。",
  },
  {
    name: "视频生成：多模态内容生产",
    preferred: ["BYTE-014", "BAIDU-005", "OPPO-001", "BYTE-004"],
    regex: /视频|图像|多模态|AIGC|内容生成/u,
    trigger: "有证据的推断：视频/图像生成需求、素材生产、编辑与质量回检。",
    roles: "事实：岗位覆盖多模态模型、视频/图像生成与生产线方案；推断：创意、运营、品牌、审核和算法协作。",
    agents: "推断：脚本/分镜 Agent、生成 Agent、质量检查 Agent、版权/安全检查 Agent。",
    systems: "推断：素材库、品牌规范、模型服务、渲染/编辑工具、内容发布与审核系统。",
    decision: "待验证：创意定稿、品牌一致性、安全发布和成本/时延取舍由谁决定。",
    handoff: "推断：brief → 分镜/素材 → 批量生成 → 质量与安全复核 → 发布/迭代。",
    gate: "待验证假设：品牌主视觉、人物/版权风险和大规模投放前必须人工批准。",
    metric: "事实：产品效果、研发效率、资源利用率、Token/时延/ROI 等维度出现；阈值未公开。",
  },
  {
    name: "本地生活：履约、运营与大规模 Agent 协作",
    preferred: ["MEITUAN-S01", "MEITUAN-S02", "MEITUAN-S03", "BOSS-003"],
    regex: /本地生活|外卖|履约|LongCat|CatPaw|北斗|出行/u,
    trigger: "有证据的推断：订单高峰、履约异常、门店/商家运营问题或员工发起自动化任务。",
    roles: "事实：官方材料给出大规模用户、订单、员工和 Agent 场景；推断：运营、调度、商家、客服、风控与研发参与。",
    agents: "事实：材料出现企业 Agent 工作台；推断：履约诊断、商家运营、客服与知识 Agent。",
    systems: "推断：订单、配送、商家、用户、客服、地图/调度与员工协作系统。",
    decision: "待验证：异常补偿、调度调整、商家处置与跨部门优先级的决策权。",
    handoff: "推断：事件监测 → Agent 诊断 → 责任团队接单 → 人工处置 → 结果回写。",
    gate: "待验证假设：大额补偿、批量调度、商家处罚和敏感回复需人工 Gate。",
    metric: "事实：8亿用户、每日1亿订单、9万员工、3万个 Agent 为场景规模信号，不等于效果指标。",
  },
  {
    name: "企业自动化：知识、办公与跨部门流程",
    preferred: ["BAIDU-003", "BYTE-010", "BYTE-011", "BYTE-015", "OPPO-007"],
    regex: /企业|办公|知识库|协作|自动化|财务|HR/u,
    trigger: "有证据的推断：员工查询、文档/流程处理、内部服务请求或跨部门审批。",
    roles: "事实：岗位覆盖办公 Agent、企业知识库、协作自动化与 IT 系统 AI 重构；推断：业务员工、流程 Owner、IT、法务/安全共同参与。",
    agents: "推断：知识检索 Agent、流程执行 Agent、审批辅助 Agent、系统集成 Agent。",
    systems: "事实：材料提到营销/供应链/研发/财务/HR/办公；推断：OA、知识库、ERP、CRM、工单系统。",
    decision: "待验证：流程 Owner 决定规则，数据 Owner 决定访问，业务负责人决定结果采用。",
    handoff: "推断：请求进入 → 权限/上下文校验 → 多系统执行 → 人工审批 → 结果与证据归档。",
    gate: "事实：知识权限一致性被强调；待验证假设：越权、外发、财务/人事变更和不可逆写入必须人工批准。",
    metric: "事实：任务执行效果、场景适配、可靠/及时/权限一致、员工时间节省等维度出现；部分为研发目标。",
  },
  {
    name: "供应链：采购、物流与异常处置",
    preferred: ["BYTE-012", "JD-006", "HUAWEI-005", "OPPO-007"],
    regex: /供应链|采购|物流|库存|履约/u,
    trigger: "有证据的推断：采购需求、供应商异常、库存/物流偏差或履约成本超标。",
    roles: "事实：材料出现采购 Agent、物流 AI 与企业供应链 IT；推断：采购、计划、仓储、物流、财务、法务和供应商协同。",
    agents: "推断：采购需求 Agent、供应商风险 Agent、库存/履约诊断 Agent、合同证据 Agent。",
    systems: "推断：ERP、SRM、WMS、TMS、合同/票据与供应商主数据；具体系统待验证。",
    decision: "待验证：供应商准入、订单调整、加急运输、索赔和付款的最终权限。",
    handoff: "推断：异常事件 → 影响评估 → 方案比选 → 人工批准 → 多系统执行与追踪。",
    gate: "待验证假设：供应商切换、价格/合同变更、付款和大额库存处置必须人工 Gate。",
    metric: "事实：个别物流岗位给出人工操作、成本、研发效率量化目标；核验显示这些多为岗位目标，非已达成结果。",
  },
  {
    name: "客服：多 Agent 服务与客户成功",
    preferred: ["BYTE-017", "JD-009", "JD-012", "BAIDU-006", "BAIDU-002"],
    regex: /客服|客户服务|智能服务|客户成功|多Agent/u,
    trigger: "有证据的推断：用户咨询、投诉、服务异常、售后或客户项目风险。",
    roles: "事实：岗位出现多 Agent 客户服务、智能服务与客户成功；推断：一线客服、专家坐席、运营、产品和质量团队协作。",
    agents: "推断：意图识别 Agent、知识 Agent、执行 Agent、质检 Agent、升级路由 Agent。",
    systems: "推断：CRM、工单、知识库、订单/账户、质检与客户反馈系统。",
    decision: "待验证：自动答复边界、退款/补偿、重大投诉升级和知识发布权限。",
    handoff: "推断：识别 → 检索/执行 → 置信度或风险判断 → 人工接管 → 质检回流。",
    gate: "待验证假设：低置信度、高损失、高情绪或政策例外问题必须人工接管。",
    metric: "事实：任务成功率、稳定性、客户成功、用户/商家规模与 7×24 服务等维度出现；阈值多待验证。",
  },
  {
    name: "AI Coding：研发全流程与工程效能",
    preferred: ["BYTE-007", "BYTE-008", "BYTE-009", "OPPO-006", "BAIDU-001"],
    regex: /Coding|代码|研发效能|TRAE|Codex|Claude Code|DevOps/u,
    trigger: "有证据的推断：需求进入、代码生成/修改、测试失败、发布准备或线上故障。",
    roles: "事实：岗位覆盖 Coding Agent、评测、研发平台与 Agentic 工作方式；推断：开发、测试、代码 Owner、安全和发布负责人协作。",
    agents: "事实：材料直接出现 Coding Agent；推断：规划、编码、测试、评审、故障诊断 Agent。",
    systems: "事实：材料出现 CLI、MCP、SDK、Skill、Sandbox、可观测；推断：代码库、CI/CD、测试、缺陷、发布与监控系统。",
    decision: "待验证：需求接受、代码合并、测试豁免、生产发布与回滚决策权。",
    handoff: "推断：需求 → 计划 → 代码/测试 → 人工评审 → 发布 Gate → 监控/回滚。",
    gate: "事实：岗位强调边界、可靠性和生产级使用；待验证假设：合并与生产写入必须由人类 Owner 批准。",
    metric: "事实：Correctness、交付质量/效率、并发、稳定性、诊断效率等维度出现；公开阈值有限。",
  },
  {
    name: "内容治理：审核、风险与申诉闭环",
    preferred: ["BYTE-016", "TENCENT-001", "TENCENT-002", "TENCENT-003", "TENCENT-004"],
    regex: /治理|审核|内容安全|风险|准入|Guardrail/u,
    trigger: "有证据的推断：内容/商家准入、风险命中、用户举报、审核申诉或规则更新。",
    roles: "事实：岗位覆盖电商治理、商业内容审核、内容风险与视频号安全；推断：审核员、政策、法务、安全、产品和算法共同参与。",
    agents: "推断：内容理解 Agent、规则/政策 Agent、证据聚合 Agent、申诉辅助 Agent。",
    systems: "推断：内容库、规则库、审核队列、用户举报、处罚与申诉系统。",
    decision: "事实：部分材料强调拒绝原因可解释；待验证：处罚等级、例外、申诉终局和规则发布权限。",
    handoff: "推断：机器预审 → 人工复核 → 处置 → 申诉 → 规则/样本回流。",
    gate: "待验证假设：高影响账号/商家处罚、政策例外和终局申诉必须人工决定。",
    metric: "事实：可解释性、准确/稳定等维度出现；待验证误杀、漏检、时延和申诉改判率阈值。",
  },
  {
    name: "终端 OS / IoT：端云协同与量产",
    preferred: ["OPPO-003", "OPPO-004", "XIAOMI-S03", "XIAOMI-S04", "BOSS-002"],
    regex: /OS|IoT|终端|车控|端侧|跨端|智能设备/u,
    trigger: "有证据的推断：系统级智能功能调用、跨设备任务、端侧资源受限或量产问题。",
    roles: "事实：岗位/课题涉及系统级 Agent、AIOS、OS 集成、IoT 协议与边缘调度；推断：OS、应用、硬件、模型、测试与产品团队协作。",
    agents: "推断：设备控制 Agent、端云路由 Agent、个人记忆 Agent、系统诊断 Agent。",
    systems: "事实：材料出现端侧部署、跨端、IoT 与系统框架；推断：设备能力目录、权限、传感器、云模型与 OTA 系统。",
    decision: "待验证：设备权限、端云执行选择、资源预算、量产准入与故障降级的最终权限。",
    handoff: "推断：用户意图 → 权限/设备状态 → 端云编排 → 人工确认高风险动作 → 执行/回执。",
    gate: "待验证假设：隐私敏感数据、物理设备控制、支付和不可逆动作必须人工确认。",
    metric: "事实：性能、功耗、内存、可用性、时延、成功率、量产落地等维度出现；阈值未公开。",
  },
];

async function loadSeed() {
  const seedText = await fs.readFile(seedPath, "utf8");
  const seedWorkbook = await Workbook.fromCSV(seedText, { sheetName: "Seed" });
  return matrixToObjects(seedWorkbook.worksheets.getItem("Seed").getUsedRange(true).values);
}

async function loadVerifications() {
  const all = [];
  for (const filename of verificationFiles) {
    const fullPath = path.join(researchDir, filename);
    const content = await fs.readFile(fullPath, "utf8");
    for (const row of parseTsv(content)) all.push({ ...row, __file: filename });
  }
  return all;
}

function applyVerification(seedRows, verificationRows) {
  const byId = new Map();
  for (const row of verificationRows) {
    const id = row.seed_record_id;
    if (!id) throw new Error(`Missing seed_record_id in ${row.__file}:${row.__line}`);
    if (byId.has(id)) throw new Error(`Duplicate verification for ${id}`);
    if (!['keep', 'drop'].includes(row.keep_or_drop)) throw new Error(`Invalid keep_or_drop for ${id}`);
    byId.set(id, row);
  }
  const missing = seedRows.filter((row) => !byId.has(row.record_id)).map((row) => row.record_id);
  const extras = verificationRows.filter((row) => !seedRows.some((seed) => seed.record_id === row.seed_record_id)).map((row) => row.seed_record_id);
  if (missing.length || extras.length) throw new Error(`Verification coverage mismatch; missing=${missing.join(',')}; extras=${extras.join(',')}`);

  const dropped = [];
  const kept = [];
  for (const seed of seedRows) {
    const verification = byId.get(seed.record_id);
    if (verification.keep_or_drop === "drop") {
      dropped.push({ ...seed, drop_notes: verification.notes || verification.evidence_status });
      continue;
    }
    const row = { ...seed };
    row.company = verification.company || row.company;
    row.title_or_signal = verification.title || row.title_or_signal;
    row.city = verification.city || "";
    row.job_id = verification.job_id || "";
    row.url = verification.url || "";
    row.source_type = verification.source_type;
    row.evidence_grade = verification.evidence_grade;
    row.evidence_status = verification.evidence_status;
    row.ai_relevance = verification.ai_relevance;
    row.production_metrics = verification.production_metrics || "";
    if (Object.hasOwn(verification, "salary_text")) {
      row.salary_text = verification.salary_text || "";
      row.monthly_min_k = verification.monthly_min_k || "";
      row.monthly_max_k = verification.monthly_max_k || "";
      row.salary_months = verification.salary_months || "";
    }
    const monthlyMin = number(row.monthly_min_k);
    const monthlyMax = number(row.monthly_max_k);
    const salaryMonths = number(row.salary_months);
    if (monthlyMin !== null && monthlyMax !== null && salaryMonths !== null) {
      row.annual_min_k = String(monthlyMin * salaryMonths);
      row.annual_max_k = String(monthlyMax * salaryMonths);
    } else {
      row.annual_min_k = "";
      row.annual_max_k = "";
    }
    for (const header of finalHeaders) row[header] = text(row[header]);
    kept.push({ ...row, __verification_notes: verification.notes || "" });
  }
  return { kept, dropped };
}

function dedupe(rows) {
  const seen = new Map();
  const kept = [];
  const removed = [];
  for (const row of rows) {
    const direct = row.source_type === "official_careers_direct" || row.source_type === "BOSS_direct_detail";
    const key = row.record_type === "strategy_topic"
      ? `strategy|${row.company}|${row.title_or_signal}`
      : row.job_id
        ? `jobid|${row.company}|${row.job_id}`
        : direct && row.url
          ? `direct|${row.url}`
          : `title|${row.company}|${row.title_or_signal}|${row.city}`;
    if (seen.has(key)) removed.push({ ...row, duplicate_of: seen.get(key).record_id });
    else {
      seen.set(key, row);
      kept.push(row);
    }
  }
  return { kept, removed };
}

function qualityStats(rows, seedCount, droppedCount, dedupeRemovedCount, verificationDuplicateCount) {
  const jobs = rows.filter((row) => row.record_type === "job");
  const fields = [
    "company", "title_or_signal", "layer", "scenario", "evidence_status", "city", "job_id",
    "salary_text", "technical_route", "production_metrics", "ai_relevance", "evidence_grade", "url",
  ];
  const duplicateUrls = countBy(rows.filter((row) => row.url), (row) => row.url)
    .filter(([, count]) => count > 1)
    .map(([url, count]) => {
      const matches = rows.filter((row) => row.url === url);
      const shared = matches.every((row) => /_index$/.test(row.source_type) || row.source_type === "official_program");
      return {
        url,
        count,
        recordIds: matches.map((row) => row.record_id),
        reason: shared ? "共享官方/BOSS索引或项目页；记录由独立岗位ID、标题或课题区分" : "需人工复核：非纯索引 URL 重复",
      };
    });
  const domainMismatches = rows.filter((row) => {
    if (!row.url) return false;
    const lower = row.url.toLowerCase();
    return row.source_type.startsWith("BOSS_") ? !lower.includes("zhipin.com") : lower.includes("zhipin.com");
  });
  return {
    seedCount,
    dedupedCandidateCount: seedCount - dedupeRemovedCount - verificationDuplicateCount,
    validCount: rows.length,
    removedCount: droppedCount + dedupeRemovedCount,
    verificationDroppedCount: droppedCount,
    verificationExcludedCount: droppedCount - verificationDuplicateCount,
    duplicateRemovedCount: dedupeRemovedCount + verificationDuplicateCount,
    dedupeRemovedCount,
    jobs: jobs.length,
    strategy: rows.filter((row) => row.record_type === "strategy_topic").length,
    urls: rows.filter((row) => row.url).length,
    jobUrls: jobs.filter((row) => row.url).length,
    jobIds: rows.filter((row) => row.job_id).length,
    metrics: rows.filter((row) => row.production_metrics).length,
    salary: rows.filter((row) => row.salary_text).length,
    sourceCounts: countBy(rows, (row) => row.source_type),
    gradeCounts: countBy(rows, (row) => row.evidence_grade),
    completeness: fields.map((field) => {
      const count = rows.filter((row) => text(row[field])).length;
      return [field, count, pct(count, rows.length)];
    }),
    duplicateUrls,
    domainMismatches,
  };
}

async function loadUrlSamples() {
  try {
    return parseTsv(await fs.readFile(path.join(researchDir, "url-sample.tsv"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function generateReport(rows, stats, urlSamples, droppedRows) {
  const jobs = rows.filter((row) => row.record_type === "job");
  const salaryRows = jobs.filter((row) => number(row.monthly_max_k) !== null);
  const monthlyTop = [...salaryRows]
    .sort((a, b) => number(b.monthly_max_k) - number(a.monthly_max_k) || number(b.monthly_min_k) - number(a.monthly_min_k))
    .slice(0, 10);
  const annualTop = salaryRows.filter((row) => number(row.annual_max_k) !== null)
    .sort((a, b) => number(b.annual_max_k) - number(a.annual_max_k) || number(b.annual_min_k) - number(a.annual_min_k))
    .slice(0, 10);

  const locationMap = new Map();
  for (const row of jobs) {
    const cities = row.city ? row.city.split(/[、,，;；/]/u).map((city) => city.replace(/市$/u, "").trim()).filter(Boolean) : ["未公开"];
    for (const city of new Set(cities)) locationMap.set(city, (locationMap.get(city) || 0) + 1);
  }
  const locations = [...locationMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));

  const techCategories = [
    ["Agent / Agentic / 多智能体", /Agent|Agentic|智能体|Multi-Agent/i],
    ["LLM / 大模型", /LLM|大模型/i],
    ["评测 / 安全 / 治理 / 可观测", /Evaluation|Evaluate|Guardrail|评测|安全|治理|Observability|可观测/i],
    ["训练 / 对齐 / 强化学习", /SFT|RLHF|DPO|PPO|GRPO|Agentic RL|训练/i],
    ["推理 / Serving / MaaS", /Inference|Serving|MaaS|vLLM|SGLang|推理/i],
    ["多模态 / VLM / 视频图像", /Multimodal|VLM|多模态|视频|图像/i],
    ["Memory / RAG / 检索", /Memory|RAG|记忆|检索/i],
    ["MCP / Tool Use / Function Calling", /MCP|Tool Use|Function Calling|工具调用/i],
    ["Sandbox / 容器 / 云原生", /Sandbox|Kubernetes|Container|Firecracker|gVisor|Kata|云原生|沙箱/i],
    ["AI Coding / CLI / IDE", /AI Coding|Coding|Claude Code|Codex|TRAE|IDE/i],
  ].map(([name, regex]) => [name, jobs.filter((row) => regex.test(row.technical_route)).length])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const companyGroups = [
    ["字节/火山/飞书/BytePlus/PIPO", /字节|火山|飞书|BytePlus|PIPO/i],
    ["百度/百度智能云", /百度/i],
    ["阿里巴巴", /阿里/i],
    ["京东/京东国际/京东物流", /京东/i],
    ["腾讯/微信", /腾讯|微信/i],
    ["华为", /华为/i],
    ["OPPO", /OPPO/i],
    ["小米", /小米/i],
    ["美团", /美团/i],
  ].map(([label, regex]) => {
    const matches = rows.filter((row) => regex.test(row.company));
    const topLayer = countBy(matches, (row) => row.layer)[0]?.[0] || "—";
    const scenarios = [...new Set(matches.map((row) => row.scenario).filter(Boolean))].slice(0, 3).join("；") || "—";
    return [label, matches.length, topLayer, scenarios];
  });

  const layerLabel = {
    base_model_compute: "基础模型 / 算力",
    platform_runtime_governance: "Agent 平台 / Runtime / 治理",
    business_application: "业务应用",
  };
  const layerRows = countBy(rows, (row) => row.layer).map(([layer, count]) => [
    layerLabel[layer] || layer,
    count,
    layer === "base_model_compute"
      ? "训练/后训练、推理、算力、数据与多模态底座"
      : layer === "platform_runtime_governance"
        ? "Agent 运行、工具调用、沙箱、评测、治理、可观测与平台化"
        : "电商、客服、办公、供应链、内容、终端等业务落地",
  ]);

  const cards = workflowClusters.map((cluster, index) => {
    const evidence = selectEvidence(rows, cluster.preferred, cluster.regex, 5);
    return `### ${index + 1}. ${cluster.name}\n\n` +
      "选择理由：综合投入信号、生产指标清晰度、跨人/Agent/系统复杂度、持续时间、异常成本与跨企业迁移性；不是按岗位数或薪资机械排序。\n\n" +
      mdTable(["字段", "工作流反推线索"], [
        ["典型业务事项 / 触发事件", cluster.trigger],
        ["参与部门与人类角色", cluster.roles],
        ["可能的共享 Agent / 专用 Agent", cluster.agents],
        ["现有系统或数据源", cluster.systems],
        ["关键决策点与谁有权决定", cluster.decision],
        ["责任交接点", cluster.handoff],
        ["必须人工介入的 Human Gate", cluster.gate],
        ["明确业务指标", cluster.metric],
        ["事实 / 推断 / 假设边界", evidence.length >= 3 ? `事实来源 ${evidence.length} 条；流程字段均在单元格内标注事实、推断或待验证假设。` : `仅 ${evidence.length} 条可点击来源；证据不足，必须追加验证。`],
      ]) + `\n\n来源岗位 / 官方材料：\n\n${evidenceList(evidence)}`;
  }).join("\n\n");

  const duplicateTable = stats.duplicateUrls.length
    ? mdTable(["重复 URL", "次数", "记录", "合理原因"], stats.duplicateUrls.map((item) => [item.url, item.count, item.recordIds.join("、"), item.reason]))
    : "未发现重复 URL。";
  const sampleCompanyCount = new Set(urlSamples.map((row) => row.company).filter(Boolean)).size;
  const droppedCompanySummary = countBy(droppedRows, (row) => row.company).map(([company, count]) => `${company} ${count}`).join("；") || "无";
  const sourceCounts = mdTable(["source_type", "记录数"], stats.sourceCounts);
  const completeness = mdTable(["字段", "非空数", "完整率"], stats.completeness);

  return `# 中国 AI 招聘市场证据库与业务研究报告（2026-08-26）

> 结论边界：公开招聘文本、公开薪资和官方人才/产品材料只是**投入方向的代理信号**。它们不能证明企业预算、完整组织结构、内部流程或确定战略；岗位也可能在抓取后下线。

## 1. 方法、来源结构与数据漏斗

本轮从 ${stats.seedCount} 条种子候选开始，先枚举，再按岗位 ID、URL 与“公司 + 原标题 + 城市”去重；阅读标题、职责和业务域，区分核心 AI 投入、AI 邻接转型和关键词噪声。BOSS 只承担薪资广度，官方站承担较新的场景、技术路线和生产指标证据。

${mdTable(["阶段", "记录数", "说明"], [
  ["原始候选", stats.seedCount, "种子 CSV 的 job 与 strategy_topic"],
  ["记录级去重后", stats.dedupedCandidateCount, `移除 ${stats.duplicateRemovedCount} 条重复；共享索引页不视为重复岗位`],
  ["有效证据", stats.validCount, `${stats.jobs} 条 job；${stats.strategy} 条 strategy_topic`],
  ["剔除", stats.removedCount, `${stats.verificationExcludedCount} 条无法核验/噪声；${stats.duplicateRemovedCount} 条重复`],
])}

9 条剔除由复核 TSV 明确给出：字节 1 条重复岗位、1 条无法映射的复合旧摘要、1 条缺原标题/ID/URL；BOSS 3 条因薪资/标题无法稳定对应；京东 3 条缺原始字段且无法唯一重现。剔除项公司分布：${droppedCompanySummary}。

来源结构：

${sourceCounts}

AI 相关性分级（有效库）：

${mdTable(["ai_relevance", "记录数"], countBy(rows, (row) => row.ai_relevance))}

**core_ai_investment** 表示职责核心就是模型、Agent、AI Infra 或 AI 业务能力；**ai_adjacent_transformation** 表示既有业务/IT 正在被 AI 改造；**keyword_noise** 不进入有效库。该分级基于公开职责文本，不是企业组织标签。

## 2. 字段完整率、证据等级与可复核边界

${completeness}

证据等级：${stats.gradeCounts.map(([grade, count]) => `${grade}=${count}`).join("；")}。A 为本轮可读官方详情/原页；B 为可识别岗位标题/ID/业务域的官方索引；C 包括 BOSS 搜索索引、官方 JS 空页、snippet-only 或存续冲突。D 不进入有效库。

- 非空 URL ${stats.urls}/${stats.validCount}（${pct(stats.urls, stats.validCount)}）；job URL ${stats.jobUrls}/${stats.jobs}（${pct(stats.jobUrls, stats.jobs)}）。
- 岗位 ID ${stats.jobIds}/${stats.validCount}；production_metrics ${stats.metrics}/${stats.validCount}；公开薪资 ${stats.salary}/${stats.validCount}。
- BOSS 详情本轮均跳安全校验，故无 direct_detail；公开索引按 search_index 或 snippet_only 降级。官方岗位无公开薪资时留空。
- 腾讯 6 条官方索引同时有近期岗位正文和“目前暂时未有岗位开放”，统一标 C，不声称实时在招。

重复 URL 审计：

${duplicateTable}

域名与 source_type 基础一致性：${stats.domainMismatches.length === 0 ? "0 个不一致" : `${stats.domainMismatches.length} 个待复核：${stats.domainMismatches.map((row) => row.record_id).join("、")}`}。

## 3. BOSS 月薪 Top10 与可计算年薪 Top10

月薪按上限降序、下限作为次序；年薪仅在招聘文本明确薪资月数时计算，按年薪上限降序。单位均为千元（K）。

### 月薪 Top10

${mdTable(["排名", "证据", "月薪", "区间 K", "等级", "异常"], monthlyTop.map((row, index) => [
  index + 1, rowLink(row), row.salary_text, `${row.monthly_min_k}-${row.monthly_max_k}`, row.evidence_grade,
  number(row.monthly_max_k) >= 200 ? "异常高值：单一公开索引，不能代表市场常态" : "—",
]))}

### 可计算年薪 Top10

${mdTable(["排名", "证据", "月数", "年薪区间 K", "等级", "异常"], annualTop.map((row, index) => [
  index + 1, rowLink(row), row.salary_months, `${row.annual_min_k}-${row.annual_max_k}`, row.evidence_grade,
  number(row.annual_max_k) >= 3000 ? "异常高值：高薪与高月数叠加" : "—",
]))}

高薪样本更集中在总体架构权、AI Infra、Agent 平台/Runtime、系统级 AI 与高风险业务能力，而非简单接入；但这只是招聘定价信号，不等于预算或实际录用薪酬。

## 4. 三层投入结构

${mdTable(["层级", "记录数", "含义"], layerRows)}

直接事实：上表只是证据库分布。分析推断：企业同时为底座、生产运行能力和业务结果招聘。待验证：三层真实预算比例、汇报线和人员规模。

## 5. 十个高频行业 / 场景簇与工作流反推线索卡

以下十类不是按数量机械排序，而是综合投入信号、指标清晰度、跨人/Agent/系统复杂度、持续时间、异常成本和可迁移性。卡片只为下游工作流重构提供输入，不声称还原企业内部流程。

${cards}

## 6. 生产指标与研发预期

production_metrics 非空 ${stats.metrics} 条，来源差异明显：BOSS 高薪样本没有已实现生产指标；字节/阿里主要给职责指标或规模信号；京东等仅少数给可复核规模；百度/OPPO更多给成功率、稳定性、时延、资源、功耗等运行维度。

1. **量化生产目标**：人工操作减少 40%+、成本降低 20%、研发效率提升 30% 等在核验中被识别为岗位目标，不冒充已达成结果。
2. **现有规模信号**：如用户、订单、商家、员工、Agent 数与 7×24 服务；它们证明场景规模，不证明 AI 效果。
3. **可观测指标维度**：成功率、准确率、稳定性、并发、时延、Token、资源利用率、功耗、内存、客户成功、交付验收；多数无阈值。
4. **研发预期**：快速原型、工程落地、提升体验、技术创新、能力平台化、场景可行性等不计入 production_metrics。

## 7. 地域分布与公司证据分工

城市统计按多城市岗位拆分，因此合计可大于 job 数：

${mdTable(["城市", "岗位提及数"], locations.slice(0, 15))}

各公司“样本内证据焦点”（不是确定战略）：

${mdTable(["公司组", "记录数", "样本主层级", "代表场景"], companyGroups)}

分析推断：北京更聚集模型、平台与总部级产品；上海同时出现高薪平台架构、金融/内容和 Agent 研究；深圳/东莞更多连接终端、AIOS、IoT 与企业 IT；杭州承接电商、云与平台岗位。城市为空只代表公开页未返回。

## 8. 共性技术路线（仅可数口径）

按 job 行 technical_route 做记录级命中计数，同一岗位同一路线只计一次；标签是研究者映射，不是企业统一命名。

${mdTable(["共性路线", "命中岗位数"], techCategories)}

分析推断：企业需求正从单点模型能力转向“模型 + 工具 + 运行环境 + 评测/治理 + 业务系统”的组合交付。

## 9. 已充分建设的能力 vs 仍少见的组织级能力

已高频建设：模型训练/后训练/推理/多模态；Agent 规划、工具调用、Memory/RAG、多 Agent、评测与 Coding；云原生 Infra、沙箱、调度、可观测、性能/成本；电商、客服、办公、内容治理、终端和供应链专用应用。

公开招聘中仍少见：跨部门共享工作项与统一状态；明确决策权、Human Gate、异常升级、回滚和责任交接；跨系统证据链、版本化上下文与审计；同一治理/运行框架横跨多业务并用可比较指标验收。“少见”只表示公开文本很少显式描述，不证明企业内部不存在。

## 10. RelayOS 后置、可证伪映射假设

1. **共享工作状态**：若 RelayOS 把跨角色任务、证据、Agent 输出和责任交接放进同一可审计状态，可能补组织级空位。反证：企业现有平台已普遍等价，新增共享层不降低周期、错误或审计成本。
2. **Human Gate**：高异常成本场景需要显式决策权和人工 Gate。反证：受控试验中全自动在损失、合规和体验上稳定优于人工 Gate。
3. **跨系统持续性**：企业更需要可恢复的长流程与证据交接，而非单轮 Copilot。反证：十场景的主要价值都能在单系统短会话内完成，跨系统状态不改善指标。
4. **共性内核**：十场景可共享“工作项—证据—角色/权限—Agent—决策—Gate—执行—回执—复盘”。反证：压力测试显示数据、状态、权限和异常机制高度不兼容，共用内核提高成本与错误率。

## 11. 跨行业共性抽象（下游输入）

十张卡先提出八个待验证对象：工作项、触发事件、证据包、人类角色/决策权、共享/专用 Agent、Human Gate、系统写入/回执、异常/恢复/指标。下一阶段应把它们作为**假设 schema**，用十场景模拟数据验证，而不是先做十套模板。

## 12. 现在最值得做什么（一页版）

现在最值得做的不是再做一个通用 Agent Builder，也不是一次实现十套界面，而是证明一套组织级工作流内核能跨业务降低错误、缩短周期并保留责任链。

- 先用两个高差异场景校准：一个高风险决策流（内容治理/金融），一个长链路执行流（供应链/企业自动化）。
- 冻结最小契约：触发、状态、证据版本、角色/决策权、Agent 输入输出、Human Gate、系统写入、回执、异常与回滚。
- 为十场景生成模拟数据，验证状态可恢复、责任可追、错误可拦、指标可算，而不是追求“像真 UI”。
- 每场景至少一个业务、风险和效率指标；没有阈值、Owner、失败处理和数据来源，不进入“已完成”。
- 设置停止条件：若公共字段过少、定制成本过高，或 Human Gate/证据链不改善指标，应收缩 RelayOS 通用化主张。

商业判断：高薪与官方岗位共同指向“生产级 AI + 业务结果 + 风险/可靠性”的组合价值。RelayOS 的机会若存在，不在模型或单点 Copilot，而在能否把多人、多 Agent、多系统、长周期、高异常成本工作变成可测量、可恢复、可审计的流程。

## 13. URL 抽样与验收记录

抽样 ${urlSamples.length} 个非空 URL，覆盖 ${sampleCompanyCount} 家公司/公司组：

${urlSamples.length ? mdTable(["record_id", "公司", "来源", "URL", "结果", "说明"], urlSamples.map((sample) => [sample.record_id, sample.company, sample.source_type, `[打开](${sample.url})`, sample.result, sample.notes])) : "尚未写入 URL 抽样记录。"}

“JS 空页”“安全页/超时”“索引冲突”不等于岗位虚假，只表示本轮公开抓取无法读取完整正文；相应记录已降级，不声称实时在招。
`;
}

async function build() {
  await fs.mkdir(outputDir, { recursive: true });
  const seedRows = await loadSeed();
  const verificationRows = await loadVerifications();
  const { kept: verifiedRows, dropped } = applyVerification(seedRows, verificationRows);
  const { kept: finalRows, removed: duplicateRemoved } = dedupe(verifiedRows);

  const requiredPerRow = [
    "record_id", "record_type", "company", "title_or_signal", "layer", "scenario",
    "evidence_status", "ai_relevance", "evidence_grade", "url",
  ];
  for (const row of finalRows) {
    const missing = requiredPerRow.filter((field) => !row[field]);
    if (missing.length) throw new Error(`${row.record_id} missing required fields: ${missing.join(',')}`);
  }
  const duplicateIds = countBy(finalRows, (row) => row.record_id).filter(([, count]) => count > 1);
  if (duplicateIds.length) throw new Error(`Duplicate record_id: ${duplicateIds.map(([id]) => id).join(',')}`);

  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("Evidence");
  const matrix = [finalHeaders, ...finalRows.map((row) => finalHeaders.map((header) => row[header]))];
  sheet.getRangeByIndexes(0, 0, matrix.length, finalHeaders.length).values = matrix;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(4);
  sheet.showGridLines = false;
  sheet.getRangeByIndexes(0, 0, 1, finalHeaders.length).format = {
    fill: "#17324D",
    font: { bold: true, color: "#FFFFFF", name: "Microsoft YaHei", size: 10 },
    wrapText: true,
    rowHeight: 34,
  };
  sheet.getRangeByIndexes(1, 0, Math.max(1, finalRows.length), finalHeaders.length).format.font = { name: "Microsoft YaHei", size: 10 };
  sheet.getRangeByIndexes(1, 9, Math.max(1, finalRows.length), 5).format.numberFormat = "0";
  for (const col of [0, 1, 2, 3, 6, 9, 10, 11, 12, 13, 14, 19, 20, 23]) {
    sheet.getRangeByIndexes(0, col, matrix.length, 1).format.columnWidth = 16;
  }
  sheet.getRangeByIndexes(0, 6, matrix.length, 1).format.columnWidth = 22;
  sheet.getRangeByIndexes(0, 7, matrix.length, 1).format.columnWidth = 38;
  sheet.getRangeByIndexes(0, 8, matrix.length, 1).format.columnWidth = 20;
  for (const col of [4, 5, 15, 16, 17, 18, 21, 22]) {
    sheet.getRangeByIndexes(0, col, matrix.length, 1).format.columnWidth = 28;
    sheet.getRangeByIndexes(1, col, Math.max(1, finalRows.length), 1).format.wrapText = true;
  }

  const inspection = await workbook.inspect({
    kind: "workbook,sheet,table",
    maxChars: 5000,
    tableMaxRows: 6,
    tableMaxCols: 10,
    tableMaxCellChars: 100,
  });
  process.stdout.write(`${inspection.ndjson}\n`);
  const preview = await workbook.render({
    sheetName: "Evidence",
    range: `A1:J${Math.min(matrix.length, 16)}`,
    scale: 1,
    format: "png",
  });
  await fs.writeFile(path.join(workDir, "evidence-preview.png"), new Uint8Array(await preview.arrayBuffer()));

  const csvContent = `\uFEFF${rowsToCsv(sheet.getUsedRange(true).values)}`;
  await fs.writeFile(outputCsvPath, csvContent, "utf8");
  const finalCsvWorkbook = await Workbook.fromCSV(csvContent, { sheetName: "FinalCSV" });
  const csvRows = matrixToObjects(finalCsvWorkbook.worksheets.getItem("FinalCSV").getUsedRange(true).values);
  const urlSamples = await loadUrlSamples();
  const verificationDuplicateCount = dropped.filter((row) => /duplicate|重复|同一.*岗位/i.test(row.drop_notes || "")).length;
  const stats = qualityStats(csvRows, seedRows.length, dropped.length, duplicateRemoved.length, verificationDuplicateCount);
  await fs.writeFile(outputMdPath, `\uFEFF${generateReport(csvRows, stats, urlSamples, [...dropped, ...duplicateRemoved])}`, "utf8");
  await fs.writeFile(path.join(workDir, "quality-summary.json"), JSON.stringify({ stats, urlSamples }, null, 2), "utf8");
  await fs.writeFile(path.join(workDir, "dropped-records.json"), JSON.stringify([...dropped, ...duplicateRemoved], null, 2), "utf8");
  process.stdout.write(JSON.stringify({ outputCsvPath, outputMdPath, stats, sampleCount: urlSamples.length }, null, 2));
}

await build();
