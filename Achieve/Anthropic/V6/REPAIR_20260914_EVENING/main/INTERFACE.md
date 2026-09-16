# INTERFACE｜共享状态接口 v1（A 冻结 · 2026-09-14 晚）

本文件是 B（首页）/C（远程尽调）候选与 A 共享后端对接的**冻结接口**。沿用字段优先；B/C 不得自建第二套 API client（沿用 `app/v5-preview/api-client.ts` 与 DD 页既有 fetch 封装）。改动只能由 A 在下一轮以版本号升级发布。

## 1. 稳定标识（跨存储关联）

| 标识 | 值/位置 | 说明 |
| --- | --- | --- |
| projectId | `JW-2026-018` | 两个存储既有冻结值，不变；跨项目引用一律 404 失败关闭 |
| 演示会话 | rows-store v2 新增 `sharedDemo.sessionId`（`rs-*`，指向 remote-store 既有 session） | 当前专属演示会话指针。首次需要时由服务端懒建（幂等：已有指针即复用）；重开清除为 null 并清除该会话及其证据/标注/复核/核算记录；**其他会话与记录一律不动** |
| 当前演示步 | rows-store v2 新增 `storyCursor.stepId` | 稳定步标识定位，**不再依赖展示文案签名**；文案/待办状态变化不脱离固定路线。@1 旧文件读取兼容：cursor 缺失时回退签名定位，首次 story GET/写入自动迁移为 @2 |
| 证据 | remote-store 既有 `EvidenceRecord`（`evidenceId`/`supersedes`/`supersededBy` 取代链） | 不新表不迁移。链内第 N 次采集 = 取代链深度（`chainVersion`，由投影计算返回） |
| 证据↔域映射（冻结表） | `fixture-inspection→asset(资产)`；`fixture-equipment→credit(信审)`；`fixture-contract→commerce(商务)` | 政策域无 fixture 挂点（本轮不造新 fixture）；映射只影响投影显示，不改审批语义 |

## 2. 命令提交规则（唯一命令 owner）

| 通道 | owner | 端点 | 规则 |
| --- | --- | --- | --- |
| 固定演示推进/决定 | `demo-story-service` | `POST /api/v5-preview/demo/story`（既有） | 既有 requestId 幂等 + `expectedVersion` + `fromStepId` 门不变；**新增语义**：`decide(correct)` 与通过补交类 hold 步（s05/s10/s16 离步推进）时，服务端经同一命令区写专属会话的真实证据/复核记录（确定性 ID 幂等，见 §4） |
| 尽调页业务动作 | `remote-service` | `POST /api/v5-preview/remote-session/*`（既有全部不变） | attach-evidence / supersede-evidence / reviews / annotations / attendance / calculation：requestId 幂等 + remoteVersion 门；C 候选所有补充/纠正动作必须走这些端点，不得本地保存第二份业务事实 |
| 重开（当前专属演示） | `demo-story-service` | `POST /api/v5-preview/demo/reset`（**新增**） | 无需 body。作用域＝主线回 approval 种子起点（version 单调 +1、幂等表清空、cursor→s00）+ 清除专属演示会话及其全部依赖记录；**不触及**其他会话。非事务：先清 remote 后重置 rows，失败重试安全（清除幂等）；rows 指向已清会话时由 §3 懒建自愈 |
| 演示情景切换 | `service.ts` | `POST /api/v5-preview/demo/seed`（既有不变） | 写入后按新 overview 重定位 cursor（approval→s00；settled→终态步；post-rental→无匹配→free 诚实降级） |
| 版本门 | — | — | `overview.version` 只被业务/演示命令递增；**共享投影不递增版本**（投影是派生视图）。`remoteVersion` 语义不变（每次 remote 命令 +1，含演示自动产生的证据/复核写入） |

## 3. 共享事实只读出口（**新增**，B/C 消费点）

`GET /api/v5-preview/demo/shared-state` →

