/goal

在现有 V0.5 十案例架构内修复独立验收阻断，不重构、不扩展产品范围。

仓库：C:\Users\22673\Desktop\JW。Owner：原 01 Front writer；允许 Front/**（含重建 Front/dist）和你自己的 docs/integration/2026-09-30-final/01-front/**。你不是唯一 writer，不覆盖他人修改。禁止改 Back/**、根启动脚本、Codex 验收文件、凭据、分支；禁止 worktree/commit/push/tag。采用原任务模型与预算，禁止启动 Codex 内部 subagent。本卡由用户手动转交，不代表自动派工。

输入：同目录 REVIEW_RESULT.md、原 00_SCOPE、02-back/CONTRACT_DELTA.md 与 Back/A/src/domain/case-directory.ts、cycles.ts 的只读接口定义。仅 PC 响应式；主目标 1920×1080，再验 1366×768，手机不考虑。

必修：
1. 消费 A 实际 category、checkpoint.label/detail/evidence、nextActions 数组和授权轨迹；目录与平台/材料/决策/流程/助手一致，不能把协调身份的真实历史误显示为未开始。中文身份选择可显式选择已有协调身份；不能自动冒用该身份或扩大权限。
2. 采用周期实际字段 externalReceipt、reorderOfCycleId，回执存在时显示摘要和结清入口，缺回执仍被后端阻断。返单先引导独立新五区依据流程，完成后开启新周期，旧周期可回看；若现有接口不能完成正向链，提交具体接口缺口，不能把 409 当返单完成。
3. 核验依据实际写入 content.note/原件引用等已支持字段，并回读验证。重试保持原 requestId 和原载荷，不允许同 ID 修改事实造成不明确结果。
4. 用独立测试批次复现 DEF-03-09；plan→POST 守卫每个阻断都给用户明确反馈，断线重试恢复原请求。不能在 plan.requiresHumanConfirmation 时自动绕过人工门。
5. 仅验证 PC 四页、材料补件/核验/周期弹窗/右助手：内容可读，按钮可达，窗口变窄时可合理滚动，无裁切。记录实际 CSS 视口与缩放，不把截图尺寸当 CSS 视口；不新增手机工作。

交付：更新 DELIVERY、修复列表、真实接口 fixture 测试（覆盖对象/数组/camelCase 字段）、typecheck/build、PC 截图与实际尺寸、关键页面动作及请求/响应去敏证据、新 dist 指纹。先冻结并停止写入再交 03 集成；03 API 脚本不能代替页面正向验证。未完成项明确 FAIL/NOT_RUN。

验收：ACC-01~04 及 DEF-03-09 有复验结论；十案例进入即显示真实检查点/历史/下一动作；case-09 从页面回执→结清→关闭，case-10 从页面完成独立返单正向链；所有正式决定仍由有权人确认。不得为通过修改规则或测试预期。
