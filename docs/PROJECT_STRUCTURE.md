# JW 项目地图（2026-09-20）

给第一次打开本目录的人：**JW 是一个项目，不是这些文件夹各自一套软件。** 当前只需从项目根目录的 `README.md` 和 `docs/v0.3/00_AUTHORITY.md` 看方向；本机完整演示使用 `Back/Edge/scripts/takeoff-up.mjs`。`Start-JW.cmd` 只显示静态前端预览。

## 一张图看懂运行关系

```text
浏览器页面 Front/dist
       │ 同源访问
       ▼
Edge（统一入口：身份、权限、页面 API、状态汇聚）
       ├── A（业务事实、人工决定、PostgreSQL）
       ├── Connectors（原件上传、处理与证据）
       ├── B（任务/助手执行器，按场景运行）
       └── C（规则、解析与合成测试支持）
测试与验收：Back/D、各模块 test、docs 中的证据
```

这里的 A/B/C/D 是后端历史分工代号，不是四个给用户打开的产品。Edge 是页面接入后端的门面；PostgreSQL 存业务状态。具体哪些能力已接通，应看本轮验收记录，不能从目录存在推断完成。

## 日常应该看什么

| 位置 | 它是什么 | 日常处理 |
|---|---|---|
| `Start-JW.cmd` | 双击静态页面预览，端口 3618；不启动业务后端 | 只想看画面时用 |
| `Back/Edge/scripts/takeoff-up.mjs` | TAKEOFF 本机完整演示编排，启动数据库、A、Connectors、Edge 并托管 `Front/dist` | 需要办理演示时按 `README.md` 的配置与命令使用 |
| `Front/` | React 页面源码、前端测试、可打开的构建产物 `dist` | 前端开发或构建时看；当前有人在改，勿移动 |
| `Back/` | 后端实现；A=业务内核，B=执行器，C=解析/规则，Connectors=资料处理，Edge=统一 API，D=验收 | 开发/联调时按模块看；当前有人在改，勿移动 |
| `docs/v0.3/` | 当前总目标、任务板和专题交付 | 先读 `00_AUTHORITY.md`、`01_FIXED_NORTH_STAR.md`、`TASKBOARD.md` |
| `docs/takeoff/first-admission-v1/` | 首次准入这一子流程的契约、实施与验收 | 排查 TAKEOFF 时看；其“只做首次准入”不能限制 V0.3 总目标 |
| `docs/materials/` | 演示用合成材料及其说明 | 核对样本时看；当前有任务写入 |
| `docs/archive/Achieve/` | 历史快照与迁移证据 | 默认收起，追溯出处时再看；不是运行目录 |
| `.local/` | 本机备份、日志和评测工作区，Git 排除 | 默认收起；不能当正式文档或随意删除 |
| `.jw-g03d-journey/` | 旧旅程测试的本机合成输入和邀请码等，Git 排除 | 默认收起；不是第二个 JW 产品，勿随意删除 |
| `JW_customer_credit_backend_tasks/` | 旧客户授信后端任务书，已被代码/决定文档引用 | 归档参考，默认收起；不自动按旧任务执行 |
| `TAKEOFF_First_Admission_v1.0.0/` | 用户提供的原始 TAKEOFF 文档包；已复制到 `docs/takeoff/first-admission-v1/` | 保留来源供核对，默认收起；维护仓库内版本 |
| `docs/codex-handoff/`、`docs/customer-next/` 等 | 前几轮方向、交接与验收记录 | 按问题查历史，勿和 V0.3 当前任务板混用 |

## 推荐的可见层级

普通使用者只需要看 `README.md`、`Start-JW.cmd`、`docs/PROJECT_STRUCTURE.md`，以及完整演示的页面。开发者再展开 `Front/`、`Back/`、`docs/v0.3/`、`docs/materials/`；验收时展开对应 `test/` 和证据文档。其余历史包和本机临时目录建议在编辑器/文件管理器中折叠，保留原路径。

**不要现在移动或删除上述目录。** `Back/Edge/README.md`、`DECISIONS.md` 等仍引用旧任务包路径；`Front/`、`Back/`、`docs/v0.3/`、`docs/materials/` 有并行写入。真正压平根目录前，需要逐项更新引用，并由当前总控协调文件 ownership 与验收。当前根部 `README.md`、`ROADMAP.md` 还保留上一阶段“唯一 TAKEOFF”文字；以其顶部 V0.3 最新决定及 `docs/v0.3/00_AUTHORITY.md` 为准。
