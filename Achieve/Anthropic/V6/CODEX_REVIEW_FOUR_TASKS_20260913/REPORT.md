# 四任务独立验收｜2026-09-13
结论：四路均有可复用成果，四路均需定向续修；不接受主任务“F1–F7全关闭/全部完成”。Codex未改产品代码、未启动ZCode或subagent。

## 实际检查
适用根AGENTS.md、site/AGENTS.md（旧V4时序由最新V6约束覆盖）、TOOL_EXECUTION.md与四路任务书。读四路REPORT、A/B/C manifest及关键源码；执行既有测试和新增合成探针；目视检查交付 screenshots/repair-390-mobile.png。未重新进行浏览器/真机E2E、build、typecheck或lint，因此不放行相关Gate。
- 主任务精确六文件聚焦测试83/83通过，单独repair 7/7通过。
- 报告给出的通配命令实际包含HTTP/recovery共8文件98项，受现有3399监听阻塞，exit1，不能记为98项产品逻辑失败。未停止该服务。随后按精确六文件重跑83项通过。
- A 91/91；B 32/32；C 49/49，均为本轮独立执行。
- manifest：B16/16、C64/64匹配；A33项中adversarial-results.json不匹配。原因明确：Codex运行交付测试时测试重新写入时间戳报告，导致冻结证据改变；不指控执行者交付前篡改。不伪造恢复旧时间戳，后续测试必须输出到新批次并重新冻结。
- 新probe.mjs实际复现MAIN/A/B问题，exit0表示坏行为复现，不代表验收通过。
- C新增c-conclusion-probe.json被评分为引用0、critical无、exit0，漏检其结论里的捏造引用。

## 主任务：CHANGES_REQUIRED
1. P1 源码确认runWrite只有一个pending槽，新操作覆盖旧未知请求；成功/失败无条件清槽。未发送question/reply/review仅React状态，刷新无草稿恢复。回复及复核成功回调无草稿revision约束，可能清掉提交中编辑的新文本。真实组件序列需执行者重现及修复，当前未以浏览器复现声明。
2. P1 probe实际复现：createModelProviderAdapter在await期间变paused仍返回ok；同ID改annotationId/paused命中缓存仍ok。它与A交付未完成统一，不能当作A已经集成。
3. P1 旧会话缺generation被remote-store拒读；REPORT以删除合成文件为恢复，与保留历史要求冲突。需非破坏兼容/恢复。
4. P1 手机交付未达用户接受：报告429×928冒称390等效；截图目视见调试/模拟/相机按钮占主位，待办与判断层级弱，状态live和技术字段露出。截图存在但未证明目标视口、软键盘和完整操作。撤回手机PASS，visual_accepted=false。
5. 已有服务测试支持F3/F4/F6局部改善；不能外推整体闭环。新核算以全局remoteVersion过期，相关性与首次展示应补测。

## A：CHANGES_REQUIRED
91项既有用例通过；协议/成本未知保持等有可复用价值。RequestRegistry容量淘汰会删在途请求，probe以容量2复现a/b/c后a变register，破坏在途去重；默认512同策略。需只淘汰可安全终结项或背压。测试写冻结证据必须修正。真实模型质量未测，未集成。

## B：CHANGES_REQUIRED
32项通过；来源未知/原件与缩略图分离有价值。probe实际拍照成功后track仍live直到dispose；既有测试24明确期望连续拍摄，和父契约“拍完后关闭”冲突。默认拍一次关轨；如需连续模式必须用户明确开启并持续提示。真实浏览器缩略图、触控、真机均未验收。主任务另有camera-panel，不等于已接入B。

## C：CHANGES_REQUIRED
49项通过，三案例/变体与EXACT、PROXY、ADVISORY分离可保留。collectRefs只收findings/questions，遗漏conclusions；新增捏造结论引用不触发critical。需全输出引用覆盖、畸形输入失败关闭与独立负控制。脚本仍需按手机主演示、协作观察页解说更新；不能以人工答案成绩声称模型质量。

## 下一轮与边界
验收期间最新用户纠偏：视觉主面为业务与实控人访谈的手机视频页，其他角色可明确标识模拟协作，不要求六人同时操作；业务页功能板块的视觉与交互精度优先。已同步R2主任务及协调入口。当前旧截图不能充当这一新目标的接受证据。
见ZCODE_FOUR_TASKS_ROUND2_20260913.md及四份R2任务。手机为90%–95%开发验证重点；横屏只兼容/解说。所有旧交付保留，续作新批次。真实模型/相机/媒体/生产鉴权/部署均未放行。
