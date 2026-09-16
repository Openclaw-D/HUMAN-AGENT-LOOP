# 项目材料地图

这份地图用于快速定位项目入口、代码和素材。当前项目将大多数运行时内容由代码生成，因此不要只看 Unity 场景层级；核心材料主要在 `Assets/EYE`。

## 一分钟定位

| 你想做什么 | 从哪里开始 |
| --- | --- |
| 在 Unity 中运行项目 | `Assets/Scenes/SampleScene.unity`，然后点击 Play |
| 修改总览、左右翼或中部章节的三维构图 | `Assets/EYE/EyeExperienceHub.cs` |
| 修改进入章节后的空间与动画 | `Assets/EYE/EyeExperienceChapter.cs` |
| 修改标题、标签、步骤面板、鼠标可点击区域 | `Assets/EYE/EyeExperienceHud.cs` 和 `Assets/EYE/EyeExperience.cs` |
| 修改章节名称、文案、节点和五步流程 | `Assets/EYE/EyeChapterData.cs` |
| 修改材质、几何、光流、粒子等通用视觉组件 | `Assets/EYE/EyeVisualFactory.cs` 与 `Assets/EYE/Resources/*.shader` |
| 修改程序化声音 | `Assets/EYE/EyeAudioSynth.cs` |
| 修改 Windows 构建菜单 | `Assets/EYE/Editor/EyeDemoBuild.cs` |
| 查看外部素材来源与许可 | `THIRD_PARTY_ASSETS.md` |

## 根目录

```text
Unity/
├─ README.md                 # 如何运行、演示与发布说明
├─ PROJECT_MAP.md            # 本文件：材料与代码导航
├─ THIRD_PARTY_ASSETS.md     # 外部纹理的来源、许可与哈希
├─ Assets/                   # 场景、代码、Shader、纹理等 Unity 资产
├─ Packages/                 # Unity Package Manager 依赖清单
└─ ProjectSettings/          # Unity 版本、渲染和播放器设置
```

## 运行链路

```text
Assets/Scenes/SampleScene.unity
        ↓ 进入 Play
EyeExperience.cs（自动创建主控制器）
        ├─ EyeExperienceHub.cs      总览：左翼 / 中央五章 / 右翼
        ├─ EyeExperienceChapter.cs  章节空间和循环演示
        ├─ EyeExperienceHud.cs      屏幕文字、标签和热区
        ├─ EyeChapterData.cs        名称、文案、节点、步骤数据
        ├─ EyeVisualFactory.cs      几何、材质、粒子等通用构件
        └─ EyeAudioSynth.cs         程序化声场
```

## Assets 目录的用途

```text
Assets/
├─ Scenes/SampleScene.unity         # 唯一需要直接打开的演示场景
├─ EYE/
│  ├─ EyeExperience*.cs             # 主交互与页面构建逻辑
│  ├─ EyeChapterData.cs              # 章节内容数据
│  ├─ EyeVisualFactory.cs            # 通用视觉构件
│  ├─ EyeAudioSynth.cs               # 声音
│  ├─ Resources/                     # 运行时可加载的 Shader、眼睛图和外部纹理
│  └─ Editor/                        # 仅 Unity 编辑器使用的构建与图标材料
├─ Settings/                         # URP 渲染管线与 Volume 配置
└─ TutorialInfo/                     # Unity 创建项目时自带的教程信息，不参与演示核心逻辑
```

## 修改时的边界

- `Assets/EYE` 是当前产品代码与素材的核心区域；之后的“共创溯源”和“天驱体系”改动应集中在这里。
- `Packages/manifest.json` 记录依赖；不要为简单展示随意添加包。
- `ProjectSettings/` 是项目级配置，修改会影响整个项目和构建结果。
- Unity 的资源文件与同名 `.meta` 文件必须一起保留。不要在文件资源管理器中移动或删除 `Assets` 内文件；如需重组，应在 Unity Project 窗口内操作，或先确认引用影响。
- `TutorialInfo/` 可在确认不再需要 Unity 新手提示后单独清理，但这属于删除操作，当前没有执行。

## 当前内容结构

总览页由三个区域组成：左侧 `Origin`（共创溯源）、中部五章（信审、商务、政策、资产、协同）、右侧 `Ecosystem`（当前版本称“全域风控”）。后续把右侧升级为“天驱体系”时，优先更新 `EyeChapterData.cs` 的文案，再配合 `EyeExperienceHub.cs` 与 `EyeExperienceChapter.cs` 调整图形和动画。
