# STATUS — C 路远程尽调现场界面（REPAIR_20260914_EVENING/remote）

- 更新：2026-09-14 晚（首次完整交付）
- 写面：仅本目录 `remote/**`；产品源 site 与预览 3467 只读未动；未操作 3311/3321/3399。
- 当前阶段：**候选完成、自测通过、待 A 采纳集成**。A 集成后 C 复验实际布局与动作结果（本轮 R1/R2 窗口内）。

## 交付物

- `candidate/RemoteInterviewStagePage.tsx` + `remote-interview.types.ts` + `remote-interview.module.css` + `session-adapter.ts`（hash 见 candidate/README.md）
- `candidate/harness/`（render.mjs / serve.mjs / src/；14 态静态 + 可交互页）
- `evidence/`（断言 JSON ×6 + 截图 ×13）

## 接口状态

A 的 INTERFACE.md 尚未产出；本候选按 COMMON「沿用已有字段优先」对准**现网 SessionDetail 形状**
（`remote-session/page.tsx:99-112`）+ `/api/v5-preview/project` 四域总览 + `model-status`，全部经适配器映射。
A 冻结接口后如有字段更名，只改 adapter 一层；组件 props 已在 types 冻结（见 README 表格）。

## 验证一览

- strict 类型检查 0 错误；14 态 @375 无横向溢出；390/1920 同过；
- 独立缩放 80/100/125% 无横向滚动（scrollX=0 实测）；
- 交互断言全过：工具单开、F1 折叠/展开/提交载荷、F2 标题静态+主问题唯一、客户视图泄漏 7 项检查、
  视图往返、放大进/出、语音说明、暂停回调、拍照/选图直达、错误恢复、空态创建。

## 剩余

- A 集成后的实页复验（布局 + 动作结果）由 C 在 R1/R2 内完成；CameraPanel 原位复用届时核验。
