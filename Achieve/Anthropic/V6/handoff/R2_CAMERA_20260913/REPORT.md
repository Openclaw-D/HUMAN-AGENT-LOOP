# REPORT｜R2-B 手机采集生命周期与可视验证

日期：2026-09-13（北京时间04:30+08:00收束）。执行：ZCode主agent + 原生Subagent SA1/SA2/SA3(重试)/SA5/SA6（并发与限流记录见AGENT_LEDGER）。写面：仅 `V6/handoff/R2_CAMERA_20260913/**`；旧批次与产品代码只读。

## 1. 结论（TL;DR）

验收报告B节缺陷已修复并加固：控制器 `0.2.0-r2-candidate` **默认单次拍照（成功与失败均立即关轨）**，取消/离开/dispose/超时/迟到/外部ended/同步throw全路径资源清理；自动化测试 **96/96 全绿**（五文件合跑，`evidence/full-regression.log`，exit 0）；真实浏览器完成 402×874 基准下 11 张截图与哈希级核对（**原件SHA-256页面内外完全一致**，真实canvas缩略图独立），全部用合成PNG与虚拟mediaDevices，未开启物理相机/麦克风、零上传。真机与真实DPR3/窄屏布局如实记NOT TESTED。

## 2. Goal工作包完成对照（ZCODE_GOAL_B_TO_0700_20260913.md）

| 工作包 | 结果 | 证据 |
| --- | --- | --- |
| 1 单拍关轨/取消/离开/dispose/迟到/外部ended/同步throw/永不返回超时 | 完成 | SA1控制器+41测试（state-machine-run.log）；SA3对抗26测试（adversarial-run.log）；SA2资源21测试（resource-tracking-run.log） |
| 2 原图/缩略图/元数据分离+同图多次/损坏/空/大图/objectURL错误 | 完成 | SA6 metadata-integrity 6用例；浏览器实测（browser-step02-hash-check.json） |
| 3 嵌入展开收起保持状态+离开关轨+本机语义 | 完成 | 壳details化+本机语义文案；browser-step03-collapse-state.json（preserved:true） |
| 4 402×874壳+取消/焦点/错误提示/回退选图+390/360回归 | 完成（390/360真实布局=工具不可仿真，记NOT TESTED） | screenshots/01–08 + INDEX.md |
| 5 浏览器内真实canvas缩略图+默认降级 | 完成 | 02d截图（427×640/169,247字节真实OffscreenCanvas产物）；Node降级路径由注入测试覆盖 |
| 6 压力循环固定seed+累计track/URL统计 | 完成 | SA6 stress-loop：42轮84步、seed=20260913、同seed重跑摘要一致、泄漏0 |
| 7 主任务映射+状态/资源责任 | 完成 | MAPPING.md（含§6增补：预览待保存/嵌入展开/远程非授权） |

## 3. 修复的本轮发现缺陷（真实过程记录）

1. **壳预览区初始可见**（我改details时丢失hidden）：注入前显示破图占位——已修复并重截。
2. **样例服务根路径内联替换导致相对模块404**（深链`/`时`./standalone-main.mjs`解析错误）：改为302重定向+查询透传——旧批次同款隐患未在旧批次暴露，属本轮新发现。
3. **壳错误提示覆盖**：按钮handler的通用文案覆盖onError友好提示——已修复并重截07。
以上均不涉控制器；控制器零改动（SA1交付后未再变，mtime与SA2/SA3/SA6复核一致）。

## 4. 浏览器证据要点（真实渲染，非模拟）

- **原件字节100%保持**：页面内 `crypto.subtle` 计算的SHA-256 = Node侧基线 `9a78b6c7…9617`，byteLength=2,882,143（browser-step02-hash-check.json）。
- **独立缩略图**：真实OffscreenCanvas生成427×640、169,247字节，与原件URL独立。
- **取消路径**：requesting态“关闭摄像头”可点→idle+明确提示+占用归零（04a/04b）。
- **拒绝不循环**：denied态gUM调用数恒为1，选择文件仍可用（05）。
- **未配置不阻选图**：unsupported态中文提示+回退指引，选图按钮可用（07）。
- 工具限制如实声明：IAB三种输入通道在视口仿真下不可靠，交互以页面内DOM click触发同一真实监听器；键盘Tab实击、DPR3物理像素、真实390/360布局=NOT TESTED（INDEX.md“工具限制”节）。

## 5. 验证命令与退出码

```
node --test test/camera-controller.test.mjs test/resource-tracking.test.mjs test/adversarial.test.mjs test/stress-loop.test.mjs test/metadata-integrity.test.mjs
# 96 tests, 96 pass, 0 fail, exit_code=0 （evidence/full-regression.log）
node --check <全部10个mjs>  # 全过
node tools/serve-standalone.mjs  # 127.0.0.1动态端口,自有进程,已关闭,无残留
```

## 6. NOT TESTED（不冒称）

真机iOS Safari/Android Chrome全路径；真实相机/麦克风硬件路径；DPR3物理像素渲染；软键盘推起与安全区实际可视高度；真实390×844/360×800布局回归；键盘Tab实击走查（自动化不可注入）；HTTPS真机部署。以上已逐项记入CAMERA_READINESS式矩阵与截图INDEX。

## 7. 资源与清理

无残留进程/监听（服务已kill并核实）；无文件写入本目录之外；无新依赖、无Git写操作、无Codex操作；真实模型调用0、产品API付费调用0。恢复说明：全部产物为本目录静态文件，复跑见§5命令；浏览器证据复现步骤见screenshots/INDEX.md。

## 8. 移交主任务

按 `MAPPING.md` 口径接入：回调四件套+pagehide dispose+single模式“再拍=重新开启”+错误文案表；接入后以 `getResourceUsage()` 与注入注册表双路复核零泄漏。本批自STATUS置READY_FOR_REVIEW起冻结；候选待Codex复验与用户视觉接受（visual_accepted保持false，不自评通过）。
