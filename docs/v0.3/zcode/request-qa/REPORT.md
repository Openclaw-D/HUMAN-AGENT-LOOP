# V0.3-Z2-REQUEST-QA 执行报告

- 任务书：`docs/v0.3/zcode/02_REQUEST_QA.md`（任务名 V0.3-Z2-REQUEST-QA）
- 执行：ZCode，2026-09-20；目标：独立测试需求登记前端行为与权限边界，交付候选回归用例；不碰模型观察。
- ownership 遵守：仅写入 `docs/v0.3/zcode/request-qa/` 与 `.local/v03-zcode-request/`；未改 Front/Back 源码、既有测试、package 文件、dist、公共文档；未 commit/push/worktree；未安装依赖；仅绑定 127.0.0.1 随机端口替身，未请求现有服务或真实模型。

## 交付物

| 交付物 | 位置 |
|---|---|
| 候选测试（正本，9 用例） | `docs/v0.3/zcode/request-qa/test/request-boundary.behavior.test.mjs` |
| 候选测试（.local 运行副本，已修正相对路径，可独立运行） | `.local/v03-zcode-request/request-boundary.behavior.test.mjs` |
| 本报告 | `docs/v0.3/zcode/request-qa/REPORT.md` |
| 原始运行日志 ×5 | `docs/v0.3/zcode/request-qa/evidence/run-06.txt`、`run-07.txt`、`run-08.txt`（漂移前）、`run-09-after-drift.txt`（漂移后）、`existing-run-after-drift.txt`（既有测试对照） |
| hash 记录 | `evidence/hashes-before`（见下表）、`evidence/hashes-after.txt`、`evidence/hashes-final.txt` |
| RTL waitFor 风暴对照实验 | `.local/v03-zcode-request/debug4.test.mjs`、`trace4.log`、`debug4-out.txt`、`debug3-out.txt`（风暴复现日志） |

运行命令（JW 根目录）：`node --experimental-strip-types --test docs/v0.3/zcode/request-qa/test/request-boundary.behavior.test.mjs`。结果：漂移前 3 次、漂移后 1 次、副本 1 次全部 **9/9 绿，退出码 0**（耗时约 2.4s）。

## 边界覆盖对照（任务书要求 → 用例）

| 任务书要求边界 | 用例 | 结果 |
|---|---|---|
| 金额精度和安全整数 | ①90071992547409.91 元（=2^53-1 分）发送；②+0.01 拒绝；③999999999999999.99 拒绝；④0.00 拒绝；⑤前导零 00012.5=1250 分放行；⑥0.01=1 分最小值放行 | 全部实测通过 |
| null 字段 | 全空提交 payload 断言 `deepEqual`：金额/期限/用途/说明 null、equipmentScope []、currency 继承既有评估（USD） | 实测通过 |
| 重复点击 | 保存悬挂期间 busy 文案+按钮 disabled+fieldset disabled，继续点击不追加请求，最终仅 1 次保存 | 实测通过 |
| 409 保留草稿并显式读新版本 | 409（服务端已被他人推进）→ 草稿保留+按钮禁用 → 显式读取替换为服务端内容 → 以新版本 2 再保存成功 | 实测通过（补足既有用例未覆盖的闭环后半段） |
| 403/401 | 403 已有既有覆盖；本轮补 401：消息"会话已失效…（SESSION_REQUIRED）"、不冒充成功、不留未知结果锁、恢复后重试成功 | 实测通过 |
| 保存后读回失败不报成功 | 保存 200+读回 503：无成功文案、显示"已取得提交回执，待读回"、锁保留按钮禁用；读回恢复后匹配解除 | 实测通过 |
| 客户或会话变化防串入 | 客户切换：等待中的旧保存响应不写入新客户表单、新客户登记未被触碰；读回归属不匹配（他人客户评估）拒绝装载；会话切换重挂载并以新会话头重新读回+提交 | 实测通过（3 用例） |
| 断言请求 payload 与 UI | 每条用例同时断言请求 body（含 requestId 形状、assessmentVersion、tenantId、会话头、无 authorization 头）与屏幕文案/控件状态 | 满足 |

未机械重复既有测试已覆盖项：基础保存回填、'0'/'-1'/'1.001'/'9e9' 金额、期限 241、403 文案、502 未知结果锁、只读角色、无评估、读面 503 初始失败、模型观察全部用例。

## 发现

**实际复现（有日志证据）：**

