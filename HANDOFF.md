# JW · V0.1新任务交接

工作目录必须是 `C:/Users/22673/Desktop/JW`。用户已新建并核实应用JW项目，projectId=cf880028-c0af-418f-87b5-7ca69bf12dc4；旧目录另显示为Anthropic。使用保存目录local模式，不创建或切换worktree。GitHub仅对应Openclaw-D/HUMAN-AGENT-LOOP。

## 用户最新决定

独立项目，根目录Achieve、Front、Back；初版V0.1，此后0.2/0.3小步迭代。用户担心迁移丢关键历史，要求保留小型Markdown、决策/roadmap、代码与回测材料。GitHub最终指定Openclaw-D/HUMAN-AGENT-LOOP，用户知悉历史归档后明确要求全部公开上传。日常讨论围绕决赛演示、逻辑与进度；历史不自动成为活动范围。

用户已授权移植完成后建立应用新项目与新任务交接，并已添加新JW目录。建立后首轮只读接手并汇报实际入口、已知问题、远端同步状态和最小下一步，不自动实施V0.2。

## 已完成

- 源码从旧3607六角色前端与V7/backend-next复制；四个前端依赖桥替换为实际源模块原样本地副本。业务代码不改版。
- 7,133个复制条目，912份原始Markdown全部保留，hash不匹配0、源漂移0、相对import缺失0；原Anthropic保留。
- Front独立安装、build、typecheck、11测试通过；Back/A typecheck通过；B63/C34测试通过。
- 新数据库/API专项冒烟通过：幂等、匿名敏感写拒绝、candidate完成与重启保持。新预览3617 HTTP200；旧3607未更改。
- 迁移报告、完整清单、排除理由、Markdown覆盖核对位于Achieve/Migration。
- 本地独立Git已初始化main，发布文件核对原始blob字节一致；首次公开发布授权已确认，实际同步以本地HEAD与远端main核对为准。31份旧临时状态副本留在Git排除目录；4份归档.gitattributes改名为.gitattributes.source保留内容，避免Git换行转换。最终上传以manifest中publish不为false的条目及新增入口/工具文件为准。
- 本轮建立的Docker容器jw-v01-pg已停止，卷jw_v01_pgdata保留。其15442端口与旧服务隔离；内核冒烟子进程已退出。Front3617静态预览由迁移任务启动，是否仍活需只读检查，不按旧PID停服务。
- 首次公开提交d67b940已推送并与远端main核对相同。后续按用户“几十MB不需排除”纠偏，补齐886份参考资料（823,412,417字节，单文件最大47,118,613字节），均保持历史路径和SHA256对账；不是业务代码改版。最终发布状态以远端HEAD核对为准。
- 最新后端再次对账：Back与原V7/backend-next的148份应迁移源码/配置示例/文档/测试全部一致，无缺失；运行状态、真实本地配置、依赖、evidence和隔离spike单列排除。Front/dist已重新构建，根Start-JW.cmd使用Node内置HTTP服务启动3618，不需要前端node_modules；服务访问/资源/边界/端口冲突自动化检查通过。

## 阅读顺序

AGENTS.md → README.md → DECISIONS.md → ROADMAP.md → Achieve/Migration/VERIFICATION.md。业务接口按Back/CONTRACT.md；原始收口证据按Achieve/Anthropic/V7/DISPATCH_STATUS.md的2026-09-16 07:00段、Back/D/RESULT.md最终附录。默认不扫描整个Achieve，更不扫描原Anthropic或桌面；按问题定点读历史。

## 未完成与不能误报

前后端未接线；D-25e仍不稳定；v1.3复核ack业务政策待裁决；真实模型0调用；生产身份及部分读/证据写项目隔离未验收；未做第二机器和用户视觉验收。现有A全量测试硬编码旧15432和容器，部分会重启旧资源，迁移时未运行全套，后续需参数化。C非租赁抽象反例与商业租赁案例保留，规则/演示阈值不是公司制度。

用户最新明确：最终交付必须是JW内完整、可启动、前后端联调通过的演示项目。此条件尚未达到，不能将本次上传称为完整联调交付；交接首要任务是核对Achieve/Migration/DELIVERY_STATUS.md并制定接线执行包，不将接线推迟为任意未来探索。仍不借新任务隐藏委派或自动操作ZCode。

最新优先顺序是先尽快交付现有前端、最新完整后端、dist/双击入口及面向队员的简明README；用户明确三者一体（JW目录、JW应用项目、GitHub仓库）。后续联调另在新项目持续推进，不在这次包装中悄悄改业务逻辑。双击入口仅启动模拟前端，不启动数据库/A/B/C；README已明示。

Codex不使用subagent；产品业务代码仍由ZCode实施、Codex独立验收。ZCode后续必须显式切到JW路径并重新明确writer范围，旧任务的原工作目录不会自动改变。本次创建新任务不授权其代发ZCode修复或继续历史夜间Goal。

## GitHub交接核对

最终目标已确认：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP ，公开。首次推送前该仓库为空。发布说明见Achieve/Migration/PUBLICATION.md；staged-check.json是首次commit前检查快照，不是后续实时Git状态。接手时只读核对git根、origin、本地HEAD与远端main，不能因为快照写着push:false就重复建仓或改远端。不得将原Anthropic根加入提交，也不回写其中原件。
