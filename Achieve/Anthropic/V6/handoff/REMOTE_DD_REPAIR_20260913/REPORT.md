# REPORT｜REMOTE_DD_REPAIR_20260913

日期：2026-09-13。执行：ZCode 主 Agent（单 writer）。任务契约：`V6/ZCODE_REMOTE_DD_REPAIR_20260913.md`；缺陷输入：`V6/CODEX_REVIEW_REMOTE_DD_20260913/REPORT.md`（CHANGES_REQUIRED，F1–F7）。

**状态：F1–F7 已关闭（F5 真机部分 NOT TESTED），B 协议验证与 C 本地相机入口完成。执行者自测完成，待 Codex 独立复验、用户接受。**

---

## 0｜上轮证据缺口更正（F7）

1. 上轮 BASELINE"非 Git 仓库"结论**错误**：活动 `site/` 是 Git 仓库（HEAD 63c41c3，92 dirty 项；v5-preview 写面全部未跟踪）。更正见 `BASELINE.md` + `evidence/pre-snapshot/git-status-site.txt`。
2. 上轮"六角色模型链路"实为固定问句确定性选取，无推理、无 adapter 故障测试。本轮补齐 provider adapter 契约 + 9 项故障路径回归（见 MODEL_READINESS.md）；**真实推理质量仍 NOT TESTED**。
3. "跨用户权限失败关闭"更正：projectId 为冻结演示归属（服务端固定），非真实鉴权；本期保持本机合成单用户演示，不对真实客户开放；写接口无可信身份校验，如实声明。
4. 上轮前端"当前实现保留原请求"提示不属实——本轮已实现真实原样重试（见 F1）。

## 1｜逐项结论（实测/模拟/未测）

| 项 | 结论 | 关键证据 |
| --- | --- | --- |
| F1 不可变请求与草稿归属 | **PASS（组件实测）** | 连续两次 NETWORK 注入后 requestId 恒定（`a3fc897b…`×3）、载荷逐字一致；恰好创建一条标注；刷新后记录存活、跨刷新同 ID（`cddaf5c0…`）重放成功；草稿按 requestId+修订清空；409 与 NETWORK 分开（409 清记录+刷新，NETWORK 保留+可放弃） |
| F2 暂停服务端门 | **PASS** | paused 阻断 simulate（模型）与 confirm/escalate（确认类）→ `SESSION_PAUSED`(409)；resupply/retake/correct 可用；`resume_round` 显式留痕恢复 + generation+1 |
| F3 复核资格撤销/证据失效 | **PASS** | confirm→retake 后 ≠human_verified（历史保留）；re-confirm 规则明确；superseded 证据拒新 confirm（API 层 INVALID_INPUT）；投影 expired；标注显示"所属证据已过期"；新证据不继承确认。**验收探针自身断言翻转**（actual='unverified'，probe-after-repair.txt） |
| F4 核算幂等/失效 | **PASS** | 幂等摘要含 mode+inputs（同 ID 换输入 REQUEST_MISMATCH；同输入重放稳定同一 calcId）；`basedOn` 绑定 remoteVersion/ruleConfig/generation；新资料后现算 stale 并 UI 提示"不得继续作为现行结果" |
| F5 触控/移动可用性 | **PASS（代码+仿真）**；真机 NOT TESTED | Pointer Events 统一（capture/cancel/钳制/touch-action:none）；pointerType='touch' 合成事件圈选实测；数字输入替代标疑；390 等效视口（429×928）首屏=会议状态+视频提示+证据入口（无溢出 412≤429），参会人折叠、角色中文、ID 收进 details；1920 无溢出。**真机触摸/软键盘 NOT TESTED** |
| F6 摘要真实性 | **PASS** | 新证据 sha256 = renderFixtureSvg 实际字节摘要（相同图形稳定）；`digestOf` 语义标注；legacy 缺省记录兼容读取（不覆盖历史、不伪称原件 hash） |
| F7 声明更正 | **PASS** | 见 CHANGE_LIST §F7 与 BASELINE/READY_FOR_INTEGRATION/MODEL_READINESS 更正 |
| B 协议与故障路径 | **PASS（模拟）** | provider adapter 契约 + 本地 fake：超时/畸形/空/部分失败/坏引用/暂停/过期版本/重复幂等 9 项全过；失败零回复不冒充；**真实推理 NOT TESTED**（modelCalls=0） |
| C 本地拍照入口 | **PASS（组件级）** | 能力检测（不申请权限）→ 三入口（capture 提示/图库未知来源/takePhoto 增强）→ 合成 File 本地预览+元数据（533 字节 PNG 实测）→ 清除释放；不上传/不入库/不提交模型；**真机与真实权限弹窗 NOT TESTED** |
| 旧功能不退化 | **PASS** | 全量聚焦 83/83（含 rows 域 64 项 + remote 11 + repair 7）；概览页版本/待办/聊天完好（E2E） |
| 双端视口 | **PASS（仿真）** | 390 等效 429×928：无溢出、状态首屏、证据入口在折叠下可见；1920×1080 精确无溢出；截图 repair-390-mobile.png / repair-1920-desktop.png |