1. **RTL waitFor 触发同步内存风暴（测试基建问题，非产品缺陷）**：`idle` 原用 RTL `waitFor` 实现，在该场景下约 3 秒耗尽 256MB 堆 OOM（`evidence/run-05.txt`、`.local/v03-zcode-request/debug3-out.txt`），且待发 fetch 停留在 undici 队列从未到达替身（打点 trace）。同一用例改用 sleep 轮询后稳定通过（对照实验 `debug4`）。既有测试的 waitFor 用例不受影响（20/20 绿）。候选测试已改用 sleep 轮询；CTRL 集成时请保留该写法。
2. **安全整数边界行为确认**：`admissionAmount` 对 MAX_SAFE_INTEGER 分（90071992547409.91 元）恰好放行、+0.01 即拒绝——边界行为与注释一致，非缺陷。
3. **401 与 502 的锁语义对照确认**：401（SESSION_REQUIRED）属明确失败，不留"结果未知"锁，可重试；502 保留未知锁（既有覆盖）。

**审读推测（未复现/超出本轮只读范围，供 CTRL 裁决）：**

1. 401 后保存按钮未禁用（`takeoffError` 的 blocked 列表不含 SESSION_REQUIRED），用户可连续重试、每次都打到服务器；是否应引导重新登录由 01 契约/CTRL 裁决。
2. purpose/note 的 maxLength=200/500 依赖浏览器原生截断，jsdom `fireEvent.change` 不模拟该行为，页面端超长输入防线未测（服务端校验为另一层）。
3. `admission-request-panel.tsx` 的 `unresolved` WeakMap 以 WbClient 实例为 key，注释称"仅在当前会话客户端内存中保存，不泄漏到另一个身份"；若同一 client 实例跨会话复用（重登录不换实例），pending 锁将跨会话保留。是否可达取决于 use-workbench 的 client 生命周期（不在本轮只读清单，未验证）。

## 漂移记录（任务书要求：变化时报告，不修改预期凑通过）

测试期间以下 3 个只读输入被 CTRL/其他执行者修改（其余 5 文件无漂移）；漂移均集中在模型观察面，需求登记相关函数（admissionAmount/admissionEqual/takeoffError）与类型未变，测试预期无需改动：

| 文件 | 测试前 sha256（前 8 位） | 测试后 | 变化性质 |
|---|---|---|---|
| Front/site-mirror/lib/workbench/takeoff-actions.ts | b214d2f2 | 9e105de9 | AssistantObservation.model 增可选字段 receiptVersion/contextHash/configHash/current；observationAnchor 的 scope 处理变化 |
| Front/preview/test/behavior/takeoff-actions.behavior.test.mjs | e1d605fe | 0a1b9415 | 模型观察用例同步上述回执面 + 新增 current 用例 |
| Front/package.json | 21b4f30f | 8c922429 | test script 追加 takeoff-actions.behavior.test.mjs（CTRL 集成动作） |

漂移后重验：候选测试 9/9 绿（run-09-after-drift.txt）、既有测试 20/20 绿（existing-run-after-drift.txt）。完整 hash 见 `evidence/hashes-after.txt`、`evidence/hashes-final.txt`（两者一致）。

## 遗留

- 候选测试未进入 `Front/package.json` test script（集成与否由 CTRL 决定；CTRL 已自行集成既有测试）。
- 审读推测 1–3 待 CTRL/01 契约裁决。

---

## CTRL 摘要

```
V0.3-Z2-REQUEST-QA 完成：9 条候选用例全部独立运行通过（漂移前后均 9/9 绿，退出码 0，证据 run-06~09）。
覆盖任务书全部指定边界：金额安全整数（2^53-1 分恰过/+0.01 拒）、null payload/currency 继承、重复点击单发、
409 草稿保留→显式读新版本→新版本再保存闭环、401 不留未知锁、保存成功读回失败不报成功并锁待对账、
客户/会话切换防串入（含读回归属不匹配拒绝）。全部同时断言 payload 与 UI。
漂移报告：takeoff-actions.ts、takeoff-actions.behavior.test.mjs、package.json 三文件中途被改（模型观察面集成），
需求登记函数未变；漂移后重验候选 9/9、既有 20/20 全绿，hash 前后已存档。
测试基建发现（非产品缺陷）：RTL waitFor 在保存空闲等待场景触发 3 秒 OOM 内存风暴并卡住 undici 队列，
候选测试已改 sleep 轮询绕过；集成时请保留该写法（对照实验在 .local/v03-zcode-request/debug4）。
审读推测三项待裁决：401 后按钮未禁用可连续重试；maxLength 原生截断未测；WeakMap pending 锁跨会话保留是否可达。
写入范围合规：仅 docs/v0.3/zcode/request-qa/ 与 .local/v03-zcode-request/；未改源码/配置/dist；未 commit/push。
```
