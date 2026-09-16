# PROTOCOL_NOTES｜点名提醒与人工纠偏候选协议(R2 工作包5/6)

交付物:`src/reminders.mjs`、`src/human-feedback.mjs`、`test/unit/15-protocol.test.mjs`(本文件)。
自测(此环境 node --test 必须显式列文件):

```
cd C:\Users\22673\Desktop\Anthropic\V6\handoff\R2_MODEL_20260913 && node --test test/unit/15-protocol.test.mjs
```

当前结果:15 tests / 15 pass / 0 fail。零新增依赖、零网络、测试不写 `runtime/` 以外路径。

## 0. 候选定位声明(必读)

- 本文与两个实现描述的是**候选协议层**(标识 `candidate-protocol-v0`):纯函数 + 文档,**未接入产品事件流,未获任何授权生效**;最终以人控为准。
- 不变量:模型/协议 `authority=none`。本层唯一动作是 `notify_human`,唯一合法决策者是 `decidedBy='human'`,预案唯一终态是 `status='awaiting_human_decision'`。
- 本层**不产生正式批准、不执行规则替换、不触发任何训练、不自升权限**;一切"允许/满足条件"字样仅表示"可提交人工评审"。
- 输出对象全部深冻结(篡改抛 TypeError),不含时间戳与随机数(同输入两次调用 JSON 相等)。

## 1. 提醒协议 `planReminders` 规则表

调用:`planReminders({ events, authorizedContext, previousPlan? }) → plan`

`events[i] = { kind, key, importance('normal'|'important'), at }`;返回 `plan = { generatedBy:'candidate-protocol-v0', requiresHumanAck:true, items:[{ key, kind, importance, occurrences, firstAt, lastAt, action:'notify_human' }] }`(items 按 key 字典序稳定排序,整体深冻结)。

| 规则 | 内容 | 对应测试 |
| --- | --- | --- |
| R1 仅授权上下文才提醒 | `authorizedContext` 为 `null`/`false` → 空计划(items=[]),即使含重要事件与点名 | R1 |
| R2 普通事件不打断 | 白名单 kind 且 `importance='normal'` → 不进计划;`occurrences` 只计进入计划的事件 | R2、R5 |
| R3 白名单外降级 | kind 不在白名单(`evidence_version_changed`/`session_paused`/`result_unknown`/`result_stale`/`human_mention`/`budget_warning`)一律视为普通事件:即使声明 important 也不进计划——事件源(含模型)不能借未知事件类型自升重要度 | R3 |
| R4 点名例外 | `human_mention` 即使 normal 也进计划(点名是人的主动行为) | R4 |
| R5 重复合并 | 同 key 合并为一条:`occurrences` 计数、重要度取最高、`kind` 取最高重要度中先出现者、`firstAt`/`lastAt` 取最早/最晚 | R5 |
| R6 跨批合并 | `previousPlan` 同 key 且未处理(`acknowledged !== true`)→ 继承首次出现时间、累计 occurrences;已确认不继承;本批未再现的旧条目不自动重发(再提醒策略由调用方持久化决定) | R6 |
| R7 动作白名单 | 条目 `action` 只能是 `notify_human`(导出常量 `ALLOWED_ACTIONS=['notify_human']`);协议层不存在 approve/decision/retry 自动动作 | R7 |
| R8 确定性与冻结 | 无时间戳/随机数,同输入两次调用 JSON 相等;计划深冻结 | C8/R8 |
| R9 失败关闭 | 非法输入(TypeError,中文消息):events 非数组/缺事件字段/importance 非法/at 非法/`authorizedContext` 缺省(undefined)或为其它 falsy 值(''、0)/previousPlan 结构非法。结构校验优先于授权短路;"没说授权"必须显式写 `null`/`false`,不允许含糊 | R9 |

## 2. 纠偏协议 `createCorrectionRecord` / `canPromoteToGlobalRule` / `buildImprovementPlan` 规则表

