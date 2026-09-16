# 见微 V4｜活动代码仓库

状态：`CURRENT IMPLEMENTATION / FOUR-DOMAIN BACKEND IN PROGRESS`

本目录是 JW 唯一活动代码仓库。产品 authority 位于工作区根部：

- `../../NORTH_STAR.md`
- `../../DECISIONS.md`
- `../../ROADMAP.md`
- `../../CHALLENGE_LOG.md`

## 当前范围

首期只实现小微大风控四域协同：政策、信审、商务、资产。商机与尽调仅作为上游 Context；Agent/模型始终 `authority=none`；正式状态只能由具名 Human Gate 或获授权确定性规则改变。

## 当前实现入口

- `lib/v4life/`：四域领域内核；
- `app/api/v4life/`：四域 API；
- `test/v4life-*.test.mjs`：四域测试；
- `docs/v4/CONTRACT.md`：exact implementation contract；
- `docs/v4/ACCEPTANCE.md`：验收 Gate；
- `docs/v4/ZCODE_BACKEND_GOAL.md`：当前 ZCode 后端执行书；
- `STACK.md`：真实技术栈和未实现边界；
- `CHANGELOG.md`：代码与项目文档变化。

V2/V3 根部文档已移至 `docs/archive/root-legacy-20260903/`；`docs/archive/v3-archive/` 与 `docs/archive/v4-pre-life-20260902/` 只作历史，不参与默认实现判断。

## 验证

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

未经当前授权，不安装依赖、部署、commit/push、调用真实模型/业务 API 或修改生产配置。进程内状态、合成数据和 stub Adapter 不得声明为生产能力。
