# CONTRACT｜任务A·主集成（NIGHT_SIMPLIFY_20260914/main）

- 冻结人：A。冻结：2026-09-14 01:58（北京时间）。本文件 A 独占；B/C/D 只读，反馈写各自目录或 `main/feedback-inbox.md`。
- 上位约束：`V6/ZCODE_NIGHT_COMMON_20260914.md` 全部条款；`RESTART_HANDOFF_20260914.md`；API_OVERNIGHT_20260913 CONTRACT/RESULT（真实接线成果保留，不以缺密钥阻塞本轮）。

## 1. 产品写面（拟改路径，全部在此列出）

新增（NEW）：

| 文件 | 用途 |
| --- | --- |
| `lib/v5-preview/demo-story-types.ts` | 演示主线最小数据形状类型（§3） |
| `lib/v5-preview/demo-story-data.ts` | 固定演示步骤表（确定性纯数据；C 交付后按 §4 映射集成） |
| `lib/v5-preview/demo-story-service.ts` | 签名推导 / GET 投影 / advance·decide 命令（复用既有 store 读写与幂等表；同步无 await 穿插，与既有 service 同纪律） |
| `app/api/v5-preview/demo/story/route.ts` | `GET /api/v5-preview/demo/story` + `POST /api/v5-preview/demo/story` |
| `app/v5-preview/demo-story-panel.tsx` | 首页演示条组件（进度/推进/人工决定卡/重新开始入口） |

修改（M，窄改）：

| 文件 | 改动 |
| --- | --- |
| `app/v5-preview/page.tsx` | 挂载 story GET/POST 与演示条；重新开始接入既有情景确认流；入口精简（CP1） |
| `app/v5-preview/rows-view.tsx` | 接受可选 `storyStageIndex/storySettled` props，供演示模式下五阶段位置推导（free 模式行为不变） |
| `app/v5-preview/rows-logic.ts` | 新增纯函数 `lifecyclePositionFromStory(stageIndex, settled)`（与 lifecyclePosition 同返回形状；无依赖） |
| `app/v5-preview/se-overview.module.css` | 演示条样式（紧凑单行，不改既有布局结构） |
| `app/v5-preview/remote-session/page.tsx` | CP3 收敛：客户/业务视图切换（标明展示切换·非生产权限隔离）、四域提示、内部交流层级、演示标记 |
| `app/v5-preview/remote-session/se-interview.module.css` | 上述样式 |

明确不动：`lib/v5-preview/service.ts`、`store.ts`、`remote-service.ts`、`remote-store.ts`、`remote-types.ts`、`shared-types.ts`、`remote-request-registry.ts`、全部既有 API 路由、`chat-panel.tsx`/`todo-card.tsx`/`domain-row.tsx`/`camera-panel.tsx`（除非闭环确有缺口，先在本文件追加说明再动）。共享后端仅以上 4 个 NEW 文件，零改既有共享文件——兼容性由此保证。

## 2. 会话与状态约定（唯一约定，任务书依赖#3）

- **固定演示 = 服务端状态**。唯一事实源 = 既有 rows-store 的 overview（演示数据目录 `V5_PREVIEW_DATA_DIR`）。演示不是独立会话、不是本地状态。
- **写入操作**：仅 演示推进（advance）、人工决定（decide）、「重新开始」（复用既有 `POST /api/v5-preview/demo/seed`）。全部为服务端写：requestId 幂等 + expectedVersion 乐观并发（与既有 notes/messages 同构）。进入远程尽调、返回主流程、刷新均为读/导航，不写主线状态。
- **刷新恢复**：刷新后 GET overview + GET story 状态，由内容签名重新推导当前步骤——无客户端可丢的演示进度。
- **远程尽调（remote-store）与主线解耦**：固定演示不创建/重置/删除远程会话；进入远程尽调即既有行为（sessions[0] = M1 演示会话）。DD 页内的人工动作（暂停/纠正/确认）照旧写 remote-store 并在重启演示后保留。「重新开始只影响当前演示」= 只重置主线 overview。
- **真实/既有数据不混用**：模型接线成果（M1 会话、analyze 路由、预算账本）原样保留；演示推进不写 remote-store；签名不匹配时 story 判定脱离演示模式（free），绝不覆写。

