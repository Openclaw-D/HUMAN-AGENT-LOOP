# E1 集成测试（任务04 S2）· 冻结门与真实变体

本目录的用例是**真实服务变体**（E1 级），受 `e1-gate.mjs` 冻结门控制：门未过时用例**如实 skip 并打印原因**，不伪造 PASS；门全过（任务01 契约已汇入 `Back/CONTRACT.md` ≥ v2、提案状态变更、`git status Back/A` 干净、docker 可达）时自动变为可执行。

## 冻结门判据（`e1-gate.mjs checkFreezeGate()`）

1. `Back/CONTRACT.md` 头部版本 ≥ v2；
2. `docs/customer-next/S1_API_V2_SCHEMA_PROPOSAL.md` 状态行不再含"待总控冻结"；
3. `git status --porcelain Back/A` 为空（server.ts/credit.ts 实现固定）；
4. docker 可达。

## 现有用例

| 用例 | 对应矩阵 | 说明 |
|---|---|---|
| `e1-d02-real.test.mjs` | D02 | 自有隔离 PG（v7d-、15434）+ 全部 A 迁移 + JW 内核（17919 段，不碰旧 48080/15432）+ Edge 真实探针；停 PG → live 保持 ok、ready 翻不 ok 且逐依赖给原因、无 all_ok；重启 PG → ready 恢复 ok |

## 运行

```bash
cd Back/Edge
node --test test/e1/e1-d02-real.test.mjs     # 本机 node --test <目录> 有 MODULE_NOT_FOUND 怪癖，用显式文件
```

## 待契约冻结后补写（届时与 store.mjs seam 替换同轮）

- E1-D03/D04/D05 真实变体：真实内核事件源（A outbox/事件 API）→ Edge SSE 的桥接测试。依赖冻结后的 v2 事件 API 形态，现在不预写以免对着移动目标写测试。
- 动作代理真实凭据映射：等待 v2 权限矩阵冻结后，把 `credentialFor` 从占位实现切到会话→真实凭据映射。
