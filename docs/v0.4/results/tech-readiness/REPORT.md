# TECH_FIX：持久化声明检查

2026-09-21。仅交付只读诊断工具，未改变启动方式、配置或产品源码。

## 使用

从 `C:/Users/22673/Desktop/JW` 运行以下命令；不带参数会明确返回未提供，退出码为 2：

```powershell
node Back/Edge/scripts/v04-readiness-check.mjs
```

可显式增加 `--messages-file <消息文件路径>` 和 `--model-receipts-dir <回执目录路径>`，路径有空格时加引号。仅提供非敏感路径；不要传凭据或配置内容。相对路径以运行命令的工作目录为基准。工具不推断启动脚本默认值、不寻找配置，参数声明不代表服务实际采用了这些路径。

- `not_configured`：该参数未提供。
- `path_missing`：声明的路径不存在。
- `check_failed`：类型不符、无权检查或其他元数据检查错误。
- `configured_path_exists`：声明与预期路径类型存在；不验证文件格式或目录内容。

退出码：0 = 两项声明路径类型均存在；2 = 有未提供/不存在项；1 = 检查或参数错误（优先于缺失项）。**0 不表示 ready**；`runtimeReadiness` 始终为 `unknown`。stat 跟随符号链接，仅反映检查时刻目标的状态，不证明实际使用、可写、重启恢复或生产就绪。

## 三种来源的证据边界

| 来源 | 本工具证明 | 未证明 |
|---|---|---|
| 消息持久化 | 显式消息文件路径存在且为文件 | SQLite 格式、服务使用、历史内容、重启恢复 |
| 模型回执 | 显式目录存在且为目录 | 回执完整性、未知围栏、费用账本、实际持久写入 |
| 业务事件 | 不检查，明确 `not_checked` | PostgreSQL/outbox、权限、游标、跨页完整性 |

工具只调用路径 stat，不读取 `.env`、进程命令行、凭据、文件或目录内容；不输出路径与底层错误文本，不创建待检路径，不连接数据库或启动服务。

## 验证

环境 Node v22.23.1。命令：

```powershell
node --test Back/Edge/test/v04-readiness-check.test.mjs
```

退出码 0；5 tests / 5 pass / 0 fail / 0 skip。覆盖缺参不探测、真实临时文件与目录、路径类型错误、不存在、检查前后目录与内容不变、输出脱敏、非法参数及真实 CLI 缺参退出码。

EACCES/EPERM/EIO 使用注入的 stat 失败模拟，未修改系统 ACL，不声称真实权限环境测试通过。测试只创建并清理自身临时目录。未执行业务全套、真实模型、数据库检查或重启恢复；这些留待串行集成。

新增文件仅：`Back/Edge/scripts/v04-readiness-check.mjs`、`Back/Edge/test/v04-readiness-check.test.mjs`、本报告。无后台服务，无 commit/push，无协调消息。
