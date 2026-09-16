# CAPABILITY_MATRIX · 企业微信/腾讯云 RTC 能力核验（任务02 S1）

状态：`v0.1 draft（2026-09-16）` · writer：ZCode（任务02）
方法：本矩阵只区分三类事实——**[DOC]** 官方文档当日全文核验（附URL与页面更新日期）；**[UNVERIFIED]** 文档存在但未在真实租户实测；**[BLOCKED]** 需要真实账号/付费/授权，未获授权，禁止用 mock 冒充通过。第三方营销说明一律不作为依据。

> 结论先行：
> 1. 企业微信**原生音视频通话画面没有任何官方接口**可实时进入网页/服务端（会话存档只能拿到通话的元数据与（付费后）音档文件，非实时流）→ A 路线（保持原生通话）**可实现范围受限**：仅事后存档/元数据，无法实时接入画面。
> 2. B 路线（从企业微信授权邀请进入受控 RTC 房间，如腾讯云 TRTC）在文档层面成立（TRTC 云端录制+回调能力 [DOC]），但需渠道政策确认 + 真实 SDKAppId 费用授权 → 全部 **[BLOCKED]**，不得宣称"仍是原生通话"。
> 3. "存档读取"≠"可代发"：对**外部客户**的程序化发送只有微信客服通道 [DOC]；会话存档是只读审计面。二者在实现与授权上必须分开建模。

## 1. 客户/联系人绑定能力

| 项 | 事实 | 等级 | 来源 |
|---|---|---|---|
| external contact 是"联系人"非"客户法律主体" | 客户联系模块以 external_userid/externalopenid 标识外部联系人；一个外部联系人可对应多个企业，任务02要求 customerId 必须由受控绑定取得 | [DOC] 结构 / [UNVERIFIED] 归属解析实测 | U-EXT：developer.work.weixin.qq.com 导航"客户联系-客户管理"（读取日期 2026-09-16） |
| U2 同意情况接口可按 (userid, externalopenid) 批量查询 | `POST /cgi-bin/msgaudit/check_single_agree`：≤100条/次；单聊 2500次/分，群聊(check_room_agree) 1500次/分；返回 `agreeinfo[]{agree_status:"Agree"/"Disagree", status_change_time}`；字段名官方拼写即 `exteranalopenid` | [DOC] | U2：…/91782（页面更新 2025/05/08，读取 2026-09-16） |
| 存档流内同意消息 | 消息 msgtype=`agree`/`disagree`（外部联系人同意/取消同意聊天存档）随存档流推送 | [DOC] | U1：…/91774（读取 2026-09-16） |
| external↔customerId 受控绑定表 | 本方设计（Connectors `ParticipantBinding`），非企微能力；归属不确定→隔离区 | 设计 | docs/CONTRACT.md |

## 2. 消息存档（会话内容存档）

