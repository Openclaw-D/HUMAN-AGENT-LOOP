# 截图索引｜R2相机模块真实浏览器证据

环境：ZCode内置浏览器（Electron/Chromium 146），自有静态服务 127.0.0.1 动态端口（用后已关闭）。
视口：`setViewportSize(402,874)`（iPhone 17标准版竖屏仿真基准）。**如实说明**：该工具的视口设置为缩放仿真，页面布局视口为窗格尺寸（如486×436等），但模块主栏由 `max-width:402px` 保证恰好 402 CSS px（实测 bodyWidth=401.997~402）；**DPR3物理像素与真实窄屏(390/360)布局无法在此工具仿真，记NOT TESTED**。自动化全部使用合成PNG与虚拟mediaDevices（?fakeMedia钩子），未开启物理相机/麦克风。

| 文件 | 状态 | 证明点 |
| --- | --- | --- |
| 01-idle-402x874.png | idle | 默认待机不请求设备；声明条/本机语义说明/连续模式默认关可见 |
| 02-original-thumbnail-402x874.png | preview | 合成PNG原件真实渲染；来源方式=file_picker |
| 02c-thumbnail-and-hash.png | preview | 原件元数据：**页面内SHA-256=9a78b6c7…9617 与Node基线一致**；尺寸800×1200；字节2,882,143；拍摄时间未知；capture提示仅记录 |
| 02d-thumbnail-expanded.png | preview | 独立缩略图：真实canvas生成427×640、169,247字节，标注与原件独立 |
| 03-preview-collapsed.png | preview+收起 | 原件区收起；配套JSON验证收起/展开后src与哈希保持（evidence/browser-step03-collapse-state.json） |
| 04a-requesting-cancel-exit.png | requesting | 挂起请求期间“关闭摄像头”可用（取消出路可见） |
| 04b-after-cancel-idle.png | idle | 取消后明确提示“未保留任何设备或URL资源”，占用归零 |
| 05-denied.png | denied | 权限拒绝单次提示不循环（gUM调用数=1）；选择文件仍可用；可显式再点重试 |
| 06-error-invalid-file.png | idle+错误 | 非图片文件拒绝NOT_AN_IMAGE，状态无副作用 |
| 07-unsupported-filepicker-ok.png | unsupported | 未配置（无getUserMedia）明确中文提示+回退指引；**选图入口不受阻** |
| 08-360x800-recorded-with-caveat.png | 仿真记录 | 工具仅缩放仿真，真实360布局回归NOT TESTED（见evidence/browser-step08-keyboard-viewport.json） |

配套JSON证据：evidence/browser-step02-hash-check.json、browser-step03-collapse-state.json、browser-step04-cancel.json、browser-step06-error.json、browser-step07-unsupported.json、browser-step08-keyboard-viewport.json、viewport-record.json。

## 工具限制（防冒认）

- Playwright locator/坐标/节点三种点击通道在本工具视口仿真下均无法可靠触发按钮；交互以页面内DOM click（触发同一真实事件监听器）完成，状态迁移均为控制器真实行为。
- 键盘Tab实击无法注入：焦点顺序仅结构性验证（DOM顺序=视觉顺序、原生button/summary可聚焦、:focus-visible样式存在），真实键盘走查留人工。
- 页面加载偶发模块竞态（首轮未执行）：重载即恢复；与控制器无关。
