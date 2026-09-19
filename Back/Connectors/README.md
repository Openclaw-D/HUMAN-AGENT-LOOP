# Back/Connectors

会话/录制/进件/证据/处理协调服务面（goal-02 资料处理链 owner）。

## 部署边界（IR-04-2A-4 · 必读）

- `/api/connectors/**` 全部为 **服务令牌面**（`x-service-token`）：仅限服务端内网调用（Edge 换权点、
  内部作业、联调脚本）。**不是**页面/浏览器直连面——页面身份（用户会话→租户/客户/角色/操作者）
  的裁决在 Edge（任务04 `channel-authz`）；Connectors 与其互为冗余校验（上传邀请↔客户一致性、
  预览归属对账），服务令牌本身不是资源授权。
- 客户映射：`a_customer_links` 表为权威。同 customerId 场景由处理链经 A 权威核验自动登记；
  映射场景走 `POST /api/connectors/customers/link`（legalEntityRef 归属证明）。禁止按文件名/
  企业同名/前缀推断客户（代码无此路径）。
- 真实企微/TRTC/GML 外发默认关闭（`allowRealWecom/allowRealTrtc=false`、outboundPolicy=
  `suggest_only`）；处理任务等待态（blocked_link/blocked_a_unavailable/blocked_unknown）由常驻
  驱动 sweep 自动恢复，绝不换 ID 重发、不静默丢件。

## 启动

见 `scripts/start-connectors.mjs`：配置读 `.run/config.json`（样例 `config/connectors.config.example.json`，
真实凭据不入 Git）。处理常驻驱动 `driverIntervalMs` 默认 2000ms；`/healthz` 含处理驱动只读观测。

## 测试

```
npm test          # 全量（隔离 PG 15443；A 桥用例需 A 管理库 15444，不可达时显式 SKIP）
npm run test:processing
```
