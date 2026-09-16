import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, normalizeRow, normalizeRows, qualitySummary } from "../scripts/normalize-search-results.mjs";

const base = {
  query_id: "Q1",
  query: "site:zhipin.com AI Agent 40-80K 15薪",
  result_rank: 1,
  title: "AI Agent 产品经理招聘",
  url: "https://www.zhipin.com/job_detail/abc.html?utm_source=test",
  snippet: "某大厂 AI Agent 产品经理 40-80K·15薪，北京",
  captured_at: "2026-08-27",
  source_platform: "boss",
  company_query: "高薪样本",
  keyword_group: "product",
};

test("canonical URL removes tracking and fragment", () => {
  assert.equal(canonicalizeUrl("https://EXAMPLE.com/a/?utm_source=x&b=2#top"), "https://example.com/a?b=2");
});

test("salary is annualized only with explicit months", () => {
  const row = normalizeRow(base);
  assert.equal(row.salary_text, "40-80K·15薪");
  assert.equal(row.annual_min_k, 600);
  assert.equal(row.annual_max_k, 1200);
  assert.equal(row.high_salary_signal, "confirmed_floor");

  const monthly = normalizeRow({ ...base, snippet: "AI Agent 产品经理 40-80K，北京" });
  assert.equal(monthly.annual_min_k, null);
  assert.equal(monthly.high_salary_signal, "monthly_only");
});

test("platform search result stays snippet-only grade C", () => {
  const row = normalizeRow(base);
  assert.equal(row.source_platform, "boss");
  assert.equal(row.access_class, "search_snippet_only");
  assert.equal(row.evidence_grade, "C");
});

test("official detail is grade B because collection came from search", () => {
  const row = normalizeRow({
    ...base,
    title: "大模型应用算法工程师",
    url: "https://zhaopin.jd.com/web/job-info-detail?requementId=123",
    source_platform: "official",
    company_query: "京东",
  });
  assert.equal(row.job_or_page, "job_detail");
  assert.equal(row.evidence_grade, "B");
  assert.equal(row.access_class, "public_search_detail");
});

test("a third-party result from an official-intent query is not mislabeled official", () => {
  const row = normalizeRow({ ...base, source_platform: "official", company_query: "某大厂", url: "https://example.com/jobs/ai-agent", title: "AI Agent 工程师招聘" });
  assert.equal(row.source_platform, "other");
  assert.equal(row.evidence_grade, "C");
});

test("top-three exclusions and market themes are deterministic", () => {
  const row = normalizeRow({ ...base, snippet: "多智能体协作 A2A，多模态客服与供应链物流 Agent 岗位" });
  assert.deepEqual(row.top3_exclusion, ["general_multi_agent_harness"]);
  assert.ok(row.theme_labels.includes("customer_service"));
  assert.ok(row.theme_labels.includes("supply_chain_logistics"));
  assert.ok(row.theme_labels.includes("multimodal_content"));
});

test("exact canonical URL duplicates collapse", () => {
  const { kept, duplicates } = normalizeRows([base, { ...base, query_id: "Q2", url: `${base.url}#other` }]);
  assert.equal(kept.length, 1);
  assert.equal(duplicates.length, 1);
  assert.match(duplicates[0].drop_reason, /^duplicate_of:/u);
});

test("obvious non-job page is grade D", () => {
  const row = normalizeRow({ ...base, title: "人工智能百科首页", url: "https://example.com/ai", snippet: "人工智能百科" });
  assert.equal(row.evidence_grade, "D");
  assert.equal(row.drop_reason, "non_job_or_strategy_page");
});

test("AI in the query alone does not make an unrelated result eligible", () => {
  const row = normalizeRow({ ...base, title: "Senior Supply Chain Analyst", url: "https://cn.linkedin.com/jobs/view/123", snippet: "Medical device company hiring a supply chain analyst" });
  assert.equal(row.evidence_grade, "D");
  assert.equal(row.drop_reason, "not_ai_related");
});

test("quality summary reconciles totals", () => {
  const input = [base, { ...base, query_id: "Q2", url: `${base.url}#duplicate` }, { ...base, title: "AI 新闻首页", url: "https://example.com/news", snippet: "AI 新闻" }];
  const { kept, duplicates } = normalizeRows(input);
  const summary = qualitySummary(input, kept, duplicates);
  assert.equal(summary.raw_count, 3);
  assert.equal(summary.unique_count, 2);
  assert.equal(summary.duplicate_count, 1);
  assert.equal(summary.eligible_count + summary.dropped_count, summary.unique_count);
});
