# V4技术栈与实现边界

归属：V4工程清单；不决定产品主干或未来平台。2026-09-05仅作文档对账，不是新技术选型。

## 已有工程

- package.json：Node >=22.13.0、TypeScript 5.9.3、React 19.2.6、Next 16.2.6、Vinext 1.0.0-beta.3、Vite 8.0.13。
- 当前dev/build/start使用Vinext；dev:node是已有Next开发入口。本轮没有改变脚本、依赖、部署或服务。
- 当前四域canonical实现：lib/v4life与app/api/v4life；/work和/work/screen读取服务端Projection。
- 默认内存；V4LIFE_DATA_DIR可选接文件事件日志与命令日志，不等于生产事务数据库。
- 当前模型Candidate是确定性规则；旧模块/适配器的存在不表示canonical工作流已接真实模型。
- 编排运行时未固定；Dify、LangGraph等仍是可替换候选，不因本清单进行部署或自研平台。

## 未完成边界

精确状态与API以 [CONTRACT.md](docs/v4/CONTRACT.md) 为准；日期化测试与缺口以 [ACCEPTANCE.md](docs/v4/ACCEPTANCE.md) 为准。无完整生产认证/租户隔离、原子事务与生产部署验收。

旧技术清单全文保存在 [整理前快照](../../archive/90-tooling/workspace-organization-20260905/before-edit/jianwei-v3/site/STACK.md)，不再把旧lib/domain或旧页面数量当作当前四域系统结构。
