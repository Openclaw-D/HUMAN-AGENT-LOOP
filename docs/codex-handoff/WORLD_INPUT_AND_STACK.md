> 历史设计，已被二维业务看板方向替代，不作为当前实施要求。

> 2026-09-19 最新冻结：业务视角横屏二维作业看板，明确不做3D/全国地图/办公室/手柄/游戏化，不以表格为主界面。此前见微世界与多输入要求在本轮范围中被替代，历史原型保留但停止投入。复用真实工作本，单项目商机→尽调→政策→信审→商务→资产至结清，依赖可并行不强制流水线。最新复核与四路接续任务见 docs/codex-handoff/board-round-02/REVIEW.md。

# 见微世界 · 技术路线与三种输入契约

2026-09-19最新授权：前期可提高投入，先搭完整可玩框架，后续优化；不改变ZCode实施分工，不自动增加真实GLM/付费/发布授权。用户自述两个周额度，不作为已核实账户余额。

## 技术选择

建议本轮沿用React/Vite/TypeScript，新增Three.js世界渲染，不必使用Unity。Three.js是渲染库，需自行补齐输入、镜头、简单碰撞、交互状态和音频组织；当前小型现场与现有Web工作本适合此路径。Unity有完整引擎/编辑器体系，但此时引入将增加独立工程、Web构建与网页通信的集成工作。

Three.js与Unity不是直接兼容的场景/脚本运行时。后续Unity Web构建可通过JavaScript通信、共享后台API和稳定对象ID接入独立现场；C#组件、材质与Three.js逻辑不能无损互换。glTF/GLB等资产可作为交换候选，导入导出工具与材质/动画适配需另验。本轮不安装Unity、不同时维护两套渲染引擎。

## 明确依赖

已核对Front/package.json：React/ReactDOM 19.2.6、Vite 8.0.13、TypeScript 5.9.3已声明；当前未声明three。该文件有在制修改，本轮不写入、不安装。

首版新增候选：three（实施时选择并锁定兼容版本，按需配套@types/three）。使用自带GLTFLoader、AnimationMixer、Raycaster及音频能力；浏览器Gamepad API处理Xbox，Pointer Events处理鼠标/触控点击，键盘事件处理按键，Web Audio处理声音。没有理由为三个输入源分别增加大型框架。

首版不强制React Three Fiber、物理引擎、Unity、Blender或额外MCP。简单静态现场先用边界/碰撞体；复杂物理/寻路出现明确验收需求后再选依赖。全国地图边界数据、音乐与角色资产是实际内容依赖，须核对来源、许可、文件体积并本地打包；未取得前不能宣称具备。

顺序：共享动作/位置/对象契约→场景、输入、面板/业务适配、声音并行→入口与package-lock单writer装配→三种输入实玩验收。先确认ZCode当前Front writer，不能交叉改入口。

## 三种输入同等支持

统一动作：Move、Look、Interact、Back、SwitchCamera、OpenMap、OpenCompanion、OpenPanel、Confirm、Pause。每个动作映射到相同应用状态，设备切换不刷新场景、不换身份、不重复提交。

| 动作 | 键鼠候选 | Xbox候选 | 屏幕点击/触控候选 |
|---|---|---|---|
| 移动 | WASD | 左摇杆 | 地面目标点/移动控件 |
| 看向 | 鼠标拖动/进入视角锁定 | 右摇杆 | 拖动视角 |
| 交互 | E/点击对象 | A | 点对象及动作按钮 |
| 返回 | Esc | B | 返回按钮 |
| 一/三人称 | V | Y | 视角按钮 |
| 见微 | Q | X | 水滴/见微按钮 |
| 全国地图 | M | View | 地图按钮 |
| 菜单/设置 | Esc菜单 | Menu | 菜单按钮 |
| 面板选择 | Tab/方向键/点击 | 方向键、LB/RB切页 | 点击页签/卡片 |

键位为候选，可实玩调整；三种输入功能覆盖为硬约束。屏幕点击包括鼠标点击和触控的Pointer Events，不把它等同于已承诺全部手机设备适配。地面点选只允许可达目标；首版可使用简单连通通道，不能穿墙或把移动误当跨客户传送。

屏幕控件按探索/面板情境显示，避免常驻三套提示。最近有效输入只改变提示样式，不禁用其他输入；所有关键动作保留可见点击入口。菜单获得焦点时阻断角色移动；关闭恢复原焦点。拖动与点击分开，滚动不穿透现场。失焦/断连归零连续输入，重连不重复执行业务动作。

## 验收

同一段世界旅程分别用键鼠、真实Xbox、屏幕点击独立完成，途中混合切换也保持状态。覆盖地图→喀什→角色/见微→工作本→返回、镜头切换、菜单焦点、暂停与音量。文本/上传等重输入保留明确入口，演示可使用已标注合成材料；不得伪造真实办理。

性能在实际演示机器记录首载/帧率/内存，目标值待短测冻结；不因未定性能数字推迟框架，不承诺未经测试的流畅性。当前仅契约草案，实机验收NOT_RUN。

## 官方依据

- Three.js第一人称控制：https://threejs.org/docs/pages/PointerLockControls.html
- Three.js资产加载：https://threejs.org/docs/pages/GLTFLoader.html
- Unity Web与浏览器通信：https://docs.unity3d.com/Manual/webgl-interactingwithbrowserscripting.html
- Unity Web平台：https://docs.unity.com/en-us/engine/6000.3/manual/platform-specific/webgl
- Gamepad：https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API
- Pointer Events：https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
