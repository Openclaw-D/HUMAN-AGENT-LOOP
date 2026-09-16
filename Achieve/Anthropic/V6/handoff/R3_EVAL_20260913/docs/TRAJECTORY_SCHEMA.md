# TRAJECTORY_SCHEMA｜产品运行轨迹 product-trajectory@1（冻结）

R3 C 评估器的输入契约。字段名直接取自产品真实模型（`jianwei-v3/site/lib/v5-preview/remote-types.ts`、`remote-timeline.ts`），MAIN 导出运行轨迹后即可被 `tools/replay-cli.mjs` 回放。**golden 不进入任何被评对象**；来源标记强制。

## 顶层结构

```jsonc
{
  "schema": "product-trajectory@1",
  "meta": {
    "trajectoryId": "非空字符串（MAIN导出建议 trj-<sessionId>-<序号>）",
    "source": "product_export | handwritten",   // 强制；handwritten 单列目录，不冒称应用已执行
    "exportedAt": "ISO（handwritten 为撰写时间）",
    "exportTool": "字符串（如 site-remote-store-export v1；handwritten 写 author）",
    "note": "可空"
  },
  "session": { /* RemoteSessionRecord 原样：sessionId, projectId, title, status(scheduled|live|paused|ended),
                 generation, participants:[RemoteParticipant], video:RemoteVideoState, createdAt, updatedAt */ },
  "evidence":   [ /* EvidenceRecord[]（含 version/supersededBy/supersedes） */ ],
  "annotations":[ /* AnnotationRecord[]（status open|resolved；replies: model_simulation|business|domain） */ ],
  "reviews":    [ /* ReviewRecord[]（action: confirm|correct|request_resupply|request_retake|pause_round|escalate_human|resume_round；opinion/reviewer） */ ],
  "calculations":[ /* CalculationRecord[]（status/basedOn{remoteVersion,ruleConfigStatus,generation}） */ ],
  "timeline":   [ /* TimelineEventRecord[]（只追加语义：eventId/at/actor/kind/level/event/before/after/impact） */ ],
  "todos":      [ /* TodoState[]：评估专用投影（见下） */ ],
  "ruleConfig": { /* RuleConfigRecord（version/status/layers） */ }
}
```

## TodoState（评估专用投影，MAIN 导出时从产品待办态拼出）

```jsonc
{
  "todoId": "非空",
  "title": "非空",
  "sessionId": "归属会话",
  "status": "open | resolved | deferred",      // deferred=挂断/暂停后明确延后（不消失）
  "linkedOpinionIds": ["AnnotationReply.replyId 或 ReviewRecord.reviewId"],  // 意见可追溯锚点
  "updatedAt": "ISO"
}
```

## 事件 vocabulary（replay 只解释以下 kinds；其他 kind 原样保留不解释）

| kind | 语义字段 | 用于规则 |
| --- | --- | --- |
| `lifecycle_advanced` | before/after = LifecycleStage（pre_review/due_diligence/signing/post_rental/settled） | R-LIFE 前序 |
| `formal_gate` | event 含专业步骤（model_preprocessing/formal_verification）；after = allowed(true/false) | R-PRE 前序越权 |
| `formal_step_completed` | event=步骤名；必须有人工 confirm 支撑 | R-PRE |
| `human_confirmation` | after=目标（evidence/annotation id@version）；actor=人 | R-HUMAN |
| `opinion_recorded` | after=opinionId；event=意见摘要；level=申报 | R-OPIN 意见丢失 |
| `conflict_routed` | before=旧值/after=新值；impact=route（domain_professional/none） | R-OPIN |
| `participant_left` | actor=participantId；event 含挂断/离会原因 | R-HANG 挂断 |
| `todo_state_changed` | before/after=todo状态；event=todoId | R-HANG |
| `result_applied` | after=generation（生效代次）；event=结果标识 | R-LATE 迟到 |
| `rule_updated` | after=规则版本；必须有人工授权支撑 | R-RULE 单例→升级 |
| `draft_corrected` | before/after=字段值；event=字段名（金额/否定词/单位） | R-CORRECT（结构性检查） |

## 校验与失败关闭

- 未知 `schema` 值、缺失 meta.source、session.sessionId 为空 → exit 2。
- 字段类型与产品模型一致（generation 正整数、version 正整数、ISO 时间可解析）；解析失败 exit 2 列出位置。
- 未知 kind 允许（记录 `uninterpretedKinds` 计数），但未知顶层/记录字段 → exit 2（防走私，沿用 R2 教训）。
- `meta.source=handwritten` 的轨迹只能进 `trajectories/handwritten/`（目录与标记双校验）；`product_export` 必须来自 MAIN 导出路径并记录输入 sha256。

## 隐私与边界

全部合成/演示数据；不携带真实客户材料。轨迹导出不包含凭据/密钥。
