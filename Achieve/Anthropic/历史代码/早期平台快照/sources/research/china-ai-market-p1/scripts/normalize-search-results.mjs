import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const AI_RE = /(?:\bAI\b|人工智能|大模型|LLM|Agent|智能体|多模态|AIGC|RAG|MCP|A2A|具身|机器学习|深度学习|生成式|算法)/iu;
const JOB_RE = /(?:招聘|职位|岗位|工程师|产品经理|算法|研发|研究员|专家|架构师|实习|校招|社招|career|recruit|job|hiring)/iu;
const NON_JOB_RE = /(?:百科|维基|研报|白皮书|新闻|发布会|课程|培训|股价|财报|融资|首页|官网首页)/iu;

const PLATFORM_HOSTS = {
  boss: /(?:^|\.)zhipin\.com$/iu,
  zhaopin: /(?:^|\.)zhaopin\.com$/iu,
  linkedin: /(?:^|\.)linkedin\.com$/iu,
};

const OFFICIAL_HOST_RE = /(?:joinbytedance\.com|careers\.tencent\.com|talent-holding\.alibaba\.com|zhaopin\.jd\.com|zhaopin\.meituan\.com|talent\.baidu\.com|career\.huawei\.com|hr\.xiaomi\.com|careers\.oppo\.com|career\.vivo\.com|talent\.lenovo\.com\.cn|jobs\.lenovo\.com|talent\.didiglobal\.com|careers\.nio\.com|career\.xiaopeng\.com|join\.lixiang\.com|deepseek\.com|zhipuai\.cn|minimaxi\.com|stepfun\.com|baichuan-ai\.com|sensetime\.com|iflytek\.com|4paradigm\.com|kingdee\.com|yonyou\.com|wps\.cn|talent\.hikvision\.com|sf-express\.com|cainiao\.com)$/iu;

const THEME_RULES = [
  ["customer_service", /客服|客户服务|呼叫中心|智能问答|customer service|contact center/iu],
  ["enterprise_productivity", /办公|企业服务|SaaS|ERP|CRM|协同|知识库|文档|employee|workplace|copilot/iu],
  ["commerce_growth", /电商|零售|商品|商家|推荐|广告|增长|GMV|转化|commerce|retail/iu],
  ["marketing_sales", /营销|销售|投放|广告创意|商机|sales|marketing/iu],
  ["supply_chain_logistics", /供应链|物流|仓储|采购|配送|履约|运输|supply chain|logistics/iu],
  ["healthcare", /医疗|医药|临床|诊疗|healthcare|medical|clinical/iu],
  ["education", /教育|教学|题库|在线学习|education|e-learning/iu],
  ["embodied_robotics_auto", /具身|机器人|自动驾驶|智驾|车控|座舱|robot|autonomous|driving/iu],
  ["multimodal_content", /多模态|视频生成|图像生成|语音|数字人|AIGC|video|image generation|speech/iu],
  ["device_os", /端侧|终端|操作系统|\bOS\b|\bIoT\b|芯片|手机|\bPC\b|\bdevice\b/iu],
  ["finance_investment", /金融|支付|投研|交易|信贷|保险|fintech|finance/iu],
  ["foundation_model_infra", /基础模型|基座模型|预训练|后训练|推理|AI Infra|算力|训练平台|模型平台|inference/iu],
  ["data_analytics", /数据分析|BI|数据智能|Text-to-SQL|数据平台|analytics/iu],
  ["gaming", /游戏|game/iu],
  ["security_governance", /安全|治理|合规|审核|风控|评测|红队|security|safety|governance/iu],
];

function compact(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(compact(value));
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|trk|trackingId|ref|refId|source|from)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return "";
  }
}

function sourcePlatform(row, hostname) {
  if (PLATFORM_HOSTS.boss.test(hostname)) return "boss";
  if (PLATFORM_HOSTS.zhaopin.test(hostname)) return "zhaopin";
  if (PLATFORM_HOSTS.linkedin.test(hostname)) return "linkedin";
  if (compact(row.source_platform) === "official" && OFFICIAL_HOST_RE.test(hostname)) return "official";
  return compact(row.source_platform) === "official" ? "other" : compact(row.source_platform) || "other";
}

