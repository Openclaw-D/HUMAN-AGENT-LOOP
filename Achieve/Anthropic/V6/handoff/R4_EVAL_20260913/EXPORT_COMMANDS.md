# EXPORT_COMMANDS｜给 MAIN 的精确导出/接入命令（R4_EVAL_20260913）

单一接入合同：MAIN 拥有 `V6/handoff/R4_MAIN_20260913/integration-inputs/` 下每批一个**不可变编号目录**（如 `batch-001`）。
C 的核对入口：`node V6/handoff/R4_EVAL_20260913/tools/replay-cli.mjs inputs-check`（exit 0=满足回放前置，6=BLOCKED 并列缺件）。

## 1. 轨迹导出（每条真实运行轨迹一条命令）

对隔离运行完成后的 store 执行（`--session` 用实际 sessionId，可用 `inputs-check` 前先 `node -e "console.log(JSON.parse(require('fs').readFileSync('<store>','utf8')).sessions.map(s=>s.sessionId))"` 查询）：

```bash
node V6/handoff/R4_EVAL_20260913/tools/export-trajectory-from-store.mjs \
  --store <隔离环境>/remote-store.json \
  --session <sessionId> \
  --timeline-from session \
  --out V6/handoff/R4_MAIN_20260913/integration-inputs/<批次号>/trajectory-<n>.json
```

- 时间线优先放会话上（`session.timeline`，产品 TimelineEventRecord 原样）；若 MAIN 把时间线存 store 顶层则用 `--timeline-from store`。
- 待办投影：可选 `--todos <todos.json>`（TodoState[]：todoId/title/sessionId/status open|resolved|deferred/linkedOpinionIds/updatedAt）。缺省空数组 → R-HANG 记 N/A（如实，不编造）。

**最小必须字段**（缺任一 → 回放器 schema 失败 exit 2，不做猜测）：
- `meta`: trajectoryId, source="product_export", exportedAt, exportTool（其余由导出器自动填）；
- `session`: sessionId, status, generation（**非负整数，0 合法**——产品语义，勿 +1）, participants[].participantId, video{};
- 引用完整性：annotation.evidenceVersion / review.targetVersion 必须在包内 evidence/annotation 版本集合中存在；
- 全记录 sessionId = session.sessionId（跨会话记录不要并入）。

## 2. 手机量测（与截图同一运行）

按 `docs/MOBILE_MEASUREMENT_SCHEMA.md` 产出 `mobile-measurement@1` JSON 放入同批次（文件名含 `measurement`）：
- viewport（真实 innerWidth/innerHeight/DPR/visualViewport——**不得用缩放冒称 402/DPR3**，做不到就 BLOCKED 并注明）、
- pages[].scroll（scrollHeight/clientHeight）、
- elements[]（chat-input / hangup / five-rows 的 rect + inInitialViewport）、
- firstScreen 三项；
- **同运行绑定**：`meta` 中附 `screenshotHashes: { "<文件名>": "<sha256>" }`，C 将对拍批次内截图文件 hash——hash 对不上或跨批次重复 → 只能作历史证据，不作本轮完成证据（Codex R3 指出的同名图复用问题）。

## 3. C 侧核对与回执

```bash
node V6/handoff/R4_EVAL_20260913/tools/replay-cli.mjs inputs-check          # exit 0=满足前置 / 6=BLOCKED+缺件清单
node V6/handoff/R4_EVAL_20260913/tools/replay-cli.mjs inputs-check --receipts
node V6/handoff/R4_EVAL_20260913/tools/replay-cli.mjs replay --trajectory <轨迹> --gate   # exit 0/4/5
node V6/handoff/R4_EVAL_20260913/tools/mobile-measure-check.mjs --measurement <量测>      # exit 0/3
```

每条轨迹回执含：来源、逐规则 pass/violation/undecided/na、失败定位（事件ID/版本/缺失边界）。**规则不为让 MAIN 通过而放松；schema 通过 ≠ 权限通过；字段无证据 → undecided/blocked。**
