# 03 → 01/02 接口备忘（V0.5 收尾轮）

本文件记录 03 路在本轮对 Edge 面的增量，供 01/02 消费或对齐；破坏性变更会先在 DEFECTS 提出。

## BR-01 · 助手 observe 在模型未配置时返回确定性说明（原 503 → 200）

- **现状（2026-09-30 起，v05 栈）**：`POST /api/jw/v2/actions/customers/:id/assistant/observe`
  在 `--model-config` 未配置时，不再直接 503 `MODEL_NOT_CONFIGURED`，而是经**授权与输入校验后**
  返回 200 确定性说明（Edge 本地组装，零模型出站）：

```jsonc
{
  "ok": true,
  "mode": "deterministic_briefing",
  "authority": "none",
  "sent": false,
  "model": null,
  "answer": "【信审视角 · 案例说明】…（现行登记事实/材料数/下一步只读指引）",
  "source": "server_state_briefing（案例说明，非模型回答）",
  "freeFormAvailable": false,
  "basis": { "facts": 12, "materials": 4, "assistant": "credit", "generatedAt": "…" },
  "note": "自由问答未配置模型：以上为基于服务端现行登记状态的确定性说明（案例说明），非模型回答、非审批意见"
}
```

- **01 的消费建议**：`mode==='deterministic_briefing'` 时在助手气泡渲染 `answer` 并标注来源
  `source`（"案例说明"徽标）；`freeFormAvailable:false` 时自由问答输入可保留但提交后展示该说明，
  不再显示"连接失败"类错误文案。
- **诚实边界不变**：快照不可达/未授权/输入非法仍分别 502/403/400 如实返回；模型已配置时走既有
  真实模型 observe 链（行为零变化）；说明绝不产生审批效力、不伪装模型回答。
- 实现位置：`Back/Edge/src/assistant-briefing.mjs` + `server.mjs handleAssistantObserve`。

## 沿用告知

- arrow-cases 的 A-404 回退（`--arrow-cases-fallback`）仍在：02 的 A 权威实现落地后 03 移除该配置，
  回退自动休眠；01 无需改动（响应形状一致）。
- Start-JW.ps1/.cmd 已落地（默认栈 v05@48431；`-Stack demo03` 可操作 48430 检查栈的复用级操作）。
