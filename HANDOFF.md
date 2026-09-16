# JW · V0.1新任务交接

工作目录必须是 `C:/Users/22673/Desktop/JW`，不能仅凭项目显示名JW判断（旧注册项目JW实际指向Anthropic）。使用保存目录local模式，不创建或切换worktree。

## 用户最新决定

独立项目，根目录Achieve、Front、Back；初版V0.1，此后0.2/0.3小步迭代。用户担心迁移丢关键历史，要求保留小型Markdown、决策/roadmap、代码与回测材料。GitHub最终指定Openclaw-D/HUMAN-AGENT-LOOP，用户知悉历史归档后明确要求全部公开上传。日常讨论围绕决赛演示、逻辑与进度；历史不自动成为活动范围。

用户已授权移植完成后建立应用新项目与新任务交接。正式项目工具只看到旧路径，需先在应用添加新JW目录。建立后首轮只读接手并汇报实际入口、已知问题、远端同步状态和最小下一步，不自动实施V0.2。

## 已完成

- 源码从旧3607六角色前端与V7/backend-next复制；四个前端依赖桥替换为实际源模块原样本地副本。业务代码不改版。
- 7,133个复制条目，912份原始Markdown全部保留，hash不匹配0、源漂移0、相对import缺失0；原Anthropic保留。
- Front独立安装、build、typecheck、11测试通过；Back/A typecheck通过；B63/C34测试通过。
- 新数据库/API专项冒烟通过：幂等、匿名敏感写拒绝、candidate完成与重启保持。新预览3617 HTTP200；旧3607未更改。
- 迁移报告、完整清单、排除理由、Markdown覆盖核对位于Achieve/Migration。
- 本地独立Git已初始化main，发布文件核对原始blob字节一致；首次公开发布授权已确认，实际同步以本地HEAD与远端main核对为准。31份旧临时状态副本留在Git排除目录；4份归档.gitattributes改名为.gitattributes.source保留内容，避免Git换行转换。最终上传以manifest中publish不为false的条目及新增入口/工具文件为准。
- 本轮建立的Docker容器jw-v01-pg已停止，卷jw_v01_pgdata保留。其15442端口与旧服务隔离；内核冒烟子进程已退出。Front3617静态预览由迁移任务启动，是否仍活需只读检查，不按旧PID停服务。

## 阅读顺序

AGENTS.md → README.md → DECISIONS.md → ROADMAP.md → Achieve/Migration/VERIFICATION.md。业务接口按Back/CONTRACT.md；原始收口证据按Achieve/Anthropic/V7/DISPATCH_STATUS.md的2026-09-16 07:00段、Back/D/RESULT.md最终附录。默认不扫描整个Achieve，更不扫描原Anthropic或桌面；按问题定点读历史。

## 未完成与不能误报

前后端未接线；D-25e仍不稳定；v1.3复核ack业务政策待裁决；真实模型0调用；生产身份及部分读/证据写项目隔离未验收；未做第二机器和用户视觉验收。现有A全量测试硬编码旧15432和容器，部分会重启旧资源，迁移时未运行全套，后续需参数化。C非租赁抽象反例与商业租赁案例保留，规则/演示阈值不是公司制度。

Codex不使用subagent；产品业务代码仍由ZCode实施、Codex独立验收。ZCode后续必须显式切到JW路径并重新明确writer范围，旧任务的原工作目录不会自动改变。本次创建新任务不授权其代发ZCode修复或继续历史夜间Goal。

## GitHub交接核对

最终目标已确认：https://github.com/Openclaw-D/HUMAN-AGENT-LOOP ，公开。首次推送前该仓库为空。发布说明见Achieve/Migration/PUBLICATION.md；staged-check.json是首次commit前检查快照，不是后续实时Git状态。接手时只读核对git根、origin、本地HEAD与远端main，不能因为快照写着push:false就重复建仓或改远端。不得将原Anthropic根加入提交，也不回写其中原件。
