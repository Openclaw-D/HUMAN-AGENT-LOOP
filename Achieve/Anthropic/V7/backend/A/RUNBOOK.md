# V7-A RUNBOOK｜最终启动 / 恢复 / 迁移说明（A×B×C 组合，CONTRACT v0.2）

适用：`V7/backend/**` 组合产物（被测版本 = 同目录 `manifest-hashes.sha256`，22 文件）。零 npm 依赖（A/C/thin 编排；LangGraph 候选例外见 §4）。

## 1. 启动

```bash
# 事实源服务（A）：--principal-tokens 为逗号分隔 token 允许列表（合成测试适配；无可信身份源时省略 → 正式动作失败关闭）
node V7/backend/A/src/server.mjs --port 3601 --data-dir <数据目录> --principal-tokens <token1,token2>
# 健康检查
curl http://127.0.0.1:3601/api/v7/health
```

- 端口/目录亦可用 env `V7_A_PORT` / `V7_A_DATA_DIR` / `V7_A_PRINCIPAL_TOKENS`。
- **纪律：一个数据目录只归一个服务进程**；多端（手机/电脑）共享事实 = 连同一服务。

## 2. 端到端复跑（三组，均自包含）

```bash
node V7/backend/A/scripts/demo.mjs http://127.0.0.1:3601     # 服务需以 --principal-tokens demo-human-token 启动
node --test V7/backend/A/test/v7-a-service.test.mjs          # 13/13（隔离临时目录）
node --test V7/backend/A/test/v7-a-http.test.mjs             # 5/5（临时端口）
node V7/backend/A/assembly/integrated-round.mjs <数据目录>     # A×C 全链
node V7/backend/A/assembly/b-round.mjs                        # A×B×C（自起临时端口，finally 自清）
node V7/backend/A/assembly/lg-round.mjs                       # thin vs LangGraph 对比（同上）
node V7/backend/A/assembly/recovery-round.mjs                  # 恢复链：暂停→可信恢复→正式收口（双候选；自起自清）
```

## 3. 恢复

| 场景 | 动作 |
| --- | --- |
| 进程重启 | 直接重启服务；事实/run/幂等回执全部在数据目录，逐命令重读盘天然恢复（D X-3 SIGKILL 实测） |
| 数据文件损坏 | 服务返回 500 STORE_CORRUPT 且**不静默重置**；恢复 = 用备份覆盖对应 `facts.json`/`runs.json` 后服务即恢复正常（D X-10 实测） |
| 编排中断（B） | thin：journal 重放（撕裂尾行丢弃并留痕）；LangGraph：FileCheckpointSaver 落盘重启可续。发送后无回执的模型步 = `unknown`，**不自动重发**；恢复 = `orch.resume(runId, {principalCredential, action:'retry_step'\|'provide_evidence'\|…, stepId?, payload?})`（注入式验证器+授权策略，缺省失败关闭；凭据零落盘）——全链证据 `assembly/recovery-round.mjs` |
| 迁移 | 停服 → 拷贝整个数据目录 → 新机启动。无其他状态 |

## 4. LangGraph 候选（可选对比，唯一带 npm 依赖的路径）

```bash
cd V7/backend/B && npm install    # @langchain/langgraph 0.2.62 + @langchain/core 0.3.68（锁版）
node V7/backend/A/assembly/lg-round.mjs
```

## 5. 身份边界（如实）

- 正式动作需 `principalCredential` 经注入的同步验证器；`--principal-tokens` 是**合成测试适配，不是生产认证**。
- 部署环境无可信身份源时不配置 token → 正式动作保持 403 失败关闭。接入真实身份源（SSO/签名）= 后续授权门，本包不实现。
