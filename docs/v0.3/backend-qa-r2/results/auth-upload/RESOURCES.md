# BQA-R2 包01 资源登记（auth-upload）

## 本包创建的容器

| 项 | 值 |
| --- | --- |
| 容器名 | `jw-bqa-r2-authup-pg` |
| 镜像 | `postgres:16-alpine`（本机已有，未下载新镜像） |
| 端口 | `127.0.0.1:25443 -> 5432`（仅loopback） |
| 凭据 | `cnext`/`cnext`，基库 `cnext`（仅本包合成数据，非共享凭据） |
| 创建时间 | 2026-09-21，容器ID `99e25f3dc9a5` |
| 用途 | 承载 `cnext_test_*` 正则约束独立库；每轮测试自建自删，宿主库 `cnext` 中无业务写入 |

## 处置

- 容器保持运行以便 `run.mjs` 重复执行；不可达时 runner 退出码 2 并报阻点（跳过不计通过）。
- 本包只清理自建资源：已核实两轮测试后 `cnext_test_%` 库数为 0（见 REPORT.md 复核记录）。
- 如需移除：`docker rm -f jw-bqa-r2-authup-pg`（仅限确认为本包登记资源后执行）。

## 本包独占写入清单

```
docs/v0.3/backend-qa-r2/results/auth-upload/
├── RESOURCES.md                            # 本文件
├── REPORT.md                               # 结果报告
├── run.mjs                                 # 独立运行器（PG可达性门+测试+退出码）
├── tests/
│   ├── upload-context.pg-bqa.test.mjs      # 真实PG套件（9条）
│   └── upload-context.http-bqa.test.mjs    # 独立HTTP适配器套件（6条）
└── logs/
    ├── sha256-before.txt / sha256-after.txt
    ├── existing-unit-tests.log             # 既有8条单测（未修改，原样运行）
    ├── existing-pg-test.log                # 既有PG测试在本包容器上真实通过
    ├── package-tests.log / package-tests.stderr.log
    ├── runner-console.log / runner-console-rerun.log
    └── blocked.txt                         # 仅当PG不可达时由runner生成
```
