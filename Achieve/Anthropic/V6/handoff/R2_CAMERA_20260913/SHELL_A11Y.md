# SHELL_A11Y｜R2手机测试壳可访问性与移动适配说明

基准：iPhone 17标准版竖屏仿真 **402×874 CSS px（DPR3设计基准）**；390×844 与 360×800 仅作较窄回归。本壳是模块验证壳，非产品前端。

## 已实现的检查项

| # | 检查项 | 实现位置 |
| --- | --- | --- |
| 1 | 视口：`width=device-width, initial-scale=1, viewport-fit=cover`；safe-area内边距 | index.html `<meta>`、body padding |
| 2 | 单列布局，max-width 402px 居中；360px宽无横向溢出（内容均 `overflow-wrap:anywhere`） | body样式 |
| 3 | 状态区 `role="status"` + `aria-live="polite"`，状态变化自动播报 | `#state` |
| 4 | 错误提示 `role="alert"`（#b00020 对白底对比约5.9:1） | `#notice` |
| 5 | 全部按钮触控目标 ≥44px（min-height:44px）、间距8px | button样式、.btn-row gap |
| 6 | 主操作/次操作分组（`role="group"` + aria-label）；拍照主按钮加粗主态 | .btn-row |
| 7 | 禁用态可辨识：#767676 对白底 4.54:1；正文 #111 对白底 17.4:1 | button:disabled |
| 8 | 键盘可达：`:focus-visible` 3px #1a73e8 外框；Tab顺序=视觉顺序（DOM顺序即布局顺序） | button/input/summary样式 |
| 9 | video 有 aria-label；两处 img 有中文 alt；无仅hover功能 | video/img元素 |
| 10 | 连续模式 checkbox 22px + 22px可点击，label显式for关联；默认不勾选（=单次，拍完关轨） | .mode-row |
| 11 | 摄像头开启中持续提示条（#fff3cd底、#111字），hasLiveStream时显示 | `#live-indicator` |
| 12 | 元数据区"原件SHA-256"实时计算显示（crypto.subtle），原件与缩略图分区展示并说明副本关系 | standalone-main.mjs renderPreview |
| 13 | 能力检测与测试钩子默认折叠（details/summary），钩子面板标注"仅模块验证，非产品功能" | details |
| 14 | 请求挂起时可"关闭摄像头"=cancelRequest（取消出路，防权限弹框永不返回困住用户） | btnClose逻辑 |

## 测试钩子（自动化专用，均不触真实设备）

- `?fakeMedia=hang`：控制器创建前安装虚拟mediaDevices，getUserMedia永不resolve → 验证"请求中取消"。
- `?fakeMedia=deny`：虚拟getUserMedia以NotAllowedError拒绝 → 验证"拒绝"状态。
- `?autoInject=png|bad`：加载500ms后注入合成PNG（fetch `/evidence/assets/synthetic-800x1200.png`）或非图片文件。
- `window.__R2_TEST = { controller, pageInfo() }`：读取状态与 `{innerWidth, innerHeight, devicePixelRatio, userAgent}`。
- 无参数时页面使用真实浏览器API、行为与普通页面一致。

## 留给主agent的浏览器验证步骤（402×874 / 390×844 / 360×800）

1. `setViewportSize(402,874)` → 读取 `__R2_TEST.pageInfo()` 记录实际 innerHeight 与 devicePixelRatio（工具无DPR仿真接口，DPR3物理像素渲染如实记录为未仿真）。
2. 截图：01-idle → `?autoInject=png` 02-原件+缩略图+哈希 → `?fakeMedia=hang` 03-请求中取消 → `?fakeMedia=deny` 04-拒绝 → 05-非图片错误提示。
3. 390×844、360×800 各做一次 idle+预览 截图回归，检查无溢出。
4. 软键盘、Safari工具栏/安全区下的实际可视高度：无真机环境，NOT TESTED（任务书允许记录待测）。

## 已知限制

- 本壳无自动化鼠标/触控双输入仿真；触控目标仅按CSS尺寸保证。
- DPR3/软键盘/安全区真机表现为 NOT TESTED；真机验证须用户主动进行（HTTPS，不开隧道）。
