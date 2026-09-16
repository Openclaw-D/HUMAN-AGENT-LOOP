# JW · V0.1

独立的人机目标协作项目。2026-09-16从Anthropic当前成果迁入，以小步迭代推进0.2、0.3；V0.1是可追溯的开发基线，前后端仍有已知问题。

## 三个目录

| 目录 | 内容 |
|---|---|
| Front | 六角色前端、4个合成案例、模拟交互、构建和测试 |
| Back | A业务内核、B执行器、C案例与mock、D验收；保留模块相邻关系以减少迁移风险 |
| Achieve | 历史文档/代码/证据，及Migration迁移清单；默认不扫描，按需检索 |

先读 [决定](DECISIONS.md)、[下一步](ROADMAP.md) 和 [交接](HANDOFF.md)。旧Anthropic保留恢复参考，日常开发应以本目录为工作根，不从旧任务默认路径继续写。

## 当前能力与问题

前端从原3607六角色预览迁入，仍是浏览器内合成模拟；后端从V7/backend-next迁入，使用Node/TypeScript、PostgreSQL及LangGraph。两者尚未接线。模型真实调用为0；模拟工程结果不代表真实模型或生产权限通过。

原批次最终记录：D按40个唯一id汇总37 PASS、1 FAIL、2被新用例替代的历史BLOCKED。D-25e的预算重启目标状态存在不稳定，原因未定；v1.3 staleReviewAck放行规则仍待用户业务裁决；生产身份及部分读取/证据提交的项目隔离未验收。证据见 [最终收口原文](Achieve/Anthropic/V7/DISPATCH_STATUS.md) 与 [D原始结果](Back/D/RESULT.md) 的最终附录，旧正文若矛盾以最终附录为证据入口。本次实际迁移验证见 [验证报告](Achieve/Migration/VERIFICATION.md)。

## 本地启动

Node 22.23.1为本次验证环境。新Front不依赖旧site的node_modules或链接：

```powershell
cd C:\Users\22673\Desktop\JW\Front
npm ci
npm run dev
```

新预览默认端口3617，保留旧3607；仅本机。`npm run build`、`npm test`、`npm run typecheck`分别验证构建、模拟逻辑、完整保留类型面。

后端操作见 [启动说明](Back/START.md)；A/B/C各自安装锁定依赖。数据库需要单独初始化，不会自动拷贝旧数据或连接生产服务。Back内部包名与协议标识暂保留来源版本，顶层交付版本为V0.1。

## 历史查询与恢复

Achieve/Anthropic保留原相对目录；其中的决策/路线图/任务书属于原始快照，不自动变成当前指令。查询时指定版本：`rg --no-ignore "关键词" Achieve/Anthropic/V7`。

[迁移分析](Achieve/Migration/ANALYSIS.md)、[逐文件SHA256清单](Achieve/Migration/manifest.json)、[未迁移项](Achieve/Migration/excluded.json)记录来源与恢复位置。依赖、缓存、数据库原目录、凭据、原始日志和大二进制仍留在Anthropic；本次不是磁盘或数据库备份。

## 公开仓库与范围

用户于2026-09-16最终指定公开仓库：[Openclaw-D/HUMAN-AGENT-LOOP](https://github.com/Openclaw-D/HUMAN-AGENT-LOOP)，用于决赛演示、逻辑与队员进度协作；明确同意公开JW中已迁移的全部代码、文档和历史归档。

唯一提交根为本JW目录，不将旁边的Anthropic工作区作为Git根或再次整目录加入。`Achieve/Anthropic`是已经复制进JW、供历史追溯的快照，不是第二个活动项目，其中也保留早期探索/研究资料；它们不是决赛功能承诺。依赖、缓存、凭据及临时运行状态仍不提交。发布核对见 [范围说明](Achieve/Migration/PUBLICATION.md)。
