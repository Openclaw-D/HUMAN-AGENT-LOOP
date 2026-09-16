# P1 前端原型检查记录

日期：2026-08-27；地址：`http://127.0.0.1:4178/`。服务仅为 Node 内置静态服务，未占用 4177。

- `node --check app.js`：通过。
- `node --check upgrade.js`：通过。
- `node --check serve.mjs`：通过。
- `node verify.mjs`：8 项 PASS（fixture 标记、统一 identity/version/cursor、fixture 与前端默认映射精确匹配、关键契约 shape、三 selector 同源、无独立权威状态、仅灰阶）。
- HTTP GET `/`：200；HTTP GET `/projection-fixture.json`：200。
- 重新截图：使用 CDP `Page.captureScreenshot`，四张 PNG 的物理尺寸均为 `1920×1080`，完整包含顶部、左画布与右侧接续台。对应桌面窗口的 CSS 指标为 `innerWidth=1271`、`innerHeight=715`、`devicePixelRatio≈1.51`，文档 `scrollWidth=1271`、`scrollHeight=715`，无水平或页面级垂直溢出。右侧全局流 8 卡且 `scrollHeight > clientHeight`，因此可独立滚动；浏览器控制台 error：`[]`。

此记录是原型证据，不代表真实 Projection、客户数据或已冻结契约。

## 真实连调补充（2026-08-27）

真实 API 的运行、负向路径、四张 1920×1080 PNG 和已知限制已移至 `C:\Users\22673\Desktop\Anthropic\integration\p1\INTEGRATION_CHECKS.md`。该文件才是产品运行路径的证据；本目录原有 fixture PNG 不应当作为真实数据证明。