## 3. 演示数据最小形状（冻结；向 C 的映射说明）

```ts
interface DemoStoryStep {
  stepId: string;                 // 's00'..（URL/日志安全）
  stageIndex: 0|1|2|3|4;          // 商机/预审/尽调/签约/租后（顶部五阶段位置；LIFECYCLE_STAGES 前再加商机=0）
  stageLabel: string;             // '尽调' 等（演示条展示）
  scenarioLabel: string;          // 写入 overview.scenarioLabel（'固定演示 · 尽调' 等）
  progressLabel: string;          // 写入 overview.overall.progressLabel
  title: string;                  // 演示条一句话（本轮常规动作）
  hint?: string;                  // 次行说明（可省）
  domains: DomainRow[];           // 恰 4 条（政策/信审/商务/资产），完整替换（现有类型）
  todo: TodoItem | null;          // 完整替换（现有类型）
  messages: OverviewMessage[];    // 本步预设消息（追加，fromKind/fromName/marks 沿用现有枚举）
  evidenceRefs?: string[];        // 远程尽调证据版本引用（仅展示文案，不跨 store 写）
  decision?: {                    // 人工决定点：advance 到此步后暂停等人
    prompt: string;               // 决定问题（含依据/风险提示文案）
    options: {                    // 确定性集合 ⊆ {confirm,correct,return}：
      kind: 'confirm' | 'correct' | 'return';   //   首判断点（s09/s15）为 3 类；
      label: string;              // 按钮文案  -- 再判断点（s12=确认/纠正、s17=仅确认）按 C 机制
      nextStepId: string;         // 确定性后继 -- 「退回仅一次」裁剪（对齐 D-06/D-07 提示一致性）
    }[];
  };
  holdForHuman?: boolean;         // 人工动作步：自动推进链应用此步后停止（下一步推进需显式点击）
}
// 步骤表 = DemoStoryStep[]（固定顺序 + decision 分支的确定性跳转）；首步 s00 的内容签名
// 必须等于 approval 种子 overview（createSeedOverview('approval')）——「重新开始」因此= 既有 seed。
// 不建工作流引擎：无通用图执行、无条件表达式；只有固定步骤表 + 每步 ≤3 个确定性后继。
```

- 每步产出 overview 的内容签名必须唯一（服务端按签名定位当前步，见 §5）；**禁止两步仅有消息差异**——每步必须改变 domains/todo/progressLabel 之一。
- `不存在前提的域不提前完成`：步骤表中各域 segments/judgment 只能按其前提步推进（如资产域在起租步前不得 done）。
- 结尾步：`scenario='settled'`、todo=null、四域全绿已结清（复用 settled 种子语义），演示条出现「已结清 · 可重新开始」。

## 4. 对 C 路的集成映射

- C 交付到 `NIGHT_SIMPLIFY_20260914/story/**`；采用对象 = 步骤表数据（§3 形状）+ 决策分支 + 预设消息文案 + 验证器。文件 hash 记录于 INTEGRATION_LOG；采用后在 `demo-story-data.ts` 落地（A 审查复制，C 不直接写产品）。
- 映射规则：C 若用自有字段名，以 §3 为准做一次性映射（stepId→stepId；stage 枚举用 0..4 数字；DomainRow/TodoItem/OverviewMessage 直接用 `shared-types.ts` 现有类型，不新造）；C 的消息 marks 只可用现有 `'演示情景' | '合成判断' | '补充说明' | '项目沟通'`。
- C 未交付前，A 用同形状的过渡版步骤表先行打通（不阻塞）；C 到达后替换数据、保留服务层。

## 5. 新路由契约（窄改共享后端）

- `GET /api/v5-preview/demo/story`
  - 读 rows-store overview（不写），推导 `{ ok, mode: 'story' | 'free', step, stepsTotal, awaitingDecision, started }`；`mode='free'` = 签名无匹配（用户自由使用旧情景，UI 只保留「开始固定演示」诚实入口，不改用户状态）。