## 2｜运行命令与退出码（evidence/ 落盘）

- 全量聚焦测试：`node --experimental-strip-types --test --experimental-test-isolation=none test/v5-preview*.test.mjs`（6 文件）→ **83/83，exit 0**（gate-all-tests.txt）
- typecheck → exit 0（gate-typecheck.txt）；lint → exit 0（0 error / 7 warnings：本轮 2 个 `_error` 形参 + 1 既有 v4life + 4 个本轮 catch/unused 已尽量清理，余者为 eslint 误报形态，见 gate-lint.txt）
- 隔离 build → exit 0（gate-build.txt）；3399 生产以修复后构建重启（ ownership 核验后）→ remote-session 200
- 故障矩阵（rows 域）此前 6/6 仍有效；remote 域故障路径由 repair 测试 B 项 + HTTP smoke 承担
- 验收探针复跑：exit 1（首个断言翻转 = F3 修复证实；探针钉住旧缺陷行为，见 probe-after-repair.txt）

## 3｜浏览器组件时间线（F1 摘要；合成数据）

1. 附着证据（req A，200）→ 打开 → 注入 NETWORK → 提交标注：requestId=`a3fc897b` 发出（未达），恢复条显示，问题保留。
2. 原样重试（注入 NETWORK）：requestId=`a3fc897b`（同一）再次未达。
3. 放行注入 → 原样重试：requestId=`a3fc897b` 达服务端 → 幂等创建恰 1 条 → 恢复条消失、草稿清空。
4. 刷新后（另一标注 `cddaf5c0` 未达→刷新）→ 恢复条存活 → 原样重试同 ID 成功。

## 4｜未测 / 已知限制

- **真机**：触摸拖拽、软键盘、相机权限弹窗、局域网 HTTP 下 getUserMedia——NOT TESTED。
- **真实模型/视频/核算**：未接入（modelCalls=0；视频 not_configured；核算仅 contract_fixture 测试口径）。
- 遗留 warning：lint 7 warnings（2 个 `_error` 命名形参、1 个既有 v4life、4 个测试/内部 unused 变量）——不阻塞。
- remote-store 升级兼容：无 generation 的遗留 remote-store.json 会 REMOTE_STORE_CORRUPT（恢复=删除该合成文件重建；已在前轮 BASELINE 声明，rows-store 不受影响）。

## 5｜运行方式与恢复

- dev：`http://localhost:3321/v5-preview/remote-session`（数据 `REMOTE_DD_REPAIR_20260913/evidence/runtime-data/`）；生产：`http://localhost:3399/...`（修复后构建，数据 `production-data/`，本机合成演示、未对真实客户开放）。
- 恢复：产品代码用 `evidence/pre-snapshot/` 8 文件覆盖 + 删除本轮新增（camera-panel.tsx、repair 测试）；遗留兼容问题见 BASELINE。3311 现场（PID 28568）全程只读未动。

## 6｜停止

F1–F7 关闭、B/C 完成、Gate 全绿。**执行者自测完成，待独立复验**；不自动开始真实模型接入、视频采购、照片入库（下一独立 Gate）。
