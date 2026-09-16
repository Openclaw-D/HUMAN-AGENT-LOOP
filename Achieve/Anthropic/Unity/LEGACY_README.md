# 看见 EYE｜Unity 最终比赛版

这是一个面向五分钟现场演示的 Windows 离线交互程序。项目基于 Unity 6.5、URP 和 Input System；目标电脑只需复制完整发布文件夹并双击 `EYE.exe`，不需要安装 Unity、联网、登录或启动本地服务。

## 先从这里打开

如果你要查看或继续编辑这个项目：

1. 启动 **Unity Hub**，点击 `Add`（添加）。
2. 选择本项目根目录：`C:\Users\22673\Desktop\Unity`，然后用 Unity `6000.5.4f1` 打开。
3. 在 Unity 的 Project 窗口中打开 `Assets/Scenes/SampleScene.unity`。
4. 点击编辑器上方的 **Play** ▶。

不需要把 `EyeExperience` 脚本手动拖到场景中：程序会在进入 Play 后自动创建它，并生成全部视觉、HUD 与点击交互。

第一次打开时，Unity 可能需要导入资产；这是编辑器正常行为。当前目录没有现成的 Windows 发布包（也没有 `EYE.exe`），所以此时应通过 Unity 编辑器运行，而不是在资源管理器里寻找可执行文件。

项目材料怎么分布、每个文件应该在什么情况下修改，见 [PROJECT_MAP.md](PROJECT_MAP.md)。

## 演示结构

总览不是网页菜单，而是一座实时三维信息中枢：

- 左翼“共创溯源”：有机藤蔓、共同构建节点与持续回流。
- 中央五章：`信审 → 商务 → 政策 → 资产 → 协同`，按照讲解顺序逐章解锁。
- 右翼“全域风控”：多 Agent 数据高速路汇聚管理主脑。
- 真人母眼贯穿 Hub 与章节，虹膜由蓝、青、紫、琥珀四域共同构成。

七幕都有独立空间隐喻与五步自动循环：共创锻造台、信审断层扫描、商务执行传送带、政策版本档案环、资产雷达轨道、协同责任星链、Agent 指挥穹顶。所有子页面使用同一套视觉语法：`看见 EYE` 是唯一中心，五个业务节点位于外圈，真人母眼占据第六个顶点，形成稳定的六边矩阵；眼睛到中心是主干，中心到节点是单向放射。演讲者负责进入和返回，幕内逻辑会持续循环，不要求按照固定秒数操作。

## Unity 表现

- 面向会议室低亮度屏幕的深石墨蓝宇宙底、局部暖白信息层、固定左上流程看板和大字号远距识别。
- 透视镜头、鼠标视差、镜头推进和径向扫描转场。
- 放大 150% 的曲面真人母眼、程序化虹膜纤维、角膜 Fresnel、硬切面钻石材质、全息材质和 HDR 发光；钻石主光方向实时取自真人母眼。
- 主眼到核心的宽光束、核心到五节点的单向高速数据流、闭合六边矩阵、Bezier 数据通路、空间粒子和扫描构件。
- URP Bloom、Neutral Tonemapping、零暗角和 Linear Color Space。
- 启动即播放的 96 秒原创宇宙声场：低频引力层、宽立体声和声、星尘泛音、空间长尾，以及避开尖锐高频的沉重章节冲击；整体增益为上一版的 150%，不依赖外部音频文件。
- 自定义 EYE 应用图标，不使用默认 Unity 图标。

第三方纹理只有 6 张经过筛选的 CC0 素材，来源、许可证、文件哈希和用途记录在 [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md)。

## 编辑器运行

1. 用 Unity Hub 打开本目录。
2. 打开 `Assets/Scenes/SampleScene.unity`。
3. 点击 Play。`EyeExperience` 会自动构建全部运行时视觉和交互，无需在场景里手工挂组件。

## Windows 发布版

最终发布目录：

```text
Builds/Windows/EYE-Competition-Final/
├─ EYE.exe
├─ EYE_Data/
├─ MonoBleedingEdge/
├─ UnityPlayer.dll
└─ 其他 Unity 运行文件
```

复制到另一台电脑时必须复制整个 `EYE-Competition-Final` 文件夹，不能只复制 `EYE.exe`。构建脚本会先清理这个生成目录，并自动移除 Unity 的 `BurstDebugInformation_DoNotShip` 调试目录；`D3D12` 与 `dstorage*.dll` 虽然不参与实际 D3D11 渲染，但属于 Unity Player 启动所需文件，必须保留。

菜单构建：`EYE → Build Competition Final`

PowerShell 批处理构建：

```powershell
& 'C:\Program Files\Unity\Hub\Editor\6000.5.4f1\Editor\Unity.exe' `
  -batchmode `
  -quit `
  -projectPath 'C:\Users\22673\Desktop\Unity' `
  -executeMethod EYE.EditorTools.EyeDemoBuild.BuildWindowsDemo `
  -logFile 'C:\Users\22673\Desktop\Unity\Logs\EYE-Final-Build.log'
```

## 演示控制

| 操作 | 功能 |
| --- | --- |
| 左键 | 进入可用入口、点击章节右下/左下的审视母眼返回 |
| 右键 / `Esc` | 返回七幕总览 |
| `Space` | 暂停或继续章内五步循环 |
| `Q` | 比赛画质 / 核显稳定画质切换 |
| `M` | 静音或恢复声音 |
| `F11` | 切换全屏 |

## 画质与性能

默认是比赛画质：1920×1080、Render Scale 1.08、SMAA High、Shader 解析抗锯齿、HDR、Neutral Tonemapping、Bloom 和完整粒子密度。按 `Q` 切换核显稳定档后，Render Scale 为 0.90、SMAA Medium，并降低常驻粒子量；文案、交互、章节结构和关键动画不会被删减。

Windows 构建固定使用 Direct3D 11，目标是提高 Ryzen / Intel 核显和现场投影环境的兼容性。最终仍应在实际演示电脑上完整走一遍七幕；若比赛画质不能稳定保持流畅，现场直接按一次 `Q`。

## 项目边界

- 不连接互联网、API、数据库或在线字体。
- 不需要 Unity Runtime 或 Visual C++ 手工安装步骤；Unity 所需运行文件随发布文件夹一起交付。
- 不使用 VFX Graph、实时阴影、SSAO、景深或大体积第三方 Unity 插件，避免在核显上用不可控的成本换取短暂效果。
