# 截图索引｜R3 相机接入契约·精确小屏验证

环境与方法：本机 Chrome headless（`C:\Program Files\Google\Chrome\Application\chrome.exe`）+ **CDP `Emulation.setDeviceMetricsOverride`**——`402×874 / DPR3` 与 `390×844`、`360×800` 均为**真实布局视口**（页面实测 `document.documentElement.clientWidth` 精确等于 402/390/360、`devicePixelRatio===3`），非窗口缩放、非图片缩放。截图物理尺寸=W×3 × H×3（IHDR 校验，见 evidence/headless-measure.json）。
自动化全部使用合成PNG与虚拟mediaDevices（?fakeMedia=none/hang/deny），未开启物理相机/麦克风；交互经壳内 `?auto=` 序列（真实DOM click事件）驱动；收据/测量由壳 POST 到自有本地服务落盘（127.0.0.1 动态端口，进程已清理）。

| 文件 | 场景 | 关键断言（全部通过） |
| --- | --- | --- |
| r3-01-idle-402x874-dpr3.png | idle | 零设备调用；布局402 |
| r3-02-preview-402x874-dpr3.png | preview(合成PNG) | 状态“已获得照片”；作废按钮激活；urlsHeld=2属持有中 |
| r3-03-discard-contract-402x874-dpr3.png | 作废照片(仅内容) | 收据reason=discard：URL收支平衡、终态disposed全零 |
| r3-04-requesting-cancel-exit-402x874.png | 请求挂起 | “关闭摄像头”可点（取消出路可见） |
| r3-05-hangup-receipt-402x874.png | 挂断收据 | reason=hangup：取消后idle、终态全零、事件序列完整（evidence/collected/） |
| r3-06-denied-402x874.png | 拒绝 | 单次调用不循环；选择文件仍可用 |
| r3-07-error-invalid-402x874.png | 非图片错误 | NOT_AN_IMAGE无副作用 |
| r3-08-unsupported-picker-ok-402x874.png | 未配置 | 明确中文提示；选图不受阻 |
| r3-09-long-notice-not-blocking-402x874.png | 超长提示 | noticeLength>100；矩形断言不遮挡开启/拍照/挂断按钮（measure.rects） |
| r3-10-preview-390x844-real.png | 390×844真布局回归 | clientWidth=390精确 |
| r3-11-preview-360x800-real.png | 360×800真布局回归 | clientWidth=360精确 |

配套JSON：`evidence/headless-measure.json`（11场景全量：请求视口/PNG物理尺寸/measure/clientWidth/DPR/收据/逐项checks，**failedChecks=0**）、`evidence/collected/*.json`（每场景资源收据+测量）。

## 工具说明（防冒认）

- R2 曾用 ZCode 内置浏览器缩放仿真（等效宽度）；本轮按要求改用真 Chrome CDP 仿真实现**真实布局尺寸**，390/360 不再是等效宽度。
- 仍为桌面 Chromium 仿真：真机 Safari、软键盘、安全区、触摸实击=NOT TESTED（见STATUS/REPORT）。
