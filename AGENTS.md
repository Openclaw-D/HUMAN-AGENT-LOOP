# HUMAN AGENT LOOP · 当前工作入口

用户最新决定：只保留一个当前产品——多人协作的通用模拟决策。参与者共同讨论、补充合成信息、比较多目标方案，由协调者记录明确决定。界面、示例、代码和文档保持行业中立，不恢复旧产品资料或旧领域逻辑。

## 开发与协作

- 先读 README.md、docs/ARCHITECTURE.md 和 docs/DECISIONS.md。
- 使用现有 checkout；每个 cloud task 已隔离，不创建 Git worktree。
- 不使用 subagent、explorer、worker 或隐藏委派。用户已授权本次直接完成产品清理和通用化实现。
- 保留用户修改；未经明确授权不 commit、push、切分支、重写 Git 历史或部署。本次用户已明确授权发布当前通用版本并清理旧仓库历史与版本记录，不包含公开应用部署。
- Front/dist 是当前可运行的前端交付物；源码修改后执行 build。
- 仅使用合成情景、模拟代号和本机存储；不得读取、上传真实密钥或真实人员资料。
- 助手当前为明确标注的规则模拟，不能宣称真实模型或自动学习；助手没有人工决定权。
- 不抢占端口、不停止未知进程；开发服务使用 scripts/manage.mjs 管理。

## 检查

Node.js >=22.13；安装 `npm --prefix Front ci`，执行 `npm run typecheck`、`npm test`、`npm run test:front`、`npm run build`、`npm run check:domain`。

报告真实通过、失败、未运行和验收边界。产品只保留当前版本；输入修订号和决定记录用于一致性与审计，不是并行维护的旧产品版本。当前工作树清理不等于已删除 Git 历史、远端或第三方副本。
