# ADOPTION｜B/C 候选采用与 R-01~R-08 映射（A · 首次交付）

## 一、采用结论

- **B（首页）**：采用。`home/site-mirror/app/v5-preview/` 10 组件文件原样拷入 + 3 处兼容集成修改（见 §三）。B 未交 RESULT/README/差异清单文档，本表按其代码与截图（home/evidence/01–10）逐项核对代记。
- **C（远程尽调）**：采用。组件 4 文件**逐字节采用**（hash 与 remote/RESULT.md §2 冻结值一致），按其 README §二方式1 集成；`remote-session/page.tsx` 重写为数据接线层，回调逐项对接。
- 采用 hash：`main/final-hashes.sha256`；集成逐文件理由：`main/INTEGRATION_LOG.md`。

## 二、R-01~R-08 逐项映射

| # | 要求 | 承载 | 自检证据 |
| --- | --- | --- | --- |
| R-01 | 首页无硬半屏/无合成控制大条/中文菜单/重开 | B HomeOverview/HomeHeader（无 calc 硬半屏、非 50/50；客户行收进「项目详情」菜单；合成演示 chip + 右上重开图标；情景切换下拉随批注移除） | 截图 `main/evidence/integrated-home-b-1280.png`；A 兼容修改：确认文案=重开精确作用域（demo/reset），回调接 `postDemoReset` |
| R-02 | 五阶段颜色与格子语义 | B LifecycleStrip（按实际状态着色，游标驱动）+ DomainGrid（近方形格、完成绿✓/进行蓝🔧/未开始白?、文字可关+可访问名称） | 同上截图（尽调高亮、四格图标语义可见）；`home/evidence/10-mobile-390-domain-expand.png` |
| R-03 | 消息精简且来源准确 | B HomeChat（1–2 句折叠+原文展开；来源按保守规则推导：business→人工、system/domain→预设，不冒充模型） | 截图同上（消息带「人工/预设/共享尽调」标注+原文展开钮）；诚实备注：A 未填 `messageExtras.origin`（服务端 marks+fromKind 已够保守推导），摘要字段未启用 |
| R-04 | 尽调现场主体+紧凑工具 | C StagePage（画面主体+诚实徽章、右侧工具单开：四域/证据/参会；下部进度/当前操作/聊天；F1 字段默认收起；主问题唯一主呈现） | 截图 `main/evidence/integrated-dd-c-1280.png`（进度行含「旧版证据 1 条已更新」）；C 自测 evidence/JSON+截图 |
| R-05 | 实际证据纠正→首页同步 | A 后端共享事实层 + 演示纠正写真复核 | 隔离实例全链 HTTP **32/32**（`main/evidence/full_chain_3481_output.txt` §3/§4：人工 correct→资产域「证据纠正待复核」+共享尽调消息；s09 correct→rev-demo-s09correct 落库）；首页事实条截图 `integrated-home-b-1280.png` |
| R-06 | 旧意见失效/部分依赖/人工门 | 投影：contested→域标记+待复核清单；confirm 闭合后标记消失、旧记录保留；**投影永不把判断灯改绿**；story 退回仅一次/终点仅经确认不变 | HTTP §3（status contested→confirm→human_verified、pendingReview 清空、标记消失）；测试断言（投影不升绿）；演示纠正意见留档 reviewer=业务（演示身份） |
| R-07 | 重复/刷新/返回/重置隔离/中断恢复 | 幂等表×2 + 稳定游标 + demo/reset 仅清专属会话 + 投影可重算重建 | HTTP §5（连续 GET 同步）/§6（同 requestId 重放、异载荷 409、重复 attach 只落一条）/§7（重开：专属会话清除、其他会话与证据保留、游标回 s00、消息不复活、懒建重建）/§8（旧版本 409）；恢复测试=套件「中断恢复」（rows 写丢失→同 requestId 自愈+投影重建） |
| R-08 | 两页适配与独立缩放 | B/C 候选各自交付 | A 复测：375 首页截图 `main/evidence/home-shared-facts-375.png`（无横向溢出）；独立缩放 80/100/125 **未独立复测**，以 B `home/evidence/08/09`、C `remote/evidence/zoom-390.json` 为准（如实记录）；用户当前预览设备/zoom 未改 |

## 三、兼容集成修改（不放弃页面要求，逐项报告）

B：① story-strip/home-contract/home-overview 增 `shared` prop（共享尽调事实条+降级提示，接口为 A 冻结新增）；② home-header 重开确认文案改为 demo/reset 精确作用域（原文写"远程尽调会话数据不受影响"，与新重开语义不符）；③ home-header 内联 `import()` 类型改顶层 import type（过隔离契约）。B 确认流改为"确认后调 A 的 postDemoReset"，不再走 seed。

C：组件零修改；page 层把演示设置区经 techNote/modelStatusLine/calculations/onAttemptCalculation 注入；受控 drafts 接管草稿持久；D-01/D-02/D-04 修复语义保留。C 回调 `onAttachEvidence` 类型仅含 2 个 fixture——与现网按钮集合一致，未扩展。

## 四、未采用/移除（含理由）

- 情景切换下拉与确认流（UI 移除，用户批注"移除合成控制"；`/demo/seed` API 与 seedScenario 服务保留，测试断言同步更新）。
- B 桥文件 3 个（api-client/rows-logic/se-icons 的 site-mirror re-export shim）不拷入 site（其自注"采用时不得拷入"）。
- 旧渲染组件（rows-view/todo-card/chat-panel/domain-row/demo-story-panel）保留文件但 page 不再引用（契约测试字符串引用+可回退）。
- C 内部未用 props（live/cameraSlot/onSelectEvidence 解构未用→1 条 lint warning）：属 C 组件内部，未改动（保持 C hash 不变），留 R1 报 C。
