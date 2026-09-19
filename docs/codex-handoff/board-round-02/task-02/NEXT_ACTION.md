# 任务02 · 下一步（board-round-02）

日期：2026-09-19。本路服务端处理链已闭合并全绿；剩余工作均为跨路串行项。

## 依赖他人（已发接口请求，见本目录 INTERFACE_REQUESTS.md）

1. **04（IR-02-4A，高，阻塞装配）**：delivery-up 为 `a.credentials` 补 `uploadFallback`
   （及可选 upload 映射）——否则装配栈每次上传都会停在 A_UPLOAD_PRINCIPAL_MISSING 等待态。
2. **04（IR-02-4B）**：按新语义复跑页面 journey（blocked_* 透出、done≠无 A 登记）；
   通道透传不吞 403 CUSTOMER_MISMATCH（IR-02-4D）。
3. **03（IR-02-3A）**：确认 parse v2 无旧行为依赖、HOLD 严重度消费、投影/回执错误结构一致性。
4. **01（IR-02-1A）**：按业务状态映射消费处理面，不暴露内部阶段。

## 本路待办（等对方确认后）

- 按 03/04 反馈调整投影/错误结构（如有出入）。
- 复跑 `npm test`（Connectors + Back/C）确认合流后回归仍全绿。

## 用户验收入口建议

方案 R 最小闭环演示（可与喀什案例参数结合，仅作案例不构成政策批准）：
A 建档客户 → 页面上传一份流水/声明 → Connectors 驱动自动处理 → A 出现材料/派生件/运行/Gate
回执 → 页面呈现"已登记待复核"；再演示重复上传（无第二份业务效果）与缺映射等待态（受控登记后
自动续跑）。全程无需任何 SQL 补状态或预填。

## 边界重申

未 commit/push、未动 Front/A/Edge、未触碰 15442/未知数据库、未调真实 GLM/客户/付款/部署；
临时调试脚本在 Back/Connectors/test/.tmp/（debug-l5/l5b/l6，可留作复现参考）。
