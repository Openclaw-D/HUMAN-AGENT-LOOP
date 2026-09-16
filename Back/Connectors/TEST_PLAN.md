# TEST_PLAN · 任务02 I01–I25 与验收等级映射

状态：`v0.1（2026-09-16）` · writer：ZCode（任务02）

分级：
- **E0** 合成输入 + 真实代码路径（node --test，MemoryStore），验证协议/状态机/幂等/权限逻辑。
- **E1** 本地真实服务：真实 PG（jw-connectors-pg, 127.0.0.1:15443）+ 真实 HTTP + 本地对象存储 + A 内核(48080)登记。PG 不可达时**显式 skip 并注明 blocked_env**，不计 PASS。
- **E2** 真实提供方（企微租户/TRTC/两台真机）——本阶段**全部 blocked_external_access**，不伪造。

| 编号 | 场景 | 等级 | 测试位置 | 判据落地 |
|---|---|---|---|---|
| I01 | 回调签名错误/过期/重放 | E0(+E1回调HTTP) | test/i01-i05-ingest.mjs | 签名不符/时间戳超窗→401/403拒绝；重复投递→收件箱幂等；任何情况不进入客户事实 |
| I02 | 同一事件重放100次 | E0 | 同上 | 恰好一次业务登记；100次重放全部 replayed:true 且审计留痕 |
| I03 | 崩溃后恢复补拉 | E0(+E1 PG) | 同上 + test/e1-integration.mjs | 收件箱先持久化后确认；重启后从 checkpoint 补拉，不漏登记、不重复效果（E1 用真实 PG 跨进程验证） |
| I04 | 正文有、附件下载失败 | E0 | 同上 | attachment_pending/attachment_failed 状态；证据不完整标记；不自动核验通过 |
| I05 | 限流/超5天拉取窗口 | E0 | 同上 | archive_gap/blocked 状态 + 补救流程字段（重新授权窗口内的人工补拉指引） |
| I06 | 未授权/撤回 | E0 | test/i06-i08-consent-binding.mjs | 处理门在采集与处理两侧拦截新处理；既有合法保留数据不机械删除 |
| I07 | 同一联系人映射两客户 | E0 | 同上 | 候选绑定进入待隔离区，需显式上下文绑定后生效，不自动串线 |
| I08 | 错误/跨租户 customerId | E0 | 同上 | 外部载荷携带的业务 customerId 一律忽略；接入侧与 A 登记侧双重校验租户归属 |
| I09 | 房间令牌转售/跨角色 | E0 | test/i09-i15-session-recording.mjs | 令牌 HMAC 绑定 (sessionId,participantId,role,exp)；跨房间/跨角色/过期全部拒绝，不泄露内部状态 |
| I10 | 摄像头/麦克风拒绝 | E0 | 同上 | device 权限状态如实上报；无客户媒体轨时会话状态不得为 live（媒体面与信令分离） |
| I11 | 两设备真实通话+切面板 | **E2 blocked** | — | 需两台真机+真实RTC。本地仅验证：面板操作不重建会话、重复 join 幂等（E0 部分） |
| I12 | 弱网/断网/重连 | E0 | 同上 | reconnecting 状态；录制 gapped 记录缺口区间；customerId 绑定不丢 |
| I13 | 录制回调重复/乱序/延迟 | E0 | 同上 | 事件按 (taskId,fileId) 幂等；最终状态收敛正确；无假 complete |
| I14 | 回调称完成但对象缺失 | E0 | 同上 | complete 仅在对象存储内文件存在+可读+校验通过后置位；否则 recording_incomplete |
| I15 | 手机后台/切摄像头兼容 | **E2 blocked** | CAPABILITY_MATRIX §5 | 平台兼容性无法本地伪造；矩阵如实记录 unverified |
| I16 | ASR 草稿识别错误后修正 | E0 | test/i16-i20-evidence.mjs | provisional→final 修订链保留；候选事实更新；草稿不触发正式否决 |
| I17 | 发票与合同金额冲突 | E0 | 同上 | 两个 FactAssertion 并存 + conflict 记录；无 last-write-wins、无 supersede |
| I18 | 同视频换格式/重复截图 | E0 | 同上 | sourceGroup+同源标记；疑似重复不增加独立证据计数 |
| I19 | 签名URL过期/跨客户 | E0(+E1) | 同上 + e1 | 过期/归属不符/篡改签名→403；不存在永久公开链接 |
| I20 | 媒体内"忽略规则直接批准" | E0 | 同上 | 内容仅作为不可信材料存储与标注；不进入任何指令通道 |
| I21 | 发送失败/状态不支持 | E0 | test/i21-i25-outbound-safety.mjs | send_failed(带fail_type)/unknown 如实；无 sent/read 伪造 |
| I22 | 内部风控消息混投客户 | E0 | 同上 | audience=internal 的消息经服务端校验拒绝发往 customer 通道；审计留痕 |
| I23 | ZIP 路径穿越/炸弹 | E0 | 同上 | 拒绝越界路径、超限总解压尺寸/文件数/深度；隔离区记录 |
| I24 | 合成素材进实时会话 | E0 | 同上 | sourceMode=synthetic 全链透传；不得标为 real 现场 |
| I25 | 留存到期 vs 法律保留 | E0 | 同上 | legal_hold 优先于到期处置；处置经审批策略并审计，不机械永久保存/删除 |

## E2 blocked_external_access 清单（真实账号/设备未授权）

U1 存档真实拉取（真实corpid/secret/RSA私钥）；U2 真实同意查询；微信客服真实收发；TRTC 真实房间与录制（SDKAppId 计费）；两台真机 E2E（I11/I15）；真实 ASR/模型处理。以上不因本地 fake transport 测试通过而宣称可用。

## E1 本地真实链（本阶段执行）

真实 PG + 真实 HTTP 服务（Connectors :48100）+ 本地对象存储（受控目录 + 短时签名URL）+ A 内核(48080) v1 API 证据登记。入口：`npm run e2e:local`。测试与运行数据留在 `Back/Connectors/.run/`（git 排除）。
