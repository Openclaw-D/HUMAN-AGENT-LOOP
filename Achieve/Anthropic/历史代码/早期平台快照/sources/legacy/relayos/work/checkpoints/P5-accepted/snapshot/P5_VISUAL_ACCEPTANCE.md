# RelayOS P5 浏览器验收索引

## 验收环境

- 日期：2026-08-26
- Browser：Codex in-app Browser，真实 DOM 与交互
- 临时服务：`127.0.0.1:57419`，验收后已关闭
- 数据：由共同 P5 seed runner 生成的临时 SQLite，验收后已删除
- 主视口：`1920×1080`；补充检查：`1440×900`、`390×844`
- 用户可见 P4 回滚服务：`127.0.0.1:4177`，未停止、未替换、未作为 P5 验收服务

## 截图索引

| 文件 | 场景与证据 | SHA-256 |
|---|---|---|
| `work/checkpoints/P5-accepted/visual/01-supply-chain-main.png` | `supplyChain` 主图；十场景选择器、五问、图例和当前 projection | `AD5C5EADD954632052C8553CBEAA5F3C14703915B21B17539E95E9FEFAA8A143` |
| `work/checkpoints/P5-accepted/visual/02-finance-evidence-metrics-exceptions.png` | `finance` 共同详情 drawer；F/I/H、business/risk/efficiency metrics、Exception/Escalation history | `60AD867C360EFFCE909151D08F964DADE521FC04B62D14F74BDF1FAA55A08D98` |
| `work/checkpoints/P5-accepted/visual/03-enterprise-automation-replay.png` | `enterpriseAutomation` Replay；create、handoff、Gate、receipt、metrics、close 事件链 | `E4C411BDDF11F03DB8A43368AF6DFC6A7769F378792A20136EB3C0C876A79C7B` |
| `work/checkpoints/P5-accepted/visual/04-finance-unknown-receipt.png` | `finance` isolated unknown receipt；明确显示 unknown，不显示成功 | `47F72C0EFC392D460EC2D9FC8B87580002D7CDB80FE9EBA63BCA382C07FA8D82` |
| `work/checkpoints/P5-accepted/visual/05-finance-advisory-zero-write.png` | `finance` 调用 `/api/advisories` 后仍为主事项 `v39`；`authority=none`，projection version/hash 未变 | `689AC0151DC3B67C9F71380BCB51E8741FB6D1498E45405CAE137F715AD727DF` |
| `work/checkpoints/P5-accepted/visual/06-finance-mobile-390x844.png` | `finance` 移动端；场景选择、主图、inspector 与 action bar 可见可操作 | `79619C5011B0764C2F57EBFD7FB98A8F3298D1AC864AFDF5518EC644AFD1533F` |

## 真实交互证据

- 场景选择器从 `/api/scenarios` 返回 10 个 config；浏览器逐一选择全部十场景。每个主 WorkCase 都显示对应 `p5-<scenarioKey>-main`、projection `v39`，五问、图例和 7 组详情均由当前 graph projection 派生。
- `supplyChain`、`finance`、`enterpriseAutomation` 三个重点场景完成真实点击与截图；它们使用同一个 graph renderer、inspector 与 drawer。
- `finance` AI 建议按钮实际调用 `/api/advisories`。调用前后标题均为主事项 `v39`，自动核对 `projectionVersion` 与 `projectionHash` 未变化，返回 `authority=none`。
- isolated `finance` unknown receipt WorkCase 显示 unknown 状态，未出现成功标签；offered handoff 在接受前由自动化 Gate 证明 owner 不变。
- Replay drawer 从 `/api/work-cases/:id/events` 派生，事件链包含建案、版本目标/上下文/证据、交接、Gate、ActionIntent、ExecutionReceipt、三类指标、异常升级与关闭。
- `1920×1080` 主图保持绝对主体；`1440×900` 时主图宽约 1089 px、inspector 350 px；`390×844` 时文档宽 375 px，无横向内容溢出，关键控件可见。
- 浏览器控制台错误：0。

## 限制

截图只证明真实 UI 呈现与交互，不替代 domain/API/replay 逻辑证据。逻辑与数据证明记录在 `P5_ACCEPTANCE.md` 和自动化 Gate 中。没有独立 runtime key，因此未做 live Z.AI 验证；没有连接真实外部系统。
