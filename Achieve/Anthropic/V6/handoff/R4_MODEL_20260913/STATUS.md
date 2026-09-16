# STATUS｜R4 A:验证模型桥真正进入产品(2026-09-13)

**状态:READY_FOR_REVIEW(本批文件自 MANIFEST.json 生成时刻起冻结)。**

- 交付:FINAL_REPORT(结论+缺陷清单)/INTERFACE(桥 delta+接线点)/CHANGE_REQUEST(CR-1..4)/AUDIT_REPORT_R4(PASS-WITH-NOTES)/AGENT_LEDGER;测试 222/222(212 R3 回归 + 6 反例 + 4 回执),退出码 0;冻结核验 runtime/verify/。

- 任务书:`V6/ZCODE_R4_A_20260913.md`;共同契约:`V6/ZCODE_R4_GOALS_20260913.md`(旧 09:00 截止已过,本轮以完成验收或真实阻塞为终点;默认 2 最多 3 子代理,限流降 1/串行)。
- 写入范围:仅 `V6/handoff/R4_MODEL_20260913/**`。产品与 R3 冻结件只读(测试可驱动产品 .ts 桥);基线=R3 拷贝,输入 hash `evidence/r3-baseline-input-hashes.txt`(40 文件)。测试可变输出只写 runtime/。
- 真实模型调用 0;不读凭证;不操作 Codex;无 Git 写/新依赖。

## 接手时的事实基线(只读核对)

1. **产品桥已存在**(MAIN 写):`site/lib/v5-preview/remote-model-adapter-bridge.ts`(459 行,`createBridgedModelAdapter`),包装产品树内候选(`lib/v5-preview/model-adapter/` = R2 冻结版拷贝)为产品 `ModelProviderResult` 形状;**真实接线点** `remote-service.ts:532-575`(UI 追问→simulateFollowUps 内),`domainRoles=['credit','policy','commerce','asset']` 四角色、purpose='follow_up_generation'(桥角色表已显式登记)。
2. **调用点接线缺口(代码级确认)**:remote-service.ts:540 `bridge.generateFollowUps({...})` **未传第二参 stateProbe** → 产品桥 post-await 状态复核(bridge.ts:440-455)在真实 UI 链路上不生效。
3. **MAIN 输入包已交**:`R4_MAIN_20260913/evidence/`(iso-dev-3451.log、iso-runtime-data/、pre-snapshot/)+ `trajectories/`(r4-trajectory-run.json、run-trajectories-service.mts)——R3 批次等待的回执以 integration-inputs 形态存在于 MAIN 批次,R4 回执将引用这些运行包 hash。
4. 产品 store:`remote-store.json` 单文件,V5_PREVIEW_DATA_DIR 隔离;Node 22.23 可直接 strip-import 产品 .ts(已探针验证)。

## 四个点名风险的反例计划(先复现,未复现如实标风险)

| 风险 | 预判 | 验证方式 |
| --- | --- | --- |
| a 会话消失时 snapshot 回退旧 generation 且 paused=false | 代码模式确认存在(bridge.ts:299-301);但会话消失必为一次 store 写入 → version 推进 → contextVersion 变 → 候选 stale 兜底,**预计无实际逃逸**;误归类为 CONTEXT_VERSION_CHANGED 而非会话消失 | 18:慢 transport + 删除会话(version+1)→ 断言未以 ok 返回 + 记录误归类;标风险 |
| b gate 未传(候选预处理人控门在产品桥不可达) | **接口缺口确认**(options/analyze 调用均无 gate);产品层有 reviews/human_verified 等价门,影响有限 | 18:源码断言 + 行为断言(scope 恒 null);CHANGE_REQUEST |
| c partial 优先成功导致 unknown 人控动作丢失 | **预计复现确认**:okEntries>0 → productAction 取成功角色状态(mustHumanVerify=false),unknown 角色只在 failureReason 文字里;且调用点仅 failed/rejected 落失败说明,partial 的文字也被忽略 | 18:双角色(credit 成功 + policy indeterminate)→ 断言 productAction.mustHumanVerify===false(红)→ CHANGE_REQUEST 修法:partial 含 unknown/not_configured 必须合并 mustHumanVerify=true |
| d 多角色结果末尾只核旧 probe | 精确化:产品桥**支持** probe(参数在),但真实调用点不传;桥内部每角色 fresh 快照已覆盖 pre/post 窗口,残余逃逸窗口趋零 → **预计未复现实际逃逸**,标接线不一致(低风险) | 18:源码断言(540 无 probe 实参)+ 桥级行为对照(传 probe 时 post 复核有效降级 rejected) |

## 执行记录

- 15:58 接手;基线拷贝与 hash;产品桥/调用点/MAIN 输入包/共同契约读毕(事实基线见上)。
- (执行中追加)
