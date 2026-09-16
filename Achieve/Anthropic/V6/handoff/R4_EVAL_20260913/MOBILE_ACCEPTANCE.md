# MOBILE_ACCEPTANCE｜手机验收报告（R4_EVAL_20260913）

判定工具：`tools/mobile-measure-check.mjs`（mobile-measurement@1 → mobile-verdict@1）。
**规则：没有原始 DOM 量测文件不 PASS；截图仅为佐证附件；无法精确尺寸 → BLOCKED，不拿缩放替代。**

## 当前判定（R4 更新）

| 项 | 状态 |
| --- | --- |
| MAIN 真实量测（本轮） | **BLOCKED——未收到**（`handoff/R4_MAIN_20260913/integration-inputs/` 尚无批次；inputs-check 实测 0/3 轨迹、0/1 量测） |
| 旧截图复用防线 | 已内置：量测 meta.screenshotHashes 与批次内截图文件对拍；跨批次重复 hash → 只作历史证据（Codex R3 指出的 prod-402 同 SHA 复用问题即此检查对象） |
| 检查器验证（合成夹具） | 5 夹具判定符合预期（见下）；R4 另增 Gate 无关，检查器与 R3 同版 |

## 当前判定（R3 原始记录， retained）

| 项 | 状态 | 依据 |
| --- | --- | --- |
| MAIN 真实页面量测（402×874 CSS px / DPR3） | **BLOCKED——未收到** | `handoff/R3_MAIN_20260913/` 尚不存在；未收到任何 mobile-measurement@1 文件 |
| 检查器本体验证 | **通过（合成夹具）** | evidence-r3/mobile-fixtures-verify.txt：mm-pass→PASS(9/9)；mm-fail-overflow→FAIL(整页滚动)；mm-fail-first-screen→FAIL(首屏输入)；mm-fail-viewport→FAIL(442×961 DPR0.91 缩放冒称，3 项定位)；mm-fail-hangup→FAIL(挂断需滚动) |

对照 Codex R2 返工项（真实缺陷 → 本检查器可精确复现与拦截）：

1. "prod-402 实际 442×961、DPR0.91" → mm-fail-viewport FAIL（viewport + 缩放声明 + DPR 提醒三项定位）。
2. "整页滚动条、首屏看不到聊天输入" → mm-fail-overflow / mm-fail-first-screen FAIL（scrollHeight>clientHeight、chatInputVisible=false）。
3. "挂断被挤出可视区" → mm-fail-hangup FAIL（rect.y=1023.7 超出首屏，inInitialViewport=false）。

## MAIN 接入指引

产出 `mobile-measurement@1` 量测 JSON（字段见 docs/MOBILE_MEASUREMENT_SCHEMA.md）：记录实际 innerWidth/innerHeight、visualViewport、DPR、每页 scroll 尺寸、关键控件 rect、首屏三项；随附截图可作佐证。交：
`node tools/mobile-measure-check.mjs --measurement <文件>`（PASS exit 0 / FAIL·BLOCKED exit 3）。

## NOT TESTED

真机 Safari（iPhone 17 实机 DPR3）、软键盘、无障碍缩放交互——均未测；仿真环境量测必须标注 SIMULATED。
