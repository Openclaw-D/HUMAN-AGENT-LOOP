# V0.1迁移验证 · 2026-09-16

主Codex执行，未使用subagent。验证新JW目录，未改旧Anthropic产品源码。以下结果是迁移与限定用例验证，不覆盖全量产品验收。

## 文件与历史完整性

- 7,133个源文件复制条目，合计78,824,828 bytes（约75.2MiB）；均记录来源、目标、大小、SHA-256。
- 源文件与副本hash不匹配0；检查时源漂移0；符号链接/junction0；Front/Back静态相对import缺失或越出JW为0。
- Markdown专项：912份原始Markdown全部保留。首次路径筛选跳过旧D/.run测试快照中的18份Markdown，其中11份内容与现存文档不同，复查后全部补入（包括7份重复副本）。逐份追溯见markdown-coverage.json；不把数据库临时目录整体带入。
- 真实.env、原Git目录、依赖、数据库数据/缓存、原始日志/JSONL和大二进制不复制。excluded.json是目录级排除清单；manifest中标有exception的18份小Markdown是明确保留例外。
- 高置信模式扫描（GitHub/OpenAI/AWS/Google key及私钥头）命中0。这不是完整安全审计或对所有凭据格式的无遗漏保证；GitHub推送前仍需按最终清单检查。
- 所有版本文档保持原文；旧根North Star/Decisions位于Achieve/Anthropic，当前入口单独建立。
- 发布清单排除了31份误带入活动Back的旧合成临时状态：这些副本已移到被Git排除的Achieve/Migration/Local-Test-State，历史对应小型快照仍可查。活动Back不依赖它们。
- 初始化独立本地Git并暂存待发布内容，未commit。发现系统core.autocrlf=true会改换行后，增加根.gitattributes禁用文本转换；4份旧.gitattributes保持内容、以.gitattributes.source保存，避免覆盖新仓库规则。manifest记录新路径，原Anthropic文件未改。
- Git原始blob对账通过：暂存文件与磁盘字节一致、无遗漏可发布复制条目、无被禁依赖/数据/密钥文件路径。见staged-check.json。历史.gitignore可能屏蔽原始快照，已按核对清单显式纳入这些历史文件。

## 新目录内实际运行

| 检查 | 实际结果 |
|---|---|
| Front独立依赖安装 | 成功，生成自己的package-lock，零旧目录依赖链接 |
| Front构建 | PASS，Vite8.0.13，29模块，JS约240kB、CSS约19kB |
| Front模拟逻辑 | 11 PASS / 0 FAIL |
| Front完整类型检查 | PASS |
| A依赖锁安装与类型检查 | npm ci成功；tsc PASS |
| B依赖锁安装与模块回归 | npm ci成功；63 PASS / 0 FAIL |
| C规则、案例、计算与mock | 34 PASS / 0 FAIL |
| 独立PostgreSQL+HTTP迁移冒烟 | 5组检查PASS，结果backend-smoke.json |
| Front静态预览HTTP | 3617返回200，HTML引用新构建本地assets |

后端冒烟覆盖：jw-v01-pg独立容器/卷、15442端口、migration自动初始化、模板/项目/证据、幂等重放、匿名claim 403、候选执行完成、内核进程重启后goal投影一致。仅合成输入与tok-*测试身份。内核子进程已退出；jw-v01-pg已停止，卷jw_v01_pgdata保留可恢复。不重启或修改旧v7next-a-pg/Dify容器。

本次没有运行A全套，因为现存测试helper把旧数据库15432/容器v7next-a-pg写死，部分故障套件会重启旧共享容器。这是待下一轮参数化的可移植性问题，记录后以全新隔离数据库的专项冒烟验证本次迁移；不以冒烟替代其全量测试。

## 保留问题

- 前端与Back未接线；前端仍模拟回复与浏览器内状态。
- D-25e目标状态重启不稳定仍开放；B63项通过不证明D端到端反例已关闭。
- v1.3 staleReviewAck政策待用户裁决；真实GLM、生产身份与部分项目隔离、第二机器未验收。
- B旧README提及的Celery实验现位于Achieve/Anthropic/V7/backend-next/B/spike；采用未获冻结。旧lane内evidence链接需要按Achieve原路径查询；不恢复实验为主线。
- 本次无新增视觉设计，未执行用户视觉验收。

## 发布确认前的外部动作快照

GitHub CLI账号已只读确认Openclaw-D，仓库名待用户最终确认；独立本地Git已初始化，待发布文件已暂存，未创建远程仓库、未commit/push。

应用项目列表现有标签JW仍指向旧Anthropic。当前可用正式工具无新增本地项目接口；桌面窗口返回app=OpenAI.Codex、title=ChatGPT，Computer Use必读规则禁止自动操作ChatGPT desktop app UI。因此未尝试GUI点击添加项目，也未把新任务错误建在旧项目。等待用户把JW目录加入应用后，再调用list_projects确认绝对路径并用create_thread local模式交接。新任务授权已取得，不需再重复询问是否创建。

## 2026-09-16 后续发布决定

用户最终指定Openclaw-D/HUMAN-AGENT-LOOP，明确要求全部公开上传；覆盖上文快照中的名称待定/未授权发布状态。目标仓库在首次推送前为空、公开。唯一提交根为JW，不包含原Anthropic工作区，只包含已复制进JW的历史快照。详见PUBLICATION.md；首次提交前最新检查见staged-check.json，推送完成以Git远端main与本地HEAD相同为准。业务代码未因发布发生变化，不重复功能测试。
