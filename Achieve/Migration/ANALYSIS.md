# JW 迁移分析（2026-09-16）

## 用户要求

拆出独立项目 `C:/Users/22673/Desktop/JW`，降低默认扫描负担，同时尽可能保留各版本关键 Markdown、历史代码和回测证据；完成后同步新的 GitHub 仓库。采用复制，保留 Anthropic 原件，不删除历史。扫描期间用户追加决定：目录名为Achieve/Front/Back，项目初始版本V0.1，按0.2/0.3迭代；GitHub名称须最终确认后才创建推送；移植后希望新建应用项目与任务交接。

## 当前来源判断

- 前端：`V6/REPAIR_20260914_EVENING/home/preview/main.tsx` 挂载 `site-mirror/app/v5-preview/home-overview.tsx`。F轮六角色、4合成案例，本地状态，无当前后端接线。旧 home/README 日期较早，实际入口与 F_REPORT 优先。
- 后端：`V7/backend-next/{A,B,C,D}`，最新共享 CONTRACT v1.3 CANDIDATE。A 是 PostgreSQL/HTTP业务事实内核，B是 LangGraph执行器，C是案例/计算/mock，D是验证脚本。`V7/backend/` 是上一批，不能当作最新后端。
- 旧根 NORTH_STAR/DECISIONS 仍含 V6-CTRL 描述；原文保留到 history，JW 根部另写当前导航和来源，不修改旧业务决定。
- 当前状态依据 `V7/DISPATCH_STATUS.md` 的 2026-09-16 07:00 收口及 D/RESULT 06:45最终附录。先前正文存在重复/旧结论，不能直接宣布全绿。

## 保留方式

1. `Front/`：当前预览、组件和测试；原来四个 re-export 桥文件指向旧 site，迁移时将其实际模块原样复制到本地相同相对位置（包括传递依赖）。新增独立 package manifest 和 Vite 启动配置，产品逻辑不重写。
2. `Back/`：保留 A/B/C/D 相邻关系、契约、src、tests、migrations、templates、scripts、lockfile。维持旧协议字段和包名，避免仅为改名引入回归。迁移后的顶层项目名JW，GitHub名称待确认。
3. `Achieve/Anthropic/`：按原相对路径保存各版本 Markdown、源码、测试、小型JSON/TXT证据及其他小型文本资料。原始文档保持逐字节一致，包括过时结论；Achieve/README明确其非当前authority。Celery spike保存在这里，未据迁移决定采用。
4. `Achieve/Migration/manifest.json`：每个复制文件的源路径、目标路径、大小、SHA-256、用途；`excluded.json`：未迁移文件/目录及原因。所有复制后做hash校验，并检查复制期间源是否变化。

扫描后例外：18份旧D/.run中的小Markdown补入，912份原始Markdown全保留。31份活动Back临时mock状态副本移到Migration/Local-Test-State并标publish=false；历史同源小快照保留作回测证据。4份旧.gitattributes以.gitattributes.source保存原内容，根.gitattributes禁止换行转换，保证Git blob与复制hash一致；源目录未变。复制清单总计7,133条，约78.8MB。

## 剔除与恢复

依赖安装目录、Git内部历史、数据库目录、运行状态、构建缓存、日志/原始JSONL、真实环境配置、证书和大于2MiB的非Markdown参考文件不复制；Markdown不受2MiB阈值限制。媒体/Office/PDF等二进制材料暂留原目录，由 excluded.json 索引定位。`.codex-remote-attachments` 仅记录目录排除，不枚举或迁移。

这是一份源码与项目知识迁移，不是数据库数据迁移或完整磁盘备份。旧数据库/卷和服务仍在原位置；新实例从 migrations 与合成模板重建，不共享旧测试数据目录。旧 .git 不复制，JW 创建独立历史；历史代码的文件快照已保留，旧Git对象仍在原仓库。

## 防止历史干扰

`.ignore` 把 Achieve 从普通 rg 扫描中排除（仍拟提交Git）；AGENTS限定默认工作面。历史按明确问题定点读取，避免反复扫描整个桌面或Anthropic。不使用软链接/junction回连旧依赖。相对链接若指向未迁移大文件，其恢复依据是 excluded.json 中的原相对路径。

## 验证与仍未完成事项

迁移验证：复制hash、源稳定性、前端相对import闭合、独立安装/构建/测试、后端类型与模块测试、隔离数据库/API基本恢复、git暂存内容与远端hash。结果记录在 VERIFICATION.md。

业务能力不因迁移而补齐：前后端未接线；D-25e预算重启目标状态不稳定；真实GLM调用为0；生产身份与部分读/证据写隔离未验收；v1.3 staleReviewAck放行政策待用户裁决；跨机器未测。本次不扩大为解决这些产品缺陷。

## GitHub

账号已只读确认Openclaw-D。用户随后明确：最终名称稍有改动，待移植完成后确认，再建仓推送。计划独立私有仓库，尚未创建/推送；不将此前JW/JWV7候选名字当作最终确认。推送内容为干净源码、历史参考与迁移证据，不推依赖、运行数据或原Git目录。

后续明确决定（2026-09-16）：最终目标为Openclaw-D/HUMAN-AGENT-LOOP，用户要求全部公开上传JW已迁移内容。此前名称待定/私有方案被替代；新发布范围以PUBLICATION.md为准。
