# P0 市场证据核验契约

## 固定边界

- 只用公开网页、普通 Web 搜索和企业官方招聘页；不登录、不用 Chrome / Computer Use、不绕过反爬。
- 不把招聘数量、薪资或岗位文本写成企业预算或确定战略。
- 不补写无法核验的原标题、岗位 ID、城市、URL、薪资或生产指标。
- 官方岗位无公开薪资时保持为空；不得拼接 BOSS 相似岗位薪资。
- `strategy_topic` 只作为战略/产品/人才计划信号，不冒充岗位。

## 最终字段与枚举

- 字段：`record_id,record_type,source_type,company,business_line,title_or_signal,city,job_id,salary_text,monthly_min_k,monthly_max_k,salary_months,annual_min_k,annual_max_k,layer,industry,scenario,technical_route,production_metrics,ai_relevance,evidence_grade,evidence_status,url,captured_at`
- `record_type`：`job` / `strategy_topic`
- `source_type`：`BOSS_direct_detail` / `BOSS_search_index` / `BOSS_snippet_only` / `official_careers_direct` / `official_careers_index` / `official_program` / `official_product_signal`
- `ai_relevance`：`core_ai_investment` / `ai_adjacent_transformation` / `keyword_noise`
- `evidence_grade`：
  - `A`：本轮可打开并读取的官方岗位详情或官方项目/产品原页；字段与正文直接对应。
  - `B`：本轮可打开的 BOSS 详情，或可识别岗位标题/ID/业务域的官方索引页；岗位存续仍可能变化。
  - `C`：搜索索引/官方聚合页/官方 JS 空页或存在存续冲突，只能支持有限字段。
  - `D`：仅旧摘要或无法重现的线索；不进入最终有效证据库，计入剔除漏斗。
- `evidence_status`：用中文短句记录本轮证据形态与边界，如 `官方详情本轮可读；薪资未公开`、`BOSS 搜索索引；岗位存续需复核`、`官方索引与页面无在招提示冲突`。

## 复核输出格式

每条候选输出一行 TSV：

`seed_record_id\tkeep_or_drop\tcompany\ttitle\tcity\tjob_id\turl\tsource_type\tevidence_grade\tevidence_status\tai_relevance\tproduction_metrics\tnotes`

- `keep_or_drop` 只能为 `keep` 或 `drop`。
- `production_metrics` 只填职责正文明确写出的现网、效率、成本、成功率、稳定性、用户/订单/转化等可观测结果；普通“优化效果、负责落地、提升体验”属于研发预期，留空并写入 `notes`。
- 相同 URL 若对应多个岗位而页面只是一张城市/搜索索引，应保留但在 `notes` 明确 `shared_index_url`；直接详情 URL 原则上不得重复。
