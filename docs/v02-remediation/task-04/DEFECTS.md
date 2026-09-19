# 任务04 · DEFECTS（缺陷与风险台账）

状态：OPEN / FIXED（本轮修复）/ FIXED-ELSEWHERE（已交 owner）/ BY-DESIGN。判定口径：FAIL/BLOCKED/NOT_RUN 不并入 PASS。

## D-04-1（FIXED）delivery-up 未将 Connectors 常驻处理和 A bridge 纳入完整启动

任务书 §二-1。修复：delivery-up §6.5（Connectors 独立库幂等创建 + 合成配置经 `CONNECTORS_CONFIG` 写 `config.delivery.json` + 常驻驱动拉起 + A bridge 配置 + pidfile/heartbeat/marker + 健康等待）；`--without-connectors` 显式豁免并降级结论。真实栈验证 14/14。

## D-04-2（FIXED）edge-start 未透传 Connectors 配置参数

任务书 §二-2。修复：透传 `--connectors-url/--connectors-token-file/--connectors-tenant`（及 `--messages-file`）。注：server.mjs 虽一直支持参数，但启动脚本不透传=交付启动未接通（"不能据此认定已接通"的判定成立）。

## D-04-3（FIXED）页面处理通道 PROXY_ROUTE_NOT_DECLARED

任务书 §二-3。根因链：启动未传 `--connectors-url` → server.mjs 不创建通道代理 → `/api/jw/v2/(actions/)?connectors/**` 落入 A 面代理 → 白名单拒绝误报 `PROXY_ROUTE_NOT_DECLARED`。修复：透传（根因）+ 未配置时显式 503 `CHANNEL_NOT_CONFIGURED`（兜底误导）。存量测试 1 处旧断言同步更新。

## D-04-4（FIXED-EDGE / OPEN-CONNECTORS=IR-04-2A）Connectors 服务令牌面缺逐资源授权

任务书 §二-5（高优先反例）。Edge 侧（本路）：channel-authz 角色矩阵 + checkCustomer + taskId 归属预检，单元+真实栈反例全过。Connectors 服务端缺口（upload 邀请↔客户对账缺失、preview 不校验 cid、写面信任自报 actor）→ **IR-04-2A 交任务02，OPEN，未代修**。在 Connectors 补齐前，服务令牌直连面仍是服务间信任而非资源授权——联合验收结论按此如实标注。

## D-04-5（FIXED）message-store 内存 Map 重启丢失

任务书 §二-6。修复：node:sqlite 持久库（`--messages-file`），线程 + 幂等回执重启可恢复；单元（文件库重开）+ 装配级（Edge 守护进程重启）双证据。

## D-04-6（FIXED）消息分页漏读

任务书 §二-7（写入1至5、after=0、limit=2 返回 4,5、cursor=5，续读空，1–3 永久丢失）。根因：`list()` 取窗口用 `slice(-limit)`（最新尾页）而 cursor 返回全局最大 seq。修复：增量=最早优先窗口、cursor=本页最后一条；回归测试复现原例并断言新语义。

## D-04-7（FIXED）评估/融资申请对象来自事件引用窗口

任务书 §二-8。任务03 已交付权威清单（CONTRACT §12）；本轮 Edge workspace 切换消费（`authoritative_list`，实测生效），事件窗口降级为回退并如实标注；读面路由开放。

## D-04-8（OPEN，BLOCKED 任务01/02）页面旅程联合验收未执行

见 TEST_RESULTS §4。**NOT_RUN，不得并入 PASS**；统一上传编排（IR-04-2C）冻结前，页面双提交路径并存本身即风险形态。

## D-04-9（FIXED）delivery-up 覆盖私有 edge-auth.json（本轮自查发现）

历史行为：delivery-up 无条件把 authEntries 写入 `config/edge-auth.json`。本轮验收运行时实际覆盖了该私有配置。整改：改写至 `RUN_DIR/edge-auth.json`（运行态、随实例隔离）；被覆盖文件已按其来源（delivery-runtime.json authEntries）原样恢复，恢复脚本未将内容读入任何上下文。

## D-04-10（BY-DESIGN，登记）驱动健康与桥接业务不可由 Edge 外部直接观测

处理驱动 lastTick、A bridge 业务链路"跑通"无法从 Edge 探针判定——readiness 仅报告 进程/DB/通道鉴权前置；"配置存在≠桥接业务已跑通"以页面处理推进与 IR-04-2B（请求 /healthz 暴露驱动状态）收口。

## D-04-11（OPEN，低）消息投递 crash 窗口=至少一次

deliver 成功与回执落库之间崩溃 → 重试重投（线程留档由 append 幂等性兜底不重复入栈，但 deliver sink 可能重复）。真实通道幂等由任务02 侧 requestId 纪律承担；登记为已知边界，不冒充 exactly-once。

## D-04-12（FIXED，旅程发现）live 投递 seam 计数器 messageId 与持久库 UNIQUE 冲突

页面旅程步骤8发现：客户消息发送 500 INTERNAL（`UNIQUE constraint failed: messages.message_id`）。根因：`server.mjs` live deliver seam 按进程内计数器生成 `fixture-N`——消息持久化后 Edge 重启计数归零，与已存记录冲突（内存时代无害，持久化后暴露——**消息恢复能力与该缺陷互为揭示**）。修复：seam 改用 `local-<uuid>` 全局唯一 ID；页面重试后发送成功。证据：`evidence/final-journey/JOURNEY_RECORD.md` 步骤8 + edge-daemon.log。

## D-04-13（BLOCKED-AS-DESIGNED）决策链在合成交付形态下 fail-closed 阻断

旅程步骤11：冻结依据包 → A 409 `POLICY_PENDING`（必需域政策未配置；合成验收交付不配置政策位——政策内容属公司制度，须获准后录入）；且 Gate 回执/分析运行登记依赖 A 客户链接（通道回执 `no_customer_link`，任务02 IR-04-2C/映射机制）。页面"决策未就绪"如实显示、正式提案被 `BASIS_PACKAGE_REQUIRED` 结构阻断——**fail-closed 链按设计工作（本轮验证目标达成）**；链路闭合 = 任务02 交付 + 获准政策配置后重跑旅程步骤10/11。
