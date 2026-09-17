# goal-02 · INTERFACE_REQUESTS（交目标一统一落地）

Writer：goal-02（B/C/Connectors）。以下为所需 A 侧接口/授权缺口；本轮均以"如实 BLOCKED/降级"
处理，未阻塞 Connectors 侧可独立验证部分。

## IR-1 · Connectors 服务身份与客户级授权（A v2）

- 需求：为 jw-connectors 配置 A v2 `kind:"service"` 合成 principal（或真实服务身份），并在
  `principal_customer_grants` 登记其可见客户。
- 用途：解析完成+四域预审后，把"已登记工件引用"经 `POST /api/v2/customers/:id/analysis-runs/start|
  finish` 与域结果登记进入 A 正式收口面（Gate 回执制要求 kind=service）。
- 现状：本轮 `aRegister` 只走 A v1 `POST /projects/:id/evidence`（connector_evidence）；四域预审
  结果留存 Connectors 侧 `domain_analyses`/`analysis_finalizations`，明确标注"预审候选，非正式授信"。
- 验收影响：`analysis-runs` 对接路径保持 BLOCKED；不影响本轮 13 项服务级验收。

## IR-2 · 客户→A 项目映射的权威来源

- 需求：A 侧（或目标一）给出 customerId→projectId 的权威映射接口/表；当前
  `processing.aProjectByCustomer` 为显式配置映射（演示用），未配置=跳过 A 登记并在阶段回执注明。
- 风险：无映射时预审链完整、但不进入 A 正式收口（如实回执 `register_a skipped: no_project_mapping`）。

## IR-3 · A 登记对账通道确认（v1 既有，需确认可用性）

- 已用：`GET /api/v1/receipts/:requestId`（v1 契约既有）作为超时 unknown 的对账依据；
  Connectors 侧确定性 requestId=`ptx-<taskId>`。
- 请求：确认 v1 读口在目标一权限收紧后（CONTRACT §9 匿名读口关闭）允许携凭据查询回执；
  若回执不可读，Connectors 的 blocked_unknown 任务将只能人工对账（仍不换 ID 重发）。

## IR-4 ·（非阻塞提示）进度/问题面板消费面

- Connectors 已暴露 `GET /processing/status`、`GET /questions/pending`（服务令牌面）。
  若目标三（Edge/Front）要展示"传输/解压/解析/分析/核验分开"的进度与建议问题，直接消费上述
  端点；不需要 A 侧改动。

## 本轮未动但相关的既有接口点（如实登记，非请求）

- `aRegister.registerEvidence` 内容只含受控元数据（无媒体字节、无金额字段，遵守 A 契约 §3.1 禁键）。
- 检查会话域（A inspection sessions）未被本轮触碰；Connectors 侧问题准备与 B
  `schedule/inspection-dispatcher` 的会话快照路径并存，后续如需合并由目标一裁决单一事实源。
