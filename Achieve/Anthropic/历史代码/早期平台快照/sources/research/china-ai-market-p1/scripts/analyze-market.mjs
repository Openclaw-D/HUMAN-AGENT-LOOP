import fs from "node:fs/promises";
import path from "node:path";

const JOB_TITLE_RE = /招聘|职位|岗位|工程师|产品经理|算法|研发|研究员|专家|架构师|实习|校招|社招|career|recruit|job|hiring/iu;
const CORE_SOURCES = new Set(["official", "boss", "zhaopin", "linkedin"]);
const GENERIC_COMPANY_QUERIES = /样本|大厂|企业|行业应用|平台|汽车|终端|公司/iu;

const PRIMARY_RULES = [
  ["healthcare", /医疗|医药|临床|诊疗|healthcare|medical|clinical/iu],
  ["customer_service", /客服|客户服务|呼叫中心|智能问答|customer service|contact center/iu],
  ["supply_chain_logistics", /供应链|物流|仓储|采购|配送|履约|运输|supply chain|logistics/iu],
  ["embodied_robotics_auto", /具身|机器人|自动驾驶|智驾|车控|座舱|robotics?|autonomous driving/iu],
  ["commerce_growth", /电商|零售|商品|商家|推荐|GMV|转化|commerce|retail/iu],
  ["marketing_sales", /营销|销售|投放|广告创意|商机|sales|marketing/iu],
  ["enterprise_productivity", /办公|企业服务|SaaS|ERP|CRM|协同|知识库|文档|employee|workplace|copilot/iu],
  ["multimodal_content", /视频生成|图像生成|语音|数字人|AIGC|多模态|video generation|image generation|speech/iu],
  ["education", /教育|教学|题库|在线学习|education|e-learning/iu],
  ["finance_investment", /金融|支付|投研|交易|信贷|保险|fintech|finance/iu],
  ["gaming", /游戏|game/iu],
  ["device_os", /端侧|终端|操作系统|\bOS\b|\bIoT\b|芯片|手机|\bPC\b|\bdevice\b/iu],
  ["data_analytics", /数据分析|\bBI\b|数据智能|Text-to-SQL|数据平台|analytics/iu],
  ["foundation_model_infra", /基础模型|基座模型|预训练|后训练|推理|AI Infra|算力|训练平台|模型平台|inference/iu],
];

function countBy(rows, getter) {
  const counts = {};
  for (const row of rows) {
    const key = getter(row) || "(blank)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function primaryTheme(row) {
  const title = row.title ?? "";
  for (const [label, regex] of PRIMARY_RULES) if (regex.test(title)) return label;
  const snippet = row.snippet ?? "";
  for (const [label, regex] of PRIMARY_RULES) if (regex.test(snippet)) return label;
  return row.keyword_group === "infra" || row.keyword_group === "llm" ? "foundation_model_infra" : "other_ai";
}

function analysisEligible(row) {
  if (row.evidence_grade === "D" || !row.top3_exclusion?.includes("none")) return false;
  if (CORE_SOURCES.has(row.source_platform)) return true;
  return JOB_TITLE_RE.test(row.title ?? "");
}

function representativeSort(a, b) {
  const grade = { A: 3, B: 2, C: 1, D: 0 };
  const page = { job_detail: 3, job_index: 2, search_result: 1, non_job: 0 };
  const salary = (row) => row.high_salary_signal === "confirmed_floor" ? 2 : row.high_salary_signal === "possible_ceiling" ? 1 : 0;
  return grade[b.evidence_grade] - grade[a.evidence_grade]
    || page[b.job_or_page] - page[a.job_or_page]
    || salary(b) - salary(a)
    || a.result_rank - b.result_rank
    || a.candidate_id.localeCompare(b.candidate_id);
}

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error("Usage: node analyze-market.mjs <normalized.jsonl> <analysis.json>");
const rows = (await fs.readFile(path.resolve(input), "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
const pool = rows.filter(analysisEligible).map((row) => ({ ...row, primary_theme: primaryTheme(row) }));
const themes = [];
for (const theme of [...new Set(pool.map((row) => row.primary_theme))].sort()) {
  const matches = pool.filter((row) => row.primary_theme === theme);
  const namedCompanies = [...new Set(matches.map((row) => row.company_query).filter((value) => value && !GENERIC_COMPANY_QUERIES.test(value)))];
  const salaryRows = matches.filter((row) => ["confirmed_floor", "possible_ceiling"].includes(row.high_salary_signal));
  const frontierRows = matches.filter((row) => /Agent|智能体|LLM|大模型|多模态|AIGC|RAG|MCP|A2A|AI Infra|具身/iu.test(`${row.title} ${row.snippet}`));
  themes.push({
    theme,
    count: matches.length,
    named_company_count: namedCompanies.length,
    named_companies: namedCompanies.sort((a, b) => a.localeCompare(b, "zh-CN")),
    source_counts: countBy(matches, (row) => row.source_platform),
    grade_counts: countBy(matches, (row) => row.evidence_grade),
    high_salary_count: salaryRows.length,
    confirmed_salary_floor_count: salaryRows.filter((row) => row.high_salary_signal === "confirmed_floor").length,
    freshness_signal_count: matches.filter((row) => row.freshness_text).length,
    frontier_count: frontierRows.length,
    frontier_share: Number((frontierRows.length / matches.length).toFixed(4)),
    representatives: [...matches].sort(representativeSort).slice(0, 8).map((row) => ({
      candidate_id: row.candidate_id,
      company_query: row.company_query,
      title: row.title,
      url: row.canonical_url,
      source_platform: row.source_platform,
      evidence_grade: row.evidence_grade,
      high_salary_signal: row.high_salary_signal,
      salary_text: row.salary_text,
    })),
  });
}
themes.sort((a, b) => b.count - a.count || b.named_company_count - a.named_company_count || a.theme.localeCompare(b.theme));
const result = {
  generated_at: new Date().toISOString(),
  normalized_unique_count: rows.length,
  analysis_pool_count: pool.length,
  excluded_top3_count: rows.filter((row) => row.evidence_grade !== "D" && !row.top3_exclusion?.includes("none")).length,
  analysis_source_counts: countBy(pool, (row) => row.source_platform),
  analysis_grade_counts: countBy(pool, (row) => row.evidence_grade),
  analysis_high_salary_counts: countBy(pool, (row) => row.high_salary_signal),
  themes,
};
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ analysis_pool_count: result.analysis_pool_count, themes: themes.map(({ theme, count, named_company_count, high_salary_count, frontier_share }) => ({ theme, count, named_company_count, high_salary_count, frontier_share })) }, null, 2)}\n`);