| 项 | 事实 | 等级 | 来源 |
|---|---|---|---|
| 拉取模型 | **拉取式**：C SDK `WeWorkFinanceSdk.Init(corpid,secret)`→`GetChatData(seq,limit≤1000,proxy,passwd,publicKeySeq,timeout)`→返回 `chatdata[]{seq, msgid, publickey_ver, encrypt_random_key, encrypt_chat_msg}`；经 RSA(2048,PKCS#1 v1.5) 解 `encrypt_random_key` 得 msgRandomKey，再 SDK `DecryptData` 解正文。**官方以 C SDK/封装库交付，无纯HTTP接口** | [DOC] | U1：…/91774 |
| 增量游标 | seq 单调递增，企业自行持久化；从指定 seq 拉增量 | [DOC] | U1 |
| **保留/拉取窗口** | **"获取会话记录内容不能超过5天"**——超过5天未拉取的历史不可再取 → 任何停机超5天=不可补救的 archive_gap | [DOC] | U1 原文"拉取窗口"节 |
| 限流 | GetChatData ≤4000次/分钟；GetMediaData ≤25000次/分钟 | [DOC] | U1 |
| 存档前提 | 企业管理端开通会话存档、成员在开启名单、外部成员同意（agree/disagree 机制）；均为企业侧购买/配置前提 | [DOC] 使用前提 / [UNVERIFIED] 本企业是否购买 | U1 使用前帮助 + U2 |
| 附件 | GetMediaData(indexbuf,sdkfileid) 分片拉取，单片≤512KB，`is_finish` 结束标记，断点续传用 indexbuf | [DOC] | U1 |
| 撤回/变更覆盖 | msgtype=`revoke`（撤回）；`agree`/`disagree`（同意变更）；`switch`（企业成员切换企业）等 action/msgtype | [DOC] | U1 消息格式节 |
| 音视频通话 | **原生通话在存档中只有元数据**：`voiptext`（通话文本记录：`callduration`,`invitetype` 1个人/2单聊/3双人多
人/4多人）与 `meeting_voice_call`（通话**音频存档文件** sdkfileid）。**无实时画面流接口** | [DOC] | U1 消息格式节 |
| 历史补拉边界 | 仅5天窗口内；seq 与窗口共同决定可及范围 | [DOC] | U1 |

## 3. 外部客户消息能否由应用发送 / 送达已读

| 项 | 事实 | 等级 | 来源 |
|---|---|---|---|
| 应用消息 | 仅发往**企业成员**，不能直达外部客户 | [DOC] | U-MSG：开发者中心"消息接收与发送-发送应用消息"（读取 2026-09-16） |
| 客户联系群发 | 成员代发型，配额限制、非会话式发送，不是"代客户收发的对话通道" | [DOC] | U-EXT"消息推送-创建企业群发" |
| **微信客服**（对外收发的受支持通道） | `POST /cgi-bin/kf/sync_msg`（cursor 增量拉取消息/事件；**读取窗口3天**）；`POST /cgi-bin/kf/send_msg` 向客户发送；事件含 `msg_send_fail`（携带 `fail_type`）、撤回事件；图片≤2M、语音≤2M(≤60s)、视频≤10M(≤30s)、文件≤20M | [DOC] 接口存在与语义 / [UNVERIFIED] 真实收发 | U-KF：…/94670（接收消息和事件，读取 2026-09-16）；发送消息 94677 同导航 |
| 送达/已读状态 | 企微对外部客户**无已读回执接口**；微信客服返回 msgid，发送失败以 `msg_send_fail` 事件异步通知 → 只能建模 `sent_ok/send_failed/unknown`，**不存在 read** | [DOC]（能力缺失） | U-KF |
| 存档读取≠代发 | 会话存档是只读审计面，无发送权；发送权在微信客服/群发各自接口与配额下 | [DOC]（结构推断，逐接口如上） | U1 + U-KF |

## 4. 原生视频通话实时接入网页/服务端

| 项 | 事实 | 等级 |
|---|---|---|
| 原生通话实时画面流 | **无任何官方接口**。检索范围：会话内容存档（只有 voiptext 元数据与音档）、JS-SDK（无音视频通话流接口）、小程序 qy API（无）、会议模块（独立腾讯会议能力，非原生通话） | [DOC]（能力缺失，检索日期 2026-09-16；结论为"未发现"，实施期以官方更新为准） |
| 能否录制 | 原生通话：仅付费存档后的音档（事后）；画面不可录 | [DOC] |
| 能否喂给模型 | 音档可（事后）；画面不可（无流） | [DOC] |

**差异结论（任务02 §3 要求）**：
- **A 路线（保持原生通话）**：可实现=会话元数据/事后音档/存档文本；不可实现=实时画面接入网页与实时模型处理。范围受限，必须如实展示。
- **B 路线（企微授权邀请→受控 RTC 房间）**：文档上 TRTC 云端录制+回调成立（见§5）；客户从企微 H5 进入。**必须经渠道政策确认**；不得宣称仍是原生通话；是否自动符合内部制度由公司裁决 → [BLOCKED]。

## 5. H5/小程序/RTC 兼容性与 TRTC 录制

| 项 | 事实 | 等级 | 来源 |
|---|---|---|---|
| TRTC 云端录制回调 | `EventGroupId=3`，事件 301/302/303/304/305/306/307/309/310/311/312（页面录制 801-804）；POST JSON；应答 HTTP 200（建议 `{"code":0}`）；**5秒超时即失败，首次失败立即重试，之后每10秒重试至消息存续1分钟** → 回调必然重复/乱序可能，须幂等 | [DOC] | S4：cloud.tencent.com/document/product/647/81113（页面更新 2024-10-12，读取 2026-09-16） |
| 回调签名 | 请求头 `Sign` = `base64(hmacsha256(key, 原始body))`，key 为控制台自设≤32字符 | [DOC] | S4 |
| 关键事件语义 | 310（MP4→COS 完成）：`Payload.Status` 0=全部上传/1=至少一片滞留/2=异常退出，`FileMessage[]{FileName,UserId,TrackType(audio/video/audio_video),MediaId(main/aux/mix),StartTimeStamp,EndTimeStamp}`；311（VOD 提交）：`Status` 0/1/2 + `TencentVod{FileId,VideoUrl,CacheFile,StartTimeStamp,EndTimeStamp}`；302 LeaveCode（0正常/1被踢/2解散/99房间无人流超时/100房间超时…）；306 Failover=录制迁移；312=任务结束。**注意：收到311到文件实际可播还需30s-3min** | [DOC] | S4 |
| 缺口/分段 | 305/310/311 的 Status=1 明确表达"至少一片滞留"=分段缺失(gap)语义；滞留恢复上传=Status 2 | [DOC] | S4 |
| TRTC 费用与账号 | 需真实 SDKAppId、计费开通 | [BLOCKED] 未授权付费 |
| 企微内置浏览器摄像头/麦克风行为（H5 getUserMedia、后台切摄像头） | 文档无逐机型承诺；需真机矩阵实测 | [BLOCKED] 需真实设备与租户（E2） |
| 小程序 RTC 组件 | 存在小程序生态与 live-pusher/live-player 等，但在企微客户端内的 RTC 可用性未验证 | [UNVERIFIED] |

## 6. 覆盖与承诺边界（写入 §8 口径）

- 存档覆盖率只对"官方能力+授权范围内预期取得的数据"计算；原生短信/个人微信/私人电话不在任何官方读取范围 → 只记人工例外，不声称已监管。
- 没有存档数据 ≠ 客户没有沟通。
- 本矩阵日期：2026-09-16；官方能力随版本变化，E2 实施时须对当日文档重核。

## 7. 引用清单（source of truth）

| 编号 | URL | 页面更新日期 | 读取日期 | 核验方式 |
|---|---|---|---|---|
| U1 | https://developer.work.weixin.qq.com/document/path/91774 | 未标注（页面显示"最后更新"未给出具体日期） | 2026-09-16 | 全文抓取 |
| U2 | https://developer.work.weixin.qq.com/document/path/91782 | 2025/05/08 | 2026-09-16 | 全文抓取 |
| U-90968 | https://developer.work.weixin.qq.com/document/path/90968 | 未标注 | 2026-09-16 | 全文抓取（回调加解密） |
| U-KF | https://developer.work.weixin.qq.com/document/path/94670 | 未标注 | 2026-09-16 | 全文抓取（微信客服收发） |
| S4 | https://cloud.tencent.com/document/product/647/81113 | 2024-10-12 | 2026-09-16 | 全文抓取 |
| S3 | https://cloud.tencent.com/document/product/647/76497 | 未读取成功（页面压缩响应） | 2026-09-16 | **未核验**，仅 S4 间接证明录制存在；实施时重试 |

未决：本企业是否已购会话存档、TRTC SDKAppId、微信客服账号、渠道政策对 B 路线的批准——全部 [BLOCKED]，不因本文档存在而改变。
