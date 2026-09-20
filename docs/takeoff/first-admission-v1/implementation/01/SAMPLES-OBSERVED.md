# 实测样例 · confirm-preassessment

来源：临时采集脚本（跑后即删）对真实内核 + 隔离库（jwcc@15444）执行合成客户全链的原始输出，2026-09-20。
注意："重复确认 409" 标签为采集脚本笔误——该次重放同号同载荷，实际正确返回 200 + replayed:true（单效果）；409 冲突场景由 test/preassessment-confirm.test.mjs PA-06/PA-07 机器断言。

```

===== 请求（正面确认） =====
{
  "requestId": "req-confirm-sample-001",
  "tenantId": "t1",
  "assessmentVersion": 3,
  "candidateRevision": 1,
  "outcome": "support",
  "rationale": "经营现金流覆盖、设备权属清晰、无未处理差异"
}

===== 响应 200 =====
{
  "ok": true,
  "confirmationId": "pac-mu8sf0ri-91f113395bf2",
  "scope": "preassessment_only",
  "assessmentId": "ass-mu8sf0pg-7689a87a3307",
  "customerId": "cust-mu8sf0od-0c939f68e21a",
  "tenantId": "t1",
  "outcome": "support",
  "status": "preassessment_confirmed",
  "assessmentVersion": 4,
  "candidateRevision": 1,
  "inputVersion": 0,
  "snapshotHash": "fd4603aa45c03cd9e38ff245e22050a04a5d45e1df3342e173a7452f774d6d4e",
  "ruleVersion": "rules-synth-takeoff-1",
  "conditions": [],
  "rationale": "经营现金流覆盖、设备权属清晰、无未处理差异",
  "confirmedBy": "cindy",
  "confirmedAt": "2026-09-19T19:35:39.669Z"
}

===== 重复确认 409 =====
{
  "ok": true,
  "scope": "preassessment_only",
  "status": "preassessment_confirmed",
  "outcome": "support",
  "tenantId": "t1",
  "rationale": "经营现金流覆盖、设备权属清晰、无未处理差异",
  "conditions": [],
  "customerId": "cust-mu8sf0od-0c939f68e21a",
  "confirmedAt": "2026-09-19T19:35:39.669Z",
  "confirmedBy": "cindy",
  "ruleVersion": "rules-synth-takeoff-1",
  "assessmentId": "ass-mu8sf0pg-7689a87a3307",
  "inputVersion": 0,
  "snapshotHash": "fd4603aa45c03cd9e38ff245e22050a04a5d45e1df3342e173a7452f774d6d4e",
  "confirmationId": "pac-mu8sf0ri-91f113395bf2",
  "assessmentVersion": 4,
  "candidateRevision": 1,
  "replayed": true
}

===== 过期版本 409 =====
{
  "ok": false,
  "error": "VERSION_CONFLICT",
  "message": "评估版本已前移：请求 99，当前 4",
  "serverVersion": 4
}

===== 假身份 403 =====
{
  "ok": false,
  "error": "PRINCIPAL_UNTRUSTED",
  "message": "principal 凭据验证失败"
}

===== GET 读回 =====
{
  "assessmentId": "ass-mu8sf0pg-7689a87a3307",
  "customerId": "cust-mu8sf0od-0c939f68e21a",
  "status": "preassessment_confirmed",
  "stale": false,
  "staleReasons": [],
  "evidenceSnapshot": [
    {
      "sha256": "20cac0b8b2500f65b99d88c31f4ccdf2504fc999cb8929a56bf19c978d28d5f0",
      "factKey": "operating_cash_flow",
      "artifactId": "art-mu8sf0oz-3b649613a84b"
    }
  ],
  "snapshotHash": "fd4603aa45c03cd9e38ff245e22050a04a5d45e1df3342e173a7452f774d6d4e",
  "ruleVersion": "rules-synth-takeoff-1",
  "candidate": {
    "runRefs": [
      "run-synth-001"
    ],
    "currency": "CNY",
    "revision": 1,
    "tendency": "do",
    "warnings": [],
    "authority": "none",
    "basisRefs": [
      "art-mu8sf0oz-3b649613a84b"
    ],
    "priceUnit": "per_annum_rate_bps",
    "rationale": "合成候选",
    "conditions": [
      "设备保险第一受益人变更"
    ],
    "priceBasis": "合成试算口径（测试）",
    "producedBy": "synthesizer-v1",
    "ruleVersion": null,
    "changeReason": null,
    "inputVersion": 0,
    "referencePriceMinor": 750,
    "suggestedTermMonths": 36,
    "supportableAmountMinor": 200000000
  },
  "version": 4,
  "inputVersion": 0,
  "candidateRevision": 1,
  "preassessment": {
    "confirmationId": "pac-mu8sf0ri-91f113395bf2",
    "outcome": "support",
    "scope": "preassessment_only",
    "conditions": [],
    "rationale": "经营现金流覆盖、设备权属清晰、无未处理差异",
    "confirmedBy": "cindy",
    "confirmedAt": "2026-09-19T19:35:39.669Z",
    "assessmentVersion": 3,
    "candidateRevision": 1,
    "inputVersion": 0,
    "snapshotHash": "fd4603aa45c03cd9e38ff245e22050a04a5d45e1df3342e173a7452f774d6d4e",
    "ruleVersion": "rules-synth-takeoff-1",
    "needsReview": false,
    "reviewReason": null,
    "reviewMarkedAt": null
  },
  "createdAt": "2026-09-19T19:35:39.600Z",
  "updatedAt": "2026-09-19T19:35:39.669Z"
}

===== 候选历史 =====
{
  "ok": true,
  "assessmentId": "ass-mu8sf0pg-7689a87a3307",
  "currentRevision": 1,
  "candidates": [
    {
      "revision": 1,
      "tendency": "do",
      "suggestedAmountMinor": 200000000,
      "currency": "CNY",
      "suggestedTermMonths": 36,
      "referencePriceMinor": 750,
      "priceUnit": "per_annum_rate_bps",
      "priceBasis": "合成试算口径（测试）",
      "conditions": [
        "设备保险第一受益人变更"
      ],
      "rationale": "合成候选",
      "producedBy": "synthesizer-v1",
      "warnings": [],
      "basisRefs": [
        "art-mu8sf0oz-3b649613a84b"
      ],
      "runRefs": [
        "run-synth-001"
      ],
      "changeReason": null,
      "ruleVersion": null,
      "inputVersion": 0,
      "producedAt": "2026-09-19T19:35:39.614Z",
      "isCurrent": true
    }
  ]
}
```