function classifyPage(url, title, body, platform) {
  const pathname = url?.pathname ?? "";
  if (NON_JOB_RE.test(title) && !JOB_RE.test(`${title} ${body}`)) return "non_job";
  if (/\/jobs?\/view\//iu.test(pathname) || /job-info-detail|position-detail|social-recruitment-detail/iu.test(pathname) || /\/search\/\d{8,}/u.test(pathname) || /jobId=|requementId=/iu.test(url?.href ?? "")) return "job_detail";
  if (platform !== "official") return "search_result";
  if (/career|recruit|talent|zhaopin|jobs?/iu.test(`${url?.hostname ?? ""}${pathname}`) && JOB_RE.test(`${title} ${body}`)) return "job_index";
  return "non_job";
}

function parseSalary(text) {
  const match = text.match(/(?<!\d)(\d{1,3}(?:\.\d+)?)\s*[-–—~至]\s*(\d{1,3}(?:\.\d+)?)\s*[Kk](?:\s*[·x×]\s*(\d{1,2})\s*薪)?/u);
  if (!match) return { salary_text: "", annual_min_k: null, annual_max_k: null, high_salary_signal: "none" };
  const salaryText = match[0];
  const min = Number(match[1]);
  const max = Number(match[2]);
  const months = match[3] ? Number(match[3]) : null;
  if (!months) return { salary_text: salaryText, annual_min_k: null, annual_max_k: null, high_salary_signal: "monthly_only" };
  const annualMin = min * months;
  const annualMax = max * months;
  const signal = annualMin >= 400 ? "confirmed_floor" : annualMax >= 500 ? "possible_ceiling" : "below_threshold";
  return { salary_text: salaryText, annual_min_k: annualMin, annual_max_k: annualMax, high_salary_signal: signal };
}

function freshness(text) {
  const match = text.match(/(?:发布时间[:：]?\s*|更新于\s*|Published:\s*|Crawled:\s*)(?:\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?|today|yesterday|\d+\s+(?:days?|weeks?|months?)\s+ago)/iu);
  return match ? compact(match[0]) : "";
}

function exclusions(text) {
  const values = [];
  if (/风控|反欺诈|反洗钱|合规|内容审核|内容安全|风险审核|机审|人审/iu.test(text)) values.push("business_risk");
  if (/AI Coding|Coding Agent|代码生成|代码助手|研发效能|软件开发协作|需求.*开发|开发.*测试|DevOps/iu.test(text)) values.push("dev_collaboration");
  if (/Agent[-—– ]Agent[-—– ]Human|Human[-—– ]Agent|多智能体协作|multi-agent collaboration|A2A多智能体|Harness Engineering/iu.test(text)) values.push("general_multi_agent_harness");
  return values.length ? values : ["none"];
}

function themes(text) {
  const values = THEME_RULES.filter(([, regex]) => regex.test(text)).map(([label]) => label);
  return values.length ? values : ["other_ai"];
}

function grade(platform, pageType) {
  if (pageType === "non_job") return "D";
  if (platform === "official" && pageType === "job_detail") return "B";
  if (platform === "official" && pageType === "job_index") return "B";
  return "C";
}

export function normalizeRow(row, index = 0) {
  const title = compact(row.title);
  const snippet = compact(row.snippet);
  const canonicalUrl = canonicalizeUrl(row.url);
  const parsedUrl = canonicalUrl ? new URL(canonicalUrl) : null;
  const domain = parsedUrl?.hostname ?? "";
  const platform = sourcePlatform(row, domain);
  const combined = `${title} ${snippet}`;
  const pageType = classifyPage(parsedUrl, title, snippet, platform);
  const salary = parseSalary(combined);
  let dropReason = "";
  if (!canonicalUrl) dropReason = "invalid_url";
  else if (!AI_RE.test(combined)) dropReason = "not_ai_related";
  else if (pageType === "non_job") dropReason = "non_job_or_strategy_page";
  const evidenceGrade = dropReason ? "D" : grade(platform, pageType);
  const accessClass = evidenceGrade === "D" ? "not_eligible" : pageType === "job_detail" ? "public_search_detail" : platform === "official" ? "public_search_index" : "search_snippet_only";
  const companyQuery = compact(row.company_query);
  const dedupeKey = canonicalUrl ? `url:${canonicalUrl.toLowerCase()}` : `fallback:${companyQuery.toLowerCase()}|${title.toLowerCase()}|${platform}`;
  return {
    ...row,
    query_id: compact(row.query_id),
    query: compact(row.query),
    result_rank: Number(row.result_rank) || 0,
    title,
    url: compact(row.url),
    snippet,
    captured_at: compact(row.captured_at),
    source_platform: platform,
    company_query: companyQuery,
    keyword_group: compact(row.keyword_group) || "other",
    candidate_id: `P1-${String(index + 1).padStart(5, "0")}`,
    canonical_url: canonicalUrl,
    domain,
    job_or_page: pageType,
    access_class: accessClass,
    dedupe_key: dedupeKey,
    ...salary,
    freshness_text: freshness(combined),
    top3_exclusion: exclusions(combined),
    theme_labels: themes(combined),
    evidence_grade: evidenceGrade,
    drop_reason: dropReason,
  };
}

export function normalizeRows(inputRows) {
  const provisional = inputRows.map((row, index) => normalizeRow(row, index));
  const byKey = new Map();
  const duplicates = [];
  for (const row of provisional) {
    if (byKey.has(row.dedupe_key)) {
      duplicates.push({ ...row, evidence_grade: "D", drop_reason: `duplicate_of:${byKey.get(row.dedupe_key).candidate_id}` });
      continue;
    }
    byKey.set(row.dedupe_key, row);
  }
  const kept = [...byKey.values()].map((row, index) => ({ ...row, candidate_id: `P1-${String(index + 1).padStart(5, "0")}` }));
  return { kept, duplicates };
}

function countBy(rows, getter) {
  const counts = {};
  for (const row of rows) {
    const values = getter(row);
    for (const value of Array.isArray(values) ? values : [values]) counts[value || "(blank)"] = (counts[value || "(blank)"] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

export function qualitySummary(rawRows, kept, duplicates) {
  const eligible = kept.filter((row) => row.evidence_grade !== "D");
  const dropped = kept.filter((row) => row.evidence_grade === "D");
  return {
    generated_at: new Date().toISOString(),
    raw_count: rawRows.length,
    unique_count: kept.length,
    duplicate_count: duplicates.length,
    eligible_count: eligible.length,
    dropped_count: dropped.length,
    query_count: new Set(rawRows.map((row) => row.query_id)).size,
    company_query_count: new Set(eligible.map((row) => row.company_query).filter(Boolean)).size,
    domain_count: new Set(eligible.map((row) => row.domain).filter(Boolean)).size,
    source_counts: countBy(eligible, (row) => row.source_platform),
    evidence_counts: countBy(kept, (row) => row.evidence_grade),
    access_counts: countBy(kept, (row) => row.access_class),
    page_counts: countBy(kept, (row) => row.job_or_page),
    high_salary_counts: countBy(eligible, (row) => row.high_salary_signal),
    top3_exclusion_counts: countBy(eligible, (row) => row.top3_exclusion),
    theme_counts: countBy(eligible.filter((row) => row.top3_exclusion.includes("none")), (row) => row.theme_labels),
    drop_reasons: countBy([...dropped, ...duplicates], (row) => row.drop_reason),
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid arguments near ${key ?? "end"}`);
    args[key.slice(2)] = value;
  }
  if (!args.input || !args.output || !args.quality) throw new Error("Usage: --input <file-or-dir> --output <normalized.jsonl> --quality <quality.json>");
  return args;
}

async function inputFiles(inputPath) {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) return [inputPath];
  const names = (await fs.readdir(inputPath)).filter((name) => name.endsWith(".jsonl")).sort();
  return names.map((name) => path.join(inputPath, name));
}

async function loadRows(inputPath) {
  const rows = [];
  for (const file of await inputFiles(inputPath)) {
    const lines = (await fs.readFile(file, "utf8")).replace(/^\uFEFF/u, "").split(/\r?\n/u).filter((line) => line.trim());
    for (let index = 0; index < lines.length; index += 1) {
      try {
        rows.push(JSON.parse(lines[index]));
      } catch (error) {
        throw new Error(`${file}:${index + 1}: invalid JSON: ${error.message}`);
      }
    }
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawRows = await loadRows(path.resolve(args.input));
  const { kept, duplicates } = normalizeRows(rawRows);
  const summary = qualitySummary(rawRows, kept, duplicates);
  await fs.mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await fs.mkdir(path.dirname(path.resolve(args.quality)), { recursive: true });
  await fs.writeFile(path.resolve(args.output), `${kept.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  await fs.writeFile(path.resolve(args.quality), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
