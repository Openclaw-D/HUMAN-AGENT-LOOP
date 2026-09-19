# 任务02 · NEXT_ACTION

更新：2026-09-20 复核收口轮。本路服务端处理链已闭合且全量回归绿；剩余为跨路串行项与用户验收。

## 等待对方（接口请求见本目录 INTERFACE_REQUESTS.md 与 docs/codex-handoff/board-round-02/task-02/）

1. **04（IR-02-4A，高，阻塞装配）**：delivery-up 为 `a.credentials` 补 `uploadFallback`（及可选
   upload 映射）——否则装配栈每次上传停在 A_UPLOAD_PRINCIPAL_MISSING 等待态（补齐后 sweep 自动重入）。
2. **04（IR-02-4B/4D）**：按新语义复跑页面 journey（blocked_* 原样透出 failure_code/note；
   done≠无 A 登记；通道透传不吞 403 CUSTOMER_MISMATCH）。
3. **03（IR-02-3A）**：确认 parse v2 无旧行为依赖、STRESSED=HOLD_FOR_REVIEW 严重度消费、
   投影/回执错误结构一致。
4. **01（IR-02-1A）**：按业务状态映射消费处理面（不暴露 stage_cursor）。

## 本路待办（等对方确认后）

- 按 03/04 反馈调整投影/错误结构（如有出入）。
- 合流后复跑 `npm test`（Back/Connectors + Back/C + Back/B）确认回归仍绿。

## 用户验收入口建议（方案 R 最小闭环，全程无 SQL 补状态/无预填）

A 建档客户 → 页面上传一份流水/声明 → Connectors 驱动自动处理 → A 出现材料/派生件/运行/Gate
回执 → 页面呈现"已登记待复核"；再演示：重复上传（无第二份业务效果）、缺映射等待态（受控登记
后自动续跑）、扫描件人工转录与获准复核。

## 边界重申

未 commit/push/部署、未动 Front/Back/A/Back/Edge/Back/D/根文档/CONTRACT、未动 15442 与未知
进程、未调真实 GLM/收费提供方、真实渠道外发保持关闭；GLM 接入代码原样保留。