| 规则 | 内容 | 对应测试 |
| --- | --- | --- |
| C1 模型不自升权限 | `createCorrectionRecord` 的 `decidedBy` 仅允许 `'human'`;传 `'model'`/`'ai'`/缺失/任何其它值 → TypeError(中文消息) | C1 |
| C2 失败关闭 | 缺必填字段(id/scope/targetKind/targetId/reason/sample/impact/decidedBy)、空串、`scope` 非 `local`/`global` → TypeError | C2 |
| C3 记录冻结 | 返回记录深冻结:任意字段及嵌套 sample/counterExample 篡改(严格模式赋值)抛 TypeError;`decidedBy` 恒为 `'human'` | C3 |
| C4 单例不能触发规则替换 | `canPromoteToGlobalRule` 四个 false 条件:`scope!=='global'` 或 `sampleCount<2` 或 `distinctCases<2` 或 `counterExamples` 为空(局部纠偏与全局规则分离) | C4 |
| C5 提升非生效 | `allowed=true` 仅表示"达到提交人工评审的最低条件";规则生效前置条件是存在 `decidedBy='human'` 的人工决策记录并由人签发,本协议不执行自动替换 | C5 |
| C6 预案四要素 | `buildImprovementPlan` 必须齐备 样本(samples)/反例(counterExamples)/影响(impact)/人工决策(humanDecision),任一缺失/为空 → TypeError | C6 |
| C7 无自动执行入口 | `status` 恒为 `'awaiting_human_decision'`:即使 humanDecision 传入"同意"字样也不变;`planId='improvement-plan:'+ruleId` 确定性派生;预案深冻结不可篡改为自动执行 | C6 |
| C8 确定性 | 三个函数同输入两次调用 JSON 相等 | C8 |

## 3. 与 R2 验收指标的对应

| 验收指标 | 协议落点 |
| --- | --- |
| 不因模型输出而自升权限 | R3(白名单外 kind 不得自我升级为重要提醒)+ C1(`decidedBy='model'` 直接 TypeError) |
| 不直接产生正式批准 | R7(action 白名单仅 `notify_human`,无 approve/decision/retry 键)+ C5/C7(`allowed=true` 与"同意"字样都不改变"待人决策"状态) |
| 仅授权上下文才提醒 | R1(+R9:授权必须显式声明,缺省即 TypeError) |
| 重要变化才提醒 / 普通事件不打断 | R2/R3(白名单 + important 才准入;点名按 R4 例外) |
| 重复提示合并 | R5(批内)/ R6(跨批) |
| 局部纠偏与全局规则分离;单例不能触发规则替换 | C4(scope 分离 + 样本≥2 + 不同情形≥2 + 反例非空) |
| 异议保留 | 反例是一等公民:无反例不得提升全局规则(C4);纠偏记录与预案均冻结留档、不可篡改(C3/C6),异议以 `counterExample` 结构保留 |
| 人工可追溯、人控为准 | `requiresHumanAck:true`、`decidedBy:'human'`、`status='awaiting_human_decision'` 恒定,记录/预案确定性可复现 |

## 4. 局限(NOT TESTED / 边界)

- **NOT TESTED:未接产品事件流。** 真实事件的 `importance` 判定需业务层标注,本协议不推断重要度;白名单外 kind 一律降级(可能"漏提醒"重要但未登记 kind 的事件——这是有意的失败关闭方向:宁可不提醒,不可自动升级)。
- `at` 假设同质可比(同为 ISO 字符串或同为毫秒数);混用时仅保证确定性输出,不保证时序语义正确。
- 协议层无任何存储:`previousPlan` 由调用方持久化并回传;"本批未再现"的旧条目是否重发由调用方决定,本层不自动重发。
- `canPromoteToGlobalRule` 的 `allowed=true` 只是必要条件(最低评审门槛);样本代表性、规则正确性、是否真要改规则,全部由人工评审负责。
- 无时间戳是确定性要求的代价:跨批时间信息只能来自事件 `at` 与 `previousPlan` 携带的 `firstAt`。
- 候选未冻结:接口变更(如白名单扩充、acknowledged 语义)须经主线程串行整合,不得由本层自行生效。

## 5. 纠偏预案样例两则(合成尽调场景;四要素:样本/反例/影响/人工决策)

### 样例一:局部纠偏(scope=local)——"实控人现场照片模糊"

场景(合成):远程视频尽调中,实控人在经营现场出示的照片模糊,无法核对门牌与经营状态;信审负责人决定本项目退回补拍。

