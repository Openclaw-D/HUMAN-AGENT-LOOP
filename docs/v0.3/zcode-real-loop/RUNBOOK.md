# V0.3 zcode-real-loop · RUNBOOK（启动 / 复验 / 恢复）

执行：ZCode · 2026-09-20 · 范围=原材料驱动真实模型业务闭环验收切片（首次回租准入+预评估内）。模型 authority=none；禁 worktree/未授权 commit/push/部署——本轮均未做。

## 1. 启动入口（隔离真实栈，与共享栈完全隔离）

```bash
# 0) 生成/合并运行配置（模型 transport 取自 b-config.json 单密钥源，不回显；
#    allowedHashes=178 条获准合成材料；账本与共享栈并集合并=预算延续不清零）
node Back/Edge/scripts/zloop-prep.mjs

# 1) 装配并启动（独占容器 jw-zloop-pg@15474；A 48304 / Connectors 48284 / Edge 48324；
#    幂等，可重复执行；启动后脚本退出，守护进程留存）
node Back/Edge/scripts/zloop-up.mjs

# 2) 验证
curl http://127.0.0.1:48324/healthz/ready        # 全依赖逐项 ok，assistant-model=real glm-5.2
# 页面主入口：http://127.0.0.1:48324/  ← Front/dist 同源托管（业务/信审/商务/资产角色可进入）
```

停止（多证复核，只停本路）：

```bash
node Back/Edge/scripts/zloop-down.mjs             # 停 A/Connectors/Edge，保留数据卷与全部记录
node Back/Edge/scripts/zloop-down.mjs --with-db   # 另停容器 jw-zloop-pg（卷 jw_zloop_pgdata 保留）
```

## 2. 复验命令

```bash
# A. 离线回归（零模型调用）
node Back/Edge/test/run-all.mjs                    # Edge 138/138
cd Back/B && npm test                              # B 110/110
node Back/Edge/test/serial-remainder/full-chain.e2e.mjs   # 隔离全链 24/24（本地替身）
node Back/Edge/test/serial-remainder/bench-30.e2e.mjs     # 30次分相+防重发专项

# B. 后端真实模型冒烟（1 次真实调用，账本记账）
node Back/Edge/scripts/zloop-smoke.mjs             # A登记→Connectors上传→Edge decisions→GLM 候选
                                                   # → docs/v0.3/zcode-real-loop/evidence/smoke-result.json

# C. 页面人工复验（对应本轮页面验收，≈10 分钟）
#   1) 打开 http://127.0.0.1:48324/ → 业务 → 新建客户（或选已有客户）
#   2) 补充材料 → 页面上传 docs/materials/kashgar-demo-v1/KS-LASER-500/originals/D01、D02（单件≤512KB）
#   3) 等"材料清单"显示两件已登记 → 助手区切"信审" → 给我建议 → 10–60s 出候选（置信度降序+未校准声明）
#   4) 点选任一候选 → "你的选择·已记录" → 更新建议 → 新一轮（明示已参考反馈）
#   5) 刷新建议 → 观察面板提任意问题 → 获取模型观察 → 展开"查看引用片段"核对原文
#   6) 复验状态核对：
node -e "const fs=require('fs');const d='Back/Edge/.run/zloop/model-receipts/receipts/';console.log(fs.readdirSync(d).filter(f=>!f.includes('intent')&&!f.endsWith('.claim')).length,'terminal receipts')"
docker exec jw-zloop-pg psql -U jw -d jw_zloop_a -tAc "SELECT count(*) FROM credit_facilities"   # 0=模型零写
```

## 3. 本轮修改/新增文件（全部 Git 在制，未 commit）

| 文件 | 变更 |
|---|---|
| `Back/Edge/test/serial-remainder/full-chain.e2e.mjs` | 删恒真断言→三条真断言（引用绑定/伪造降级/逐条校验）；`maxContextChars:12000` 对齐真实部署（修复随机 evidenceId 排序导致的装包漂移）；出站 brief 全文留档 |
| `Back/Edge/test/serial-remainder/bench-30.e2e.mjs` | 桶拆分 first/independent/replay；窗口分列；timing_scope；tokens 不补数 |
| `Back/Edge/src/server.mjs` | modelOptions 增 `maxContextChars:12000`（TEC-CTX-1 出站上限对齐；单处 1 行级改动） |
| `Back/Edge/scripts/zloop-prep.mjs` | 新增：运行配置/材料白名单/profile registry/账本并集合并（密钥零回显） |
| `Back/Edge/scripts/zloop-up.mjs` | 新增：隔离栈装配（预检→PG→迁移→播种→A→Connectors→Edge→ready 报告） |
| `Back/Edge/scripts/zloop-down.mjs` | 新增：本路多证复核停止 |
| `Back/Edge/scripts/zloop-smoke.mjs` | 新增：后端真实链冒烟 |
| `docs/v0.3/zcode/serial-remainder/REPORT.md` | 追加定向复核五项整改轮记录 |

## 4. 遗留问题

1. **unknown 恢复路径缺产品化入口**：发送后未知按设计不自动重发、pending 永久锁定该客户×助手作用域；当前无"人工核对后放弃该次操作"的受控命令（页面"核对本次运行回执"只读）。需要 CTRL 冻结和解策略（例：显式 abandon 事件+审计）后再补。
2. **看板格子状态**：材料已登记但二十格保持"未开始"锁——格子驱动来自 A 准入评估链（需求登记→评估→确认），本切片未做；属既有 TAKEOFF 链（T09 已验），非本切片范围。
3. **页面文件上传自动化**：IAB 浏览器自动化不支持文件选择器；本轮上传经真实 Connectors API。页面手工上传入口存在，复验见 §2-C-2。
4. **budget 从 unlimitedTotalCost 回钉 196 元**：检测到共享 b-config 在本轮执行期间被并行方改为 unlimitedTotalCost；本路运行配置钉回用户授权包络。共享栈配置归属方需自行裁决。
5. **跨进程账本为并集近似**：prep 时与共享账本并集合并，两栈并发窗口内的条目要到下一次 prep 才合并；真实计费以智谱控制台为准。
6. **AI 判断质量未测**：本轮验证链路与纪律（引用绑定/当前性/零写/unknown），非模型准确率；三臂人工基线未测，不报提效。
7. **内网 V4 Flash / Qwen3.8**：统一 profile registry 已保留（`.run/zloop/model-profiles.json`，激活接口 `POST /api/jw/v2/admin/model-profile/activate`）；内网接入未验，GLM 通过≠内网验收通过。

## 5. 恢复方法

- **进程崩溃/重启机器**：重跑 `zloop-up.mjs`（幂等；容器/卷/库/账本/回执/反馈全部保留）。
- **Edge 双开保护触发（exit 23/24）**：按 edge-stop/zloop-down 先受控停本路，再 up；勿杀未知进程。
- **配置损坏**：重跑 `zloop-prep.mjs`（从 b-config/takeoff-runtime 重新生成；账本并集保留）。
- **回执/反馈为一次性证据**：不要删除 `Back/Edge/.run/zloop/`；备份=整目录复制（含 model-cost-ledger.jsonl、receipts/、decision-feedback/）。

## 6. 复验前必读：源码漂移

2026-09-20 23:30–23:32 有并行 writer 修改 assistant-model/assistant-decisions/decision-feedback-store（本路栈启动之后）。复验本切片请先 `git diff` 核对这三个文件与 `zloop-down.mjs && zloop-up.mjs` 重启栈（重启即加载当前盘上代码）；若行为与本 RESULTS 不符，以"重启后实测+本报告时间戳"对照定位漂移责任，不默认本报告失效。
