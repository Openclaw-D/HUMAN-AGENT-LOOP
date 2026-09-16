# REPORT｜REMOTE_DD_LONG_RUN（V6 远程尽调研究、实现与验证）

startedAt：2026-09-12 23:31；本报告：2026-09-13 01:40（窗口约 2 小时处收口）。**提前达到本轮 DoD（可实现增量已有可运行、真实标注的闭环证据；旧功能不退化），按任务书"提前达 DoD 即结束，不为凑时长添加功能"收口。**

**执行者自测完成，待独立验收；最终由 Codex 独立复验、用户接受。**

---

## 1｜已交付（全部真实标注，无伪造接入）

| 项 | 说明 | 证据 |
| --- | --- | --- |
| 远程尽调入口 | 四域概览头部"远程尽调入口→"（最小增量，概览功能不退化实测） | browser E2E（remoteEntryHref=/v5-preview/remote-session） |
| 会议视图（一套 Web，双端布局差异） | 子路由 `/v5-preview/remote-session`：项目/会话、九名参会人（见微协调/业务/政策/信审/商务/资产/客户实控人/财务/生产）、实控人现场状态（自报≠已确认，attendanceVerified 单列）、问题/证据区、模型与人工复核状态、返回总览（总览状态与草稿保留） | 截图 p1-meeting-desktop.png、p2-remote-session-mobile.png；E2E 断言 |
| 视频 adapter 契约 | not_configured/connecting/connected/reconnecting/failed/ended 状态机；当前如实"未接入"：不申请设备权限、无媒体流、无 provider 请求；模拟视图为显式开关+显著"模拟会议"标签 | UI 实测"视频状态：未接入"；R1 回归 |
| 会话/证据/标注/复核/核算 API | 11 个 remote-* 路由；requestId 幂等（先于版本门）+ expectedVersion OCC（409+serverVersion）；独立存储 remote-store.json@1（零迁移，rows-store@1 不动） | lib/v5-preview/remote-{types,store,service}.ts；smoke/故障矩阵 |
| 证据—疑问—补充—人复核闭环 | 合成 fixture（显著"合成测试证据"标记 SVG，白名单）→ 归一化圈选标疑（缩放不变）→ 问题绑原图版本 → 追问回复（模型模拟显式标注 authority=none）→ 人工复核（六种动作、绑定目标版本、重拍/取代后旧确认过期） | UI 全流程 + R3–R8 回归 + 故障矩阵 |
| 阈值/核算未配置态 | RuleConfig 四层全部 unconfigured（未知值≠0）；核算默认 not_configured+输入清单；contract_fixture（显式模式）负收益→blocked、正收益→ready_for_review 仍不放行，全程标注"测试输入，非实际核算"；不显示绿色盈利、不用 0 填缺失、不自动降价 | R10 回归 + HTTP smoke + UI |
| 六角色模型业务链路（模拟） | 六逻辑角色职责分开；确定性 stub 生成角色化后续追问（每标注一轮、SIMULATION 标注、authority=none）；真实模型见 READY_FOR_INTEGRATION.md（modelCalls=0） | R5 回归 + UI |
| 故障矩阵 | 重复提交幂等、非法圈选拒绝、非法 kind 拒绝、旧版本写入拒绝不回退、会话归属服务端决定、重启后状态恢复——6/6 | verification/fault-matrix.mjs + evidence 文本 |

## 2｜模拟 / 真实能力分开声明

- **代码与协议**：实际实现并通过回归（75/75 聚焦测试）。
- **模拟（显式标注）**：六角色模型步骤（确定性 stub）、会议模拟视图开关、合成证据 fixture。
- **真实模型**：未调用（modelCalls=0，无凭证）；协议/失败路径草案见 READY_FOR_INTEGRATION.md。
- **真实视频/会议**：未接入（not_configured；未请求设备权限）。
- **核算**：确定性算术观察仅限显式 test_fixture 输入（负收益阻断演示）；未实现任何未确认定价公式。
- **真机**：软键盘 NOT TESTED；视口为 IAB 模拟（映射跨标签不一致，实际值如实记录）。

## 3｜本轮修复的缺陷（测试驱动发现，失败前/修复后证据）

1. `simulateFollowUps` 写状态但无 expectedVersion 门 → 补齐幂等+OCC（R5 红→绿；UI/路由同步）。
2. 空会话态 409 后 remoteVersion 不刷新 → loadState 刷新版本（否则重试持续过期；浏览器实测复现→修复）。
3. rework-2 遗留 lint error（`<a>` 页面导航 ×4、渲染期读 ref ×1）→ Link 化 + attemptPending 状态化。

## 4｜Gate（evidence/ 命令与退出码）

- 全量聚焦测试 **75/75**（FE 22 + v6fix 26 + rework1 12 + rework2 5 + remote 11）`gate-all-tests.txt`
- typecheck **exit 0** `gate-typecheck.txt`；lint **exit 0**（0 error；3 warnings：2 个未使用变量于本轮新文件 + 1 既有 v4life）`gate-lint.txt`
- 隔离 build **exit 0**（构建前停止 3321，未同时构建破坏服务中输出）`gate-build.txt`
- 故障矩阵 **6/6**（phase1 5 + 重启后 phase2 1）`fault-matrix-phase*.txt`
- 浏览器矩阵/截图：`browser-matrix` 类证据见 screenshots 与各 JSON/文本

## 5｜运行方式与恢复

- 预览地址：dev `http://localhost:3321/v5-preview/remote-session`（数据 `evidence/runtime-data/`）；生产 `http://localhost:3399/v5-preview/remote-session`（数据 `evidence/production-data/`，PID 28572，保留运行）。
- 启动：`cd jianwei-v3/site/.v6-runtime && V5_PREVIEW_DATA_DIR=<数据目录> node ../node_modules/next/dist/bin/next dev --port 3321`（后台任务方式；spawn 随脚本退出被回收）。
- 恢复：产品代码用 `evidence/pre-run-snapshot/` 覆盖 + 删除本轮新增文件（remote-*.ts、remote-session 路由/页面、remote 测试）；删除数据目录中 remote-store.json 即清空远程尽调状态（rows-store 不动）。
- 3311 现场（PID 28568）：全程只读未动。

## 6｜剩余阻塞与下一条最有价值任务

- 阻塞（非本轮可解）：真实模型凭证与接入环境（用户提供后按 READY_FOR_INTEGRATION 验证一条真实链路）；视频 provider 选型与凭证；Git baseline（重大改版时需授权）。
- 下一条最有价值任务建议：**真实模型单链路验证**（一个标注 → 真实 followUps → tokens/延迟入 METRICS）——它直接把"模拟协作闭环"升级为"真实协作闭环"，其余模块已就绪等待替换点。
- 明确未做（继承任务书）：三维现场/周期采集/完整媒体/生产鉴权/正式审批。

## 7｜用量

真实产品模型 tokens=0；真实视频流量=0；无新增付费服务；无依赖/lockfile 变更；无 commit/push/tag。
