# browser-harness · 最小可操作浏览器验证页（任务04 S3，E0）

无框架、无视觉装饰。目标不是产品前端，而是用真实 HTTP/SSE 操作证明 Edge 语义：**不是动画驱动的假闭环**。完整视觉前端另有任务，不在此页范围内。

## 运行

```bash
cd Back/Edge && node scripts/edge-start.mjs   # harness 由 Edge 同源提供
# 打开 http://127.0.0.1:48200/harness/
```

会话用合成演示凭据 `harness-demo-cred`（仿 A 内核 tok-* 公开合成值模式；仅本机 E0，不用于任何真实身份）。未带 `--fixture-auth` 直跑 `src/server.mjs` 时登录失败关闭。

## 覆盖的判据面（E0）

| 页面要素 | 对应场景 | 说明 |
|---|---|---|
| 会话换取 | S3 凭据映射 | 凭据仅用于 POST /session，之后请求只带 X-JW-Session；凭据不出现在任何响应 |
| 客户选择 + 加载快照 | D06（结构面） | 切换客户=显式停订阅、清空去重集合与游标，防错绑 |
| 事件订阅/去重/断线恢复 | D03/D04/D05 | EventSource 自动 Last-Event-ID；resync 事件→清游标、要求重拉快照，不静默续播 |
| 媒体会话占位常驻 + 面板开合 | D08（结构面） | 占位组件存活计数持续、重建次数恒 0；真实 RTC BLOCKED(任务02) |
| 动作 POST + 同 requestId 重试 | D13 | Edge 不代生成 requestId；上游未知返回 502 UPSTREAM_UNKNOWN + 原 ID，页面提供同 ID 重试 |
| 消息受众分离 | D09 | internal 内容外发默认 403 AUDIENCE_MISMATCH；显式 confirmExternalSend 放行并强制审计 |
| 审计查看 | S3 可审计副作用 | GET /api/jw/v2/audit（需会话） |

## 明确 BLOCKED（不在本页冒充）

- 真实视频/RTC/录制（任务02）：占位存根，不接任何媒体。
- 真实额度预占/正式复核动作的业务效果（任务01 内核）：动作会转发到配置的上游端口，未运行时如实显示 502/错误。
- 用户视觉验收（E3 层）：本页是工程验证页，不是视觉稿。
