# 拟物图标与状态过渡

2026-09-20，用户要求的前端直接实施切片。素材通过内置 imagegen 生成，未调用 fallback CLI。原图保留在 Codex generated_images；项目文件见下表，构建复制到 Front/dist。

## 项目素材与提示词

公共风格提示：One isolated 3D physical toy-like UI object on genuinely transparent alpha background. Premium playful tactile iOS-style product illustration, believable rich materials, softly rounded proportions, restrained harmonious colors, soft studio light, front three-quarter view. Instantly understandable to a child, bold readable silhouette at 64px. Object centered filling 82% square canvas, no scene, floor, background, text, letters, numbers, sticker outline or unrelated items.

相对于 JW 根目录的保存路径及各对象描述：

| 路径 | 对象提示 |
| --- | --- |
| Front/preview/public/status/lock-v1.png | Warm champagne brass and pale silver physical closed padlock. |
| Front/preview/public/status/wrench-v1.png | Petrol blue double-ended metal wrench. |
| Front/preview/public/status/check-v1.png | Glossy bright lime green checkmark. |
| Front/preview/public/status/cross-v1.png | Glossy large red X. |
| Front/preview/public/objects/materials-v1.png | Tan kraft paper folder holding cream document sheets. |
| Front/preview/public/objects/analysis-v1.png | Old-fashioned brass magnifier with walnut handle. |
| Front/preview/public/objects/verify-v1.png | Wooden-handled blue inspection stamp with check mark. |
| Front/preview/public/objects/closure-v1.png | Gold trophy. |
| Front/preview/public/objects/business-v1.png | Gold crown. |
| Front/preview/public/objects/policy-v1.png | Ivory and brass ruler. |
| Front/preview/public/objects/credit-v1.png | Blue protective shield. |
| Front/preview/public/objects/commerce-v1.png | Cream contract paper with navy pen. |
| Front/preview/public/objects/asset-v1.png | Icy cyan diamond. |

本次过渡素材的完整最终提示词：

- **Front/preview/public/status/open-lock-v1.png**，参考 lock-v1.png：Edit reference padlock into the SAME exact padlock UNLOCKED: lift and swivel shackle open, visible gap right side. Preserve body, champagne brass pale silver materials, camera, centered size. Transparent alpha background, one isolated toy-like physical UI object, no key, no words, no scene. Need sprite for unlock animation matching original.
- **Front/preview/public/status/key-v1.png**：One isolated realistic toy-like physical brass key UI sprite on transparent alpha background. Old-fashioned short key with round bow on the right and shaft extending horizontally left, bit on far left. Front view, warm pale champagne brass with soft silver highlights, premium tactile iOS-style material, rounded safe edges, readable silhouette. Key alone fills 85 percent square width, no lock, no scene, no floor, no text. Made to animate sliding left into a padlock keyhole.

## 行为约束

- 首次渲染直接显示当前状态，不重播历史。客户切换重建图标实例。
- lock→wrench：1.8 秒视觉过渡，钥匙插入转动、锁打开、淡出变成扳手。随后扳手围绕螺栓来回拧动。
- 真实状态变成 check：旧物件退场，绿色对勾弹入并亮一次光圈。真实 cross：红叉淡入。
- 任何状态更新立即打断旧过渡。视觉计时器只清除临时动画，绝不生成业务成功、API 回执或办理记录。
- 尊重 prefers-reduced-motion；静态图例不转动。过渡图像预加载，避免第一次开锁临时加载。
- 仍沿用后端投影的已完成/运行/阻断判断；尚未形成共享专业结果的助手建议不能冒充矩阵完成。

## 验证与未完成项

- Front typecheck、build 通过；前端 129 项测试通过，包括计时不推进业务、失败打断、重开不重播。
- 真实入口 http://127.0.0.1:48214/，政策角色进入棉纺案例；页面 34 个对象与状态图片全部加载成功，实际 GLM 建议可读取。
- 独立 dev-only status-motion.html 检查钥匙插入、扳手螺栓对齐、绿勾过渡；该页面显式说明不连接业务，不进入生产构建，不计作真实 API 验收。
- 原来的 harness-takeoff.html 同样是离线夹具，不能当成真实办理入口。
- JEV 未来路径预测、动态分支画布、逐步导航与右侧完整决策记录尚未交付；现有建议不是未来状态预测。共享五专业后端结果与预测契约的实施分别见 ../ZCODE_REAL_MODULE_HANDOFF.md、../ZCODE_PATH_FORECAST_SLICE.md。
- 本切片不代表全流程稳定或用户视觉验收通过。
