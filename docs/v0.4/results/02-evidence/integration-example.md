# 集成调用示例 · V0.4-02 证据选择模块

本文件是接线示例，**不是已装配代码**。当前 `Back/Edge/src/server.mjs` 仍以旧签名调用（无 scope），用户页面尚无组合分析入口。

## 1. 现状（已兼容，无需改动）

`server.mjs` 中既有调用（`attachEvidence`，约 411 行附近）不改即保持旧语义——请求全部可读材料：

```js
target.evidencePack = await assistantEvidence({ snapshot: workspace, tenantId, customerId, revision: target.contextVersion });
```

## 2. 未来接入显式材料选择（待串行集成）

当上游（如 assistant 请求体新增 `materialScope.artifactIds`）需要指定单件/组合分析时，把用户选择的材料 ID 列表透传为 `scope`：

```js
// 伪代码：server.mjs attachEvidence 的未来形态（本路未实施）
const scope = Array.isArray(body.materialScope?.artifactIds)
  ? { artifactIds: body.materialScope.artifactIds }   // 空数组/越权ID会在 provider 内失败关闭
  : undefined;                                        // 未提供=旧全量语义
target.evidencePack = await assistantEvidence({
  snapshot: workspace, tenantId, customerId,
  revision: target.contextVersion, scope,
});
```

直接调用 provider 的最小可运行示例（已由 `Back/Edge/test/v04-evidence-provider.test.mjs` 验证）：

```js
import { createAssistantEvidenceProvider } from './assistant-evidence-provider.mjs';

const provider = createAssistantEvidenceProvider({ baseUrl, token, policy: model.evidencePolicy });
const pack = await provider({
  snapshot: workspace, tenantId, customerId, revision,
  scope: { artifactIds: ['art-b', 'art-a', 'art-b'] }, // 乱序/重复可接受，内部去重排序
});
// pack.selection = { mode: 'explicit', artifactIds: ['art-a','art-b'], summary: <sha256> }
// summary 可写入回执/日志绑定本次分析的证据范围；未选材料的文本不会出现在 pack 中。
```

## 3. 回执摘要接线（待后续串行任务）

- 显式模式下 `pack.selection` 已参与 `contextHash`（不同选择→不同 requestId），无需额外改动即可区分重放身份。
- 若需要把 `selection.summary` 单独落回执字段（如 receipt.evidenceSelection），属回执模块接线任务，本路未实施、不宣称已完成。
