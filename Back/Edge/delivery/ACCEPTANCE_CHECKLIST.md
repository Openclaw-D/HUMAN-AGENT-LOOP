# 任务三 · 现场验收操作清单（打印随行；对应 DELIVERY_MATRIX §6 的 NOT_RUN 回填项）

操作者：非开发人员即可。全程**不需要**改数据库、改文件或手动伪造任何状态。
预计用时 40–60 分钟。发现问题随时停：本清单每步都有"应看到"，不符即在记录表记 FAIL + 现象。

## 0｜准备（约 5 分钟）

| 项 | 要求 |
|---|---|
| 终端 | **三台物理设备**（同机多浏览器不算；不够三台时如实记录实际台数，不得称三终端） |
| 每台 | 浏览器（Chrome/Edge 最新版）+ 能访问主机 48200/3618 端口 |
| 录屏 | 主机侧录屏工具（Win+G 或 OBS），先试录 10 秒确认有声音/画面 |
| 主机 | `cd Back/Edge && node scripts/env-check.mjs` → 期望 **FAIL=0**（busy 端口先弄清归属） |
| 时效 | 若距交付超过数日，先快速确认集成态仍绿：`cd Back/Edge && node --test test/e1/e1-task3-scenario.test.mjs`（期望 1/1；失败则把输出发回给任务三执行者，勿继续走查） |
| 配置 | `Back/Edge/config/delivery-runtime.json` 在位（复制过 .example） |

## 1｜起栈（步骤 → 应看到）

```
cd Back/Edge
node scripts/delivery-up.mjs        ← 保持此窗口开启（Ctrl+C=停止）
```
应看到：逐项 ✓，最后"就绪：是"。
新开终端：`node scripts/delivery-seed.mjs`
应看到：打印 **客户 ID**（cust-…）与现场动线。**把客户 ID 抄到记录表**。

## 2｜三终端连接（C02）

- 终端 A（业务）：打开 `http://<主机IP>:3618/`（或主机上 `cd Front && node start-preview.mjs` 后本机 127.0.0.1:3618）
  - 连接条：Edge 地址 `http://<主机IP>:48200`，凭据 `tok-biz1`，客户 ID = 步骤 1 抄录值
- 终端 B（厂长）：同上，凭据 `tok-dir1`
- 终端 C（客户实控人）：同上，凭据 `tok-cust1`
应看到：每台顶部徽标 **"Live · 真实后台"** + 相同 buildId。
跨机访问若连不上：主机 Edge 需加 `--allowed-origin http://<终端IP或域名>:<端口>` 重启（见 OPS §2），**不得**为此关闭认证。

**记录**：三终端各自截图（连接条+客户名可见）。

## 3｜贯穿场景动线（对应任务书 §5；每步"应看到"即录屏要点）

| # | 在哪台 | 操作 | 应看到 |
|---|---|---|---|
| 1 | A | "当前待办"页签 → 核验卡/额度区 | 客户、已批准 500 万（已激活）、两笔申请（未预占）、检查会话 preparing |
| 2 | A | 会话操作条 → **开始会话** | runStatus→in_progress；三台同步（≤2 秒内 B/C 也更新） |
| 3 | A | 对申请1/申请2 分别做 reserve（经 Edge harness `http://<主机IP>:48200/harness/` 或 API） | 额度区"已预占 180 万"三台联动；**再对第三笔超占 reserve → 明确显示 INSUFFICIENT_AVAILABLE_AMOUNT** |
| 4 | B | 观察核验卡 | "需要谁行动"指向的核验项与 A 一致（同一客户事实） |
| 5 | A | **暂停自动提问** | 暂停 + "等待原因：自动提问已停发…"；B/C 同步 |
| 6 | A | **恢复会话** | 恢复；重复点同一动作若遇 502 → 显示"对账中"，同 ID 重试**不产生重复效果** |
| 7 | A | **结束本轮** | 收口状态 pending_evidence；未决项转会后待办 |
| 8 | A | 经 harness 登记不利材料（litigation，supersede 之前先正常登记一条再更正） | 新批准尝试被拒（STALE_BASIS）；**已批准 500 万与既有预占不变**（历史决定保留） |
| 9 | 主机 | 注入一次后台重启：`delivery-down` → `delivery-up` → `delivery-seed` 跳过（沿用原客户 ID 重新连接） | 三台重连后数据全在：额度/预占/会话状态一致，无重复预占 |
| 10 | C | 客户视角浏览 | 客户视图**不含**内部风险策略字段；受众消息分 customer/internal |

**录屏要求**：三终端画面同框（或分屏录制），含每步操作与时间；文件名 `task3-onsite-<日期>-terminalA/B/C.mp4`，存 `docs/customer-next/acceptance/evidence/task3-onsite-<日期>/`。

## 4｜回填（现场结束 10 分钟内）

1. `Back/Edge/delivery/DELIVERY_MATRIX.md` §6：把 C01（走查人/时间）、C02（三终端实测）、C06（断开 Edge 观察降级横幅 + 本地演示仍可用）三行 NOT_RUN 改为实测结果；录屏路径写入 §7。
2. `Back/Edge/delivery/HANDOFF_DEFECTS.md` T6：裁决 X08（a 接受语义→更新 s3-csrf 判据 / b 回退实现）。
3. 收尾：`node scripts/delivery-down.mjs`（数据库保持运行；`--with-db` 停库）。

## 5｜结论口径

以上全部完成且无未决 FAIL 后，方可出具：**"本范围受控交付通过"**（不含真实资金支付、真实视频提供方、全公司生产上线获批；C09 回放/训练命名空间仍为受限项）。
