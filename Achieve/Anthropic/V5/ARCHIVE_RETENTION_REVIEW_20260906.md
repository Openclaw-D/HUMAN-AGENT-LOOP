# Archive 保留候选清单

后续执行更新：用户已明确授权迁入与清除。450 个精选文件已迁入，其他有价值资产已上传私有 GitHub 冷备并验证；原 Archive 仅剩 12 张受保护附件。上传临时副本清理由自动审批阻止。最终状态见 [执行结果](archive-cleanup-20260906/RESULT.md)。以下保留为本轮最初筛选依据，不再代表待执行状态。

日期：2026-09-06。范围：C:\Users\22673\Desktop\Archive 四个顶层目录。
状态：只读筛选完成；未复制、剪切、删除、启动工程或运行历史测试。按目录、入口文档、文件清单及一份材料 manifest 抽查；不是逐文件内容审计或去重校验。以 Anthropic 当前 V5 A2A / 人机协作 / 上下文接续为筛选依据，历史文件不取得当前权威。

## 建议优先保留

1. TAG-sources-20260821/Stars/server、docs/A2A-ARCHITECTURE.md、src/a2aClient.ts，以及相关 package/lock、scripts、README。有 A2A core、store、HTTP 与测试文件，最贴近当前主线。仅作参考候选；README 自述兼容子集、未过官方 TCK，旧 HANDOFF 与 README 状态不同，不能直接认定成熟可用。
2. TAG-sources-20260821/JW/Compare/Back/evals/agent_communication 及 tests/agent_communication。保留固定案例、引用范围、安全边界、权威表零写入和显式失败评测。旧三角色/单焦点机制不直接套入 V5 四域并行。
3. TAG-sources-20260821/JW/Compare/Back/evals/model_gateway 及对应 tests/evals。用于合成输入/答案隔离、预算上限、有限重试、熔断与失败检查；不把 fake provider 的成绩当真实模型效果。
4. Compare-Material-Archive-20260814/native-material-packs/package-index.json，以及经逐项确认 synthetic 标记的少量代表案例目录。抽查 project-01 manifest 显示 synthetic_demo、isSimulated=true，且含 sha256。先保留 1–3 个案例用于闭环，扩展样本按需要；没有核验所有案例内容或重复副本。

## 条件保留

5. TAG-sources-20260821/JW/Compare/Back/app、tests、docs、scripts、依赖声明：值得做一个去除缓存和运行时数据的源码冷备，供查旧审计/审批/证据实现；不迁入活动代码。复制前确认与现有 Anthropic 历史是否重复。
6. TAG-sources-20260821/Race/见微-比赛路演-v4.pptx、见微-比赛路演-手稿版-v4.pptx、见微-比赛路演-5分钟提示卡-v3.txt：保留少量可编辑表达资产。只核实存在，未渲染审稿，不能称已验收最终稿。
7. TAG-sources-20260821/TQ/index.html、styles.css、app.js、README.md：小型离线协作演示参考；README 描述了并行、人工闸门与重试，只作交互参考。
8. TAG-sources-20260821/Material/record：9 份调研录音，是可能无法再造的原始资料。未播放、转录或判断授权；文件名涉及客户调研，不应混入当前仅合成/去标识/公开数据的项目。建议在独立受控冷备中保留，待确认来源和用途再处理。

## 当前可忽略，但不是已批准删除

- git-verification：验证用旧副本，未与 JW 做哈希去重，不判定完全重复。
- P5-Core-Scope-20260812：旧范围、临时评测、旧前后端及展示；当前无明确复用必要。
- Lease 的历史版本、交接包、CG 与 Unity 历代工程：不整包带入当前项目。
- Unity 的 Builds、Library、Logs，其他工程的 node_modules、dist、缓存、测试临时目录：不纳入精选资产。
- source-originals-20260814、重复 zip、材料副本：先按重复候选忽略，清除前须比对；不能仅凭名称删除。
- runtime 数据库、.stars-data、.codex-remote-attachments、凭据与隐藏状态：不迁入精选包；如后续清除涉及这些对象，须先明确恢复与权限边界。

## 建议的后续动作

维持一个活动项目。只按本清单复制精选资产到独立保留区，生成原路径、目标路径和 SHA256 清单，验证后再决定原目录清除。目的地和清除对象尚未确定，本轮不执行搬运或清除。

节省 token 的约束：每轮一个验收问题、仅检索相关文件、先验证最小闭环、历史按需查阅。删除磁盘文件本身不会自动减少 token；减少重复读取、方向反复与无验收的扩写才有效。