```js
import { createCorrectionRecord, canPromoteToGlobalRule } from './src/human-feedback.mjs';

const record = createCorrectionRecord({
  id: 'CR-2026-0913-001',
  scope: 'local',                      // 局部纠偏:只针对本项目该项证据
  targetKind: 'evidence_item',
  targetId: 'EV-014',
  reason: '实控人现场照片模糊,无法核对经营场所门牌与经营状态',
  sample: { projectId: 'proj-demo-1', photoId: 'SYN-P-001', defect: 'blur', capturedVia: 'remote_video' },
  counterExample: { projectId: 'proj-demo-2', photoId: 'SYN-P-002', note: '另一项目同类远程拍摄清晰可核' },
  impact: '仅本项目 EV-014 须现场补拍或重传;不改动任何全局规则',
  decidedBy: 'human',                  // 只能是 'human';传 'model' 直接 TypeError
});
// canPromoteToGlobalRule({ scope:'local', sampleCount:1, distinctCases:1, counterExamples:[] })
// → { allowed:false, reason:'scope 为 "local" 而非 \'global\':局部纠偏不触发全局规则替换…' }
```

四要素对照:

| 要素 | 内容 |
| --- | --- |
| 样本 | proj-demo-1 照片 SYN-P-001,缺陷 blur,远程视频通道拍摄 |
| 反例 | proj-demo-2 同类远程拍摄清晰可核 → 说明并非"远程通道普遍失效",只是单点问题 |
| 影响 | 仅本项目 EV-014 退回补拍;不改动任何全局规则、不调整其他项目期限或价格 |
| 人工决策 | 信审负责人(人)决定退回补拍,记录 `decidedBy:'human'`;单例不允许提升为全局规则(C4) |

### 样例二:全局规则提升候选(scope=global)——"同一问题跨项目复现"

场景(合成,延续样例一):后续项目中同类"远程照片核验不可靠"在不同情形复现,且保留反例。

```js
import { canPromoteToGlobalRule, buildImprovementPlan } from './src/human-feedback.mjs';

const check = canPromoteToGlobalRule({
  scope: 'global',
  sampleCount: 5,      // ≥2:不是单例
  distinctCases: 3,    // ≥2:逆光 / 翻拍屏幕 / 拒绝实时拍摄,不同情形
  counterExamples: [{ projectId: 'proj-demo-7', note: '现场实时视频核验清晰,规则不适用于该情形' }],
});
// → { allowed:true, reason:'满足提交评审的最低条件…;规则生效另需 decidedBy=human 的人工决策记录…' }

const plan = buildImprovementPlan({
  ruleId: 'rule-remote-photo-verify',
  samples: [
    '样本1:proj-demo-1 实控人现场照片模糊(逆光)',
    '样本2:proj-demo-4 门牌照片为翻拍屏幕',
    '样本3:proj-demo-6 实控人拒绝实时拍摄,仅提供存照',
  ],
  counterExamples: ['反例1:proj-demo-7 现场实时视频核验清晰'],
  impact: '远程照片核验证据采信标准需全局评估;修订前按现状执行,不自动放宽或收紧',
  humanDecision: '由信审负责人召集评审;未经人工签发不得生效',
});
// plan.status === 'awaiting_human_decision'(恒定;本层没有自动训练/自动替换入口)
```

四要素对照:

| 要素 | 内容 |
| --- | --- |
| 样本 | 5 个样本、3 种不同情形(逆光/翻拍屏幕/拒绝实时拍摄),达到 C4 最低门槛 |
| 反例 | proj-demo-7 现场实时视频核验清晰 → 划定规则边界:不覆盖现场实时核验情形 |
| 影响 | 全局证据采信标准修订前按现状执行;不因样本数量自动放宽额度/期限/价格 |
| 人工决策 | 信审负责人评审并签发;`allowed=true` 只是"可提交评审",`status` 恒为 `awaiting_human_decision`,本层不执行替换 |

## 6. 已记录的实现取舍(候选,可由主线程调整)

- "其余一律视为普通事件"实现为:白名单外 kind 即使声明 `important` 也不进计划(见 R3,方向为失败关闭)。
- `planReminders` 条目在任务书形状外追加 `importance` 字段,使"重要度取最高"可直接断言。
- 跨批合并时,上批条目缺 `occurrences` 按 1 计;`acknowledged:true` 视为已人工处理,不再累计。
- `authorizedContext` 缺省(undefined)与其它 falsy 值(''、0)按非法输入 TypeError 处理:授权必须显式声明。
- `reason`/`impact`/`humanDecision` 约定中文书写,代码不校验字符集(便于夹带协议标识,避免误伤混合文本)。
