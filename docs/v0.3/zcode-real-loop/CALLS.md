# V0.3 zcode-real-loop · 调用清单（摘要）

完整机器可读清单（requestId/analysisRunId/回执文件/用量/引用校验数）：[evidence/call-ledger-raw.json](evidence/call-ledger-raw.json)。逐次页面动作↔runId 对应见 [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md) §2。

- 出站 11 次：10 succeeded + 1 unknown（#7 RESULT_UNKNOWN_INTERRUPTED，零自动重发）。
- 确定 tokens：入 29,280 / 出 11,441 ≈ 0.55 元（官方 8/28 元每百万估）；#7 费用未知不计零。
- 账本：Back/Edge/.run/zloop/model-cost-ledger.jsonl 共 56 条，累计预占 10.85/196 元（含共享栈既有 4.2 元延续，未清零）。
- 每次调用身份：tenant+customer+assistant+question+完整上下文（证据包）hash+configHash+promptVersion；重放零出站；模型输出恒 authority=none。
