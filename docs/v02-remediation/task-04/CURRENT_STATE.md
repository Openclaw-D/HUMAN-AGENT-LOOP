# 任务04 · CURRENT_STATE（Edge、运行装配与联合验收）

更新：2026-09-19。基线：`main@8dcef63`（与任务启动时 HEAD 一致）。writer 范围：`Back/Edge/**`、`Back/D/**`、`docs/v02-remediation/task-04/**`；跨路缺陷/需求经 `docs/v02-remediation/task-02/INTERFACE_REQUESTS.md`（IR-04-2A..D）交付 owner，未代修。

## 本轮已交付（全部落在自有范围）

1. **完整装配闭环（问题1/2/3 修复）**：
   - `delivery-up.mjs`：完整启动 = PG（已登记容器只 start）→ A 迁移/矩阵播种 → A 内核 → **Connectors（常驻处理驱动 + 对象存储 + A bridge）** → Edge（live + 通道透传 + 同源前端）。Connectors 合成配置写 `Connectors/.run/config.delivery.json`（`CONNECTORS_CONFIG` 指向，**不覆盖既有 `.run/config.json`**）；`--config` 支持独立验收配置；`--without-connectors` 显式豁免（全链结论降级 NOT_RUN）。
   - `edge-start.mjs` 透传 `--connectors-url/--connectors-token-file/--connectors-tenant/--messages-file`。此前未透传导致页面处理通道全部落入 A 面代理误报 `PROXY_ROUTE_NOT_DECLARED`（问题3 根因链）——未配置时现显式 503 `CHANNEL_NOT_CONFIGURED`。
   - **真实合成验收栈已跑通**：`delivery-up --config config/delivery-runtime.acceptance.json`（全部合成值）→ 就绪=是；装配级 API 冒烟 14/14（见 EVIDENCE_INDEX E-04）。
2. **逐资源授权（问题5 反例建立 + Edge 侧收敛）**：新模块 `src/channel-authz.mjs`——Connectors 上游只认服务令牌、不重验页面身份；Edge 换权点转发前裁决：customer-only 会话仅可 上传/问答/接受邀请；内部动作（邀请签发/人工转录/更正/获准复核/暂停）403 `ROLE_FORBIDDEN`；带目标客户的读写先经 A `checkCustomer`（缺失 400 失败关闭）；仅持 taskId → 服务端归属预检后不可读统一 404。单元反例 6 组（`test/t4-channel-authz.test.mjs`）+ 真实栈反例 3 项（冒烟内）全过。Connectors 服务端缺口以 **IR-04-2A（高优先）** 交任务02，未代修。
3. **消息与恢复（问题6/7 修复）**：`src/message-store.mjs` 重写——node:sqlite（Node 22 内建，零新依赖，WAL）持久化线程 + 发送 requestId 幂等回执（重启后重放仍 `replayed:true`）；分页语义修复：增量 `after=N` 返回 seq>N 的**最早**一页、cursor=本页最后一条（空页=N 本身），彻底关闭"after=0、limit=2 返回 4,5、cursor=5 后 1..3 永久丢失"；保留窗口裁剪显式 `truncated:true+retentionBase`（不静默漏消息）。语义定义见源文件头与 `TEST_RESULTS.md` §2。
4. **健康检查分项 + 资源台账**：readiness = kernel-a / db / connectors / connectors-channel 独立报告（未配置通道=advisory，如实显示不参与聚合）；能力位新增 `channel`。`delivery-up` 写 `.run/delivery/resources.json`（实例/端口/PID/marker/日志/归属；B 不常驻判定记录）；`delivery-down` 停止顺序 Edge→Connectors→A，Connectors 多证复核，数据卷/对象存储/消息库原样保留。
5. **权威清单消费（问题8 闭合，消费任务03 已交付接口）**：workspace 的 assessments/financing-requests 改由 `GET /api/v2/customers/:id/{assessments,financing-requests}` 权威清单投影（`refsSource='authoritative_list'`，实测已生效）；事件窗口引用仅作上游未升级回退并如实标注；读面路由开放（limit/cursor 透传）。
6. **配置与凭据纪律**：新增合成验收配置 `config/delivery-runtime.acceptance.json`（明确标注，全部合成值）；示例配置补 `connectors` 段（含 `tok-svc1=svc1:service:service:all:t1`）；**整改**：delivery-up 身份目录改写至 `RUN_DIR/edge-auth.json`，不再覆盖私有 `config/edge-auth.json`（本轮曾误覆盖，已按其来源 delivery-runtime.json authEntries 原样恢复，内容未读取入上下文）。
7. **未读取任何私密配置/真实凭据**；未 commit/push/部署；未动 Front/A/B/C/Connectors 代码与根文档/CONTRACT。

## 测试现状

- Edge 全量套件 **67/67 PASS**（含本轮新增 20 断言：消息语义/持久化 7、授权反例 6、装配 E0 1、存量回归 53 更新 1 处旧语义断言 404→503）。
- 装配级 API 冒烟 **14/14 PASS**（合成验收栈，**接线证据，非页面验收**）。
- **页面旅程联合验收已执行（冻结快照下）**：12 步 = 8 PASS / 1 PARTIAL / 2 NOT_RUN / 1 BLOCKED(设计内 fail-closed)；次级场景：服务重启与重复提交 PASS、第二客户隔离（API 级）PASS、撤权/不利材料 NOT_RUN。**旅程发现并修复缺陷 D-04-12**（seam 计数器 messageId 与持久库冲突 → 客户消息 500）。详见 `evidence/final-journey/JOURNEY_RECORD.md` 与 TEST_RESULTS §4。任务02（IR-04-2A/2C）与获准政策配置仍为决策链闭合前置。
- 页面旅程为**执行者自验**（本路参与 Edge 实现）；最终由 Codex 复核，真人体验由用户验收。

## 运行资源（验收栈，全部合成/隔离）

见 `.run/delivery/resources.json`（副本 `evidence/delivery-resources.json`）：`jw-v01-pg`@15442（既有容器）、A@48190、Connectors@48110（库 `cnext`、对象存储 `Connectors/.run/objects-delivery`）、Edge@48210（消息库 `.run/delivery/edge-messages.db`）。另：端口 48200 有一个**先前会话遗留的 Edge 实例**（命令行含 JW marker，非本轮拉起），按边界未触碰。重启验证：delivery-down→up 全循环后任务/消息/对象数据保留（E-05）。
