# SA-R2-B1 笔记 · 事件时间线与项目阶段模块（REMOTE_DD_LONG_RUN）

日期：2026-09-11（夜间实现轮 R2）
仓库：`jianwei-v3/site/`（唯一活动代码仓库）
状态：完成。全部服务端约束（纯逻辑，非前端装饰）；合成演示语义，不执行正式审批，模型 authority=none。

## 写入文件（仅这三个）

1. `lib/v5-preview/remote-timeline.ts`（新建，零 IO、零模块依赖的纯逻辑）
2. `lib/v5-preview/remote-service.ts`（最小接线：文件尾追加 re-export + `appendRemoteTimelineEvent` 一个服务端约束入口；不改任何既有函数行为、不改 remote-store schema）
3. `test/v5-preview-remote-timeline.test.mjs`（新建）

## 导出接口（remote-timeline.ts）

### 1) 项目生命周期（LifecycleStage）

- `type LifecycleStage = 'pre_review' | 'due_diligence' | 'signing' | 'post_rental' | 'settled'`
- `LIFECYCLE_ORDER`：四段推进序列 `pre_review(预审) → due_diligence(尽调) → signing(签约) → post_rental(租后)`；`settled(结清)` 不在序列内——完整终点，可从任一阶段达成。
- `projectLifecycle(stage: string): ProjectLifecycleResult`
  - ok 分支：`{ ok:true, stage, label, sequenceIndex(0..3 | settled→null), isTerminal(settled→true), progressPercent, progressNote }`
  - 进度映射（仅演示）：pre_review=15 / due_diligence=45 / signing=60 / **post_rental=75（起租≈75）** / **settled=100**。
  - `progressNote = LIFECYCLE_PROGRESS_DISCLAIMER`："进度百分比为阶段标记，非时间/工作量比例，不构成审批依据（合成演示）。"——必须随行展示。
  - 未知 stage → `{ ok:false, reason }`（失败关闭，不猜测、不回退默认阶段）。
- `lifecycleStageLabel(stage)`：中文标签；未知 → `'未知阶段'`。

### 2) 四域协作步骤（CollaborationStep）——与生命周期语义不同

- `type CollaborationStep = 'received' | 'processing' | 'collaborating' | 'verified'`（接收/处理/协同/核验）
- 与 `LifecycleStage` 是两个独立 string union，**类型层禁止混用**；键集零交集（测试钉住）。
- `domainCollaborationSteps(): readonly CollaborationStepInfo[]`：每域四步点阵，每项带 `note`（显式声明"与项目生命周期语义不同"）。
- `collaborationStepLabel(step)`：中文标签；未知/生命周期值 → `'未知协作步骤'`。

### 3) 事件时间线（只追加，不改写）

- `appendTimelineEvent(state: { events: TimelineEventRecord[] }, input: TimelineEventInput): TimelineEventRecord`
- 记录字段顺序即展示语义：**24 小时制 ISO 时间在先（`at`，UTC）→ 人员（actor）→ level → 事件 → 前后变化（before/after，可空 null）→ 影响（impact，可空 null）**。
- `atDisplay`：`YYYY-MM-DD HH:mm`（24 小时制，由 at 派生，演示展示用）。
- **level 语义**：申报值原样保留；省略/null/空串 → `'unknown'`；非字符串 → 抛错（失败关闭）。**绝不从人员身份/文本推断权限或职级**。
- 只追加：本模块无任何更新/删除既有事件的函数；字段非法抛错不产生部分写入。
- `formatTimelineEvent(record)`：纯文本展示行，时间在先 → 人员 → level=… → 事件 →（前 → 后）→（影响）。

### 4) 前序依赖（示例规则，最小演示集）

- `predecessorAllows(professionalStep, lifecycleStage): { allowed, reason }`
- `ProfessionalGateStep = 'model_preprocessing' | 'formal_verification'`
- 规则：信审"模型预处理"不依赖政策域结论——政策未结束（pre_review）也可进行（authority=none，仅供参考）；
  信审"正式核验完成"依赖政策域前序——pre_review 时**拒绝**（核验越前序被拒），due_diligence 及以后视为前序已具备；settled 允许但标注"完整终点，仅留痕"。
- 失败关闭：未知步骤/未知阶段一律 `allowed:false`。

### 5) 重大新旧冲突路由

- `routeConflict(oldValue, newValue): ConflictRouteResult`
- 新旧值同时在场且不一致 → `{ conflict:true, route:'domain_professional', resolved:false }`——交回相关专业域人工裁定，**系统不认定新内容天然正确**，原意见/分歧/新结论并存留痕。
- 一致 → `{ conflict:false, route:'none', resolved:true }`；一方缺失（空/null/非字符串）→ 不算分歧、不路由、不补齐。

## remote-service.ts 接线（追加面）

- re-export 全部上述值与类型（`LifecycleStage`/`CollaborationStep`/`TimelineEventRecord` 等）。
- `appendRemoteTimelineEvent(events, input): { event }`：服务端约束入口——V5PreviewServiceError `INVALID_INPUT` 语义的严格校验（sessionId≤64 / actor≤80 / kind≤40 / event≤500 / level≤40 可省略 / before·after·impact 必须 string|null|省略），内部委托纯逻辑 `appendTimelineEvent`，只追加、不落盘（events 由调用方持有；**不改 store schema**）。

## 测试计数

- 新套件 `test/v5-preview-remote-timeline.test.mjs`：**9 tests / 9 pass / 0 fail**（T0 env 隔离；T1-T2 生命周期+未知 stage；T3 协作步骤区分；T4 追加+不改写；T5 level unknown/失败关闭/展示行；T6 前序依赖含核验越序被拒；T7 冲突路由；T8 service 接线+INVALID_INPUT）。
- 回归 `test/v5-preview-remote.test.mjs` + `test/v5-preview-remote-repair.test.mjs`：**19 tests / 19 pass / 0 fail**。
- `npm.cmd run typecheck`：**全绿，0 错误**（我的文件无新错误）。
- 额外：`test/v5-preview-remote-compat.test.mjs`（另一并行 lane 于本轮创建）9/9 pass，与本接线兼容。

## 环境观察（非本轮引入，未处理）

- `test/v5-preview-http.test.mjs`（ROWS 域，不 import 任何 remote 模块）当前 13/13 fail：其 before 钩子报"端口 3399 仍 LISTENING=[PID 27168]"。该 PID 是遗留 `next start --port 3399`（parent 1524），非本轮进程；套件自身规则是不抢占未知服务，故未清理。与本轮三个文件无依赖关系。
- 并行 lane 提示：本轮执行期间出现新文件 `test/v5-preview-remote-compat.test.mjs`（03:56:24），说明同仓有其他 SA 在工作；本轮严格未触碰其文件。

## 边界遵守

- 未改 `remote-store.ts` / `remote-types.ts` / 页面 / API 路由 / 既有函数行为；store schema 不变（时间线不落盘，由调用方持有）。
- 未 commit / 未 push / 未部署。