```jsonc
{
  "ok": true,
  "projectId": "JW-2026-018",
  "demoSessionId": "rs-…" | null,      // 专属演示会话（null=尚未建立，尽调页可触发懒建后重取）
  "sessionStatus": "live" | … | null,
  "facts": [                            // 每条 fixture 取代链一项（按冻结映射表带域）
    { "fixtureId": "fixture-inspection", "domain": "asset", "chainVersion": 2,
      "status": "contested",           // unverified | human_verified | contested
      "title": "生产现场巡检照片…（重拍/补充，取代 ev-…）", "evidenceId": "ev-…" }
  ],
  "pendingReview": [                    // 旧结论待复核清单（contested 链）
    { "fixtureId": "…", "domain": "…", "reason": "correct|request_resupply|request_retake|escalate_human", "at": "ISO" }
  ],
  "evidenceCount": 3, "reviewCount": 2
}
```

- 附带效应（诚实声明）：该 GET 会先执行共享投影同步（§5），因此**读取可能触发服务端落盘**——这是崩溃自愈路径，不是隐藏写命令。
- 尽调页会话选择：C 候选应优先用 `demoSessionId`（为 null 时可 `POST /api/v5-preview/remote-session` 走既有 create-session，或调本端点后重取）；不再无脑取 `sessions[0]`。

## 4. 演示自动写入 remote 的确定性 ID（幂等恢复关键）

- 演示产生的证据：`evidenceId = "ev-demo-" + <stepToken> + "-" + <sessionId>`（如 `ev-demo-s05dd03-rs-xxxx`）；写入前按 id 存在性检查，重试/重放不产生第二条。
- 演示产生的复核：`reviewId = "rev-demo-" + <stepToken> + "-" + <sessionId>`（stepToken 如 `s09correct`）。
- 步 token 映射：s05→`s05dd03`(fixture-inspection attach)、s10→`s10drt1`(fixture-equipment attach)、s16→`s16sgrt`(fixture-contract attach)、s09 correct→`s09correct`(fixture-inspection review)、s12 correct→`s12correct`(fixture-equipment review)、s15 correct→`s15correct`(fixture-contract review)。confirm/return 不产生 remote 写入。
- **恢复规则（非事务，两次独立写不冒充事务）**：remote 命令成功后 rows 写入失败 → 客户端按 NETWORK 原样重试（同 requestId：remote 侧幂等重放，rows 侧补写）；投影数据一律可从 remote 记录**重算重建**（唯一事实源），rows 中投影残缺/重复由确定性消息 ID 去重兜底。测试覆盖该路径。

## 5. 投影规则（A 服务端执行，B 只展示）

- 触发：GET project / GET·POST story / notes / messages / seed / shared-state 前，同步一次（读 remote → 派生标记；无变化不写盘）。
- 域标记： contested 链 → 对应域 `judgmentText` 追加「证据纠正待复核」（黄灯不变绿）；链被最新 confirm 闭合 → 标记自动消失；**投影永不把判断灯改为绿色**（人工门）。
- 待办：受影响域与当前待办 `relatedDomain` 一致时，待办状态保持/转为「待复核」，detail 追加证据链版本说明（不冒充已复核）。
- 消息：每个投影事件一条 ≤2 句消息，确定性 id `msg-shared-<evidenceId|reviewId>`（重算去重）；来源标注诚实：业务侧操作=「业务（演示身份）」/ 演示自动=system + marks `["演示情景","共享尽调"]` / 一律不冒充真实模型判断。
- 失败降级：remote-store 损坏/不可用时，GET 返回 last-known rows 数据 + 响应顶栏错误码（`REMOTE_STORE_*`），不阻塞首页只读浏览。

## 6. 错误码

全部沿用既有码表：rows 侧 `INVALID_INPUT/VERSION_CONFLICT/REQUEST_MISMATCH/STORY_STEP_CHANGED/STORY_DECISION_REQUIRED/STORE_*`；remote 侧 `REMOTE_STORE_*`/`SESSION_PAUSED`/`MODEL_NOT_CONFIGURED` 等。**本接口不新增错误码**；reset 的 remote 清除失败按 `STORE_UNAVAILABLE`(500) 返回，重试安全。

## 7. 真实模型与来源

真实模型断开时合成输入走同一后端（`annotations/simulate`），`MODE=real` 未配置则真实调用 0 次——C 的模型按钮沿用 `model-status` 状态门。投影与演示消息**不**把预设/模拟标成真实模型。

— A 冻结签名：`sha256(INTERFACE.md)` 见 STATUS.md；接口实现以 `lib/v5-preview/shared-facts.ts` + 上列端点为准。