- `POST /api/v5-preview/demo/story`，body `{ action: 'advance' | 'decide', requestId, expectedVersion, fromStepId, decision?, note? }`
  - 版本门：`expectedVersion !== overview.version` → 409 `VERSION_CONFLICT`（同构既有语义）。
  - 步骤门：当前签名 ≠ `fromStepId` 对应签名 → 409 `STORY_STEP_CHANGED`（防双击跳步/串线；客户端收到后静默 GET 对齐）。
  - `advance`：当前步无 decision 或已决定 → 应用 `steps[i+1]`；当前步有未决定 decision → 409 `STORY_DECISION_REQUIRED`。
  - `decide`：`decision ∈ confirm|correct|return` 且当前步 decision 存在 → 按 `options[kind].nextStepId / applyStepId` 确定性跳转；`note`（≤2000）作为补充说明消息追加留档（纠正/退回时）。
  - 幂等：requestId 记入既有幂等表（同载荷重放原响应；异载荷 409 `REQUEST_MISMATCH`）。
  - 响应：`{ ok, overview, step: {stepId, stageIndex, awaitingDecision} }`；错误体同构既有 `{ ok:false, error, message }`。
  - 角色纪律：演示推进属演示控制（同 seed 性质，非业务写入）；不引入新 actorRole。

## 6. 对 B 路的接口发布（依赖#4）

- **可参考的现有实现**（B 只读源码）：
  - 远程尽调页：`app/v5-preview/remote-session/page.tsx`（区块顺序：顶部返回/状态章 → 当前关键问题 → 视频连接状态行 → 语音说明 → 证据折叠 → 历史问答折叠 → 演示设置折叠 → 底部 dock → 全屏模拟覆盖层）；类名前缀 `siv*`（`se-interview.module.css`）；图标 `se-icons.tsx` + 页内 `iconBase` 细线规范（24 viewBox/1.8 描边）。
  - 首页：`se-overview.module.css`（`styles.demoDetails/demoSummary/demoMenu` 二级收纳范式、五阶段 `lifecycleRow data-state`、50/50 结构不动）。
- **约束**：不新增依赖；CSS Modules；`"use client"`；首页上下 50/50 与现有布局不动；375×667 与桌面均需成立；视频/语音未接入必须如实显示；模拟画面不得调用摄像头/麦克风（现有 camera-panel 仅显式用户动作触发，演示流程不得触发）；客户视图不得出现内部问答/复核/演示设置内容，且视图切换必须带「展示切换 · 非生产权限隔离」标注。
- **交付方式**：B 交付组件候选（tsx + css 片段 + props 说明 + 自测截图）到 `ui/**`，A 审查后集成；B 的候选不得假设服务端新增字段，客户视图等纯展示切换可完全客户端实现。
- **可测时点**：CP1 收口后（~02:30）A 在 STATUS 标记「DD 页可测」；B 候选按滚动集成，不等整套。

## 7. 对 D 路的窗口（同 STATUS.md「D 路测试窗口」节）

- 3467 只读现已可测；远程写测试沿用 `[D-QA 合成]` 会话约定；story 写测试待 CP2 标记「story 可测」后进行，并在 STATUS 时间线登记窗口；隔离实例配方见 STATUS。

## 8. 变更记录

- 01:58 初版冻结（§1–§7）。
- 08:40 增补（A，续轮）：§3 决定选项由「恰 3 类」改为「确定性集合 ⊆ 三类」（再判断点按 C 机制裁剪）；新增 `holdForHuman`（人工动作步）；advance 语义升级为自动推进链（连续自动步一次应用，人动作/决定步停止；决定路径不自动链）。测试断言同步（9/9 绿）。数据由 C 上游单脚本全量重建（补丁①–⑥见 demo-story-data.ts 头注）。
- 03:05 增补（A，向后兼容）：§3 DemoStoryStep 增加 `nextStepId?: string`（无 decision 步的确定性后继，缺省=数组下一项；分支回跳步必须显式指定——advance 不依赖数组顺序）；`scenario` 字段已使用（终点步 'settled'）。测试基线纠偏：`test/v5-preview.test.mjs` 四处陈旧断言随已接受的 SE_REBUILD 主干更新（交互预览字符串/aria-expanded 变量名/canSubmit form 收拢/页面题 scenarioLabel 消费点）、`se-icons.tsx` 与 `se-overview.module.css` 补入文件清单、palette 扫描范围收回到 preview.module.css；新增 `test/v5-preview-demo-story.test.mjs`（9 项）。api-client 新增冻结端点 `/api/v5-preview/demo/story`。
