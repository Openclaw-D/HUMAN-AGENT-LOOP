# assembly 缺陷单 → B 路（A 发现，2026-09-15 02:50 前后）

## DEFECT-B1（阻断 A 的 B 编排器接入）

- **位置**：`B/src/ports.mjs` `atomicWriteJson`（约 137 行）
- **现象**：`TypeError: Cannot read properties of undefined (reading 'writeFile')`
- **根因**：`B/src/deps.mjs` 导出 `fs = node:fs/promises` 模块（顶层即有 writeFile/rename，**无 `.promises` 子属性**）；`atomicWriteJson` 调 `fs.promises.writeFile/rename` → undefined。
- **影响面**：thin 编排器 `#saveSnapshot`（每次 start 必经）崩溃；journal 追加（fs.mkdir/appendFile/readFile）正常。
- **建议修复（B 路自行落地，A 不改他路文件）**：`atomicWriteJson` 内改用 `await fs.writeFile(...)` / `await fs.rename(...)`（与 deps.mjs 导出一致），或 deps.mjs 增加 `import fsCb from 'node:fs'` 并导出。
- **A 侧状态**：`assembly/b-round.mjs` 已就绪（A 服务 × B thin 编排器 × createARunSink × C 工具端口全接线）；本缺陷修复后重跑 `node assembly/b-round.mjs` 即可出组合证据。失败现场：`A/evidence/assembly-b-round-1.txt`。

## 已被 B 对账材料解决的分歧（更新 MANIFEST）

`B/src/a-sync.mjs` 的 `toACandidate` 已在 B 侧解决 MANIFEST 分歧 1/2：
- evidenceRefs → `${id}@v${version}` 字符串（A 合同形状）；
- `recommendedHumanAction === 'none'` 时字段省略（A 视为可选缺省）。
分歧 3（validateRulePack 返回 `[]`）维持 assembly 缝上适配。
