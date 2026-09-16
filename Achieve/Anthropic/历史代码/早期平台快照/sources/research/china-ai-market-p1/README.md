# 中国 AI 岗位市场 P1 重研

本目录保存 2026-08-27 的公开 Web Search 候选池、规范化代码和可复算统计。

边界：只使用公开、无需登录的数据；没有使用浏览器登录态或 `computer use`。`raw/` 是搜索结果候选，不等于已核验在招岗位。Search-only 证据最高为 B，招聘平台摘要为 C。

主要产物：

- `P1-MARKET-CONTRACT.md`：采集、证据、薪资、去重和排名契约；
- `raw/batch-*.jsonl`：120 个检索式的 1,657 条原始结果；
- `work/normalized.jsonl`：1,344 个去重候选及字段化标签；
- `work/quality.json`：数量、来源、证据等级、薪资和剔除统计；
- `work/analysis.json`：剔除前三后的严格分析池和主题统计；
- `scripts/` 与 `test/`：零依赖 Node.js 复算代码。

```powershell
node --test .\test\normalize-search-results.test.mjs
node .\scripts\normalize-search-results.mjs --input .\raw --output .\work\normalized.jsonl --quality .\work\quality.json
node .\scripts\analyze-market.mjs .\work\normalized.jsonl .\work\analysis.json
```

总报告位于项目根目录 [P1-市场重研.md](../../../P1-市场重研.md)。
