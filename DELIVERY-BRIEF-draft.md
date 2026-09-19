# JW 四任务产品交付·根部交付说明

- **身份**：本文件原为合流审计会话草案（2026-09-19）；按任务书《四路唯一修改者》，定稿权属任务04（发布装配 writer）。2026-09-19 由任务04 按 R4/R5 实测结果定稿刷新；逐项证据指针见 `docs/product-delivery/goal-04/TEST_RESULTS.md`。
- **详版**：`docs/product-delivery/round-report.md`（§11 一致性分歧清单 D1–D8、合流风险 R1–R8）+ `docs/product-delivery/goal-04/`（USER_JOURNEY/ACCEPTANCE_MATRIX/TEST_RESULTS/DEFECTS/BASELINE）。
- **基线**：分支 `v02-goal1234-delivery`；`origin/main` 已含 PR#4（b6bea23）。**2026-09-19 合流装配完成**：本轮成果已按路切片提交（`c0ee2ea`=01路 / `d45b03e`=02路 / `c53c6a8`=03路 / `bc81c86`=04路装配），单一固定快照九路回归全绿（`docs/product-delivery/goal-04/TEST_RESULTS.md` R6），分支已推 origin 并开新 PR（base main）。
- **固定快照**：合流回归栈 version-seal buildId `4647b2ef388bc085`（gitSha=bc81c86，`evidence/d4-merge/probe-edge-versionz.json`）；D3 轮参照快照 buildId `521bdc0e2f60246e`（`evidence/d3/version-seal.json`）。

## 一、本轮交付了什么（结论先行）

四路并行完成了"二维页面上，原件到人工决定"的产品化增量，**页面办理主干已通、服务级首件链路全绿、三缺陷复测关闭，但页面层仍有明确 BLOCKED 项，不是全绿交付**：

1. **任务01（A/契约）**：契约 §11 v2.4 加法——客户目录、受限邀请与客户联系人动态身份、材料处理状态权威投影；迁移 009 只增不改。**DEF-G04N-02 A 侧修复**（allowed_kinds 剥 `material.` 前缀比对，`credit.ts` 注释显式标注）+ 终验日志 6/6。
2. **任务02（B/C/Connectors）**：客户原始材料处理链接通 A 权威登记（材料→解析→四域预审→analysis-runs/Gate 回执/findings/回执对账）；解析 v2（引号 CSV/非法日期/**XLSX 专用适配器=DEF-G04N-03 修复**/text-PDF/扫描件人工路线）；测试入口修复。**R4 金丝雀 41/41 全绿**（此前 38/39 两缺陷复现项已随 02 路修复转绿，`evidence/d2/first-file-1789748291415.json`）。
3. **任务03（Front/Edge）**：客户工作本六页签+客户门户+受控登录；Edge 受控身份目录/受限上传/兑换透传/只读面；dist 重建同源托管。
4. **任务04（D/e1/scripts，本路）**：冻结旅程与判据；首件驱动器（12 件真实字节全链）；**R4 缺陷复测关闭轮**（DEF-G04N-01/02/03 全部复测关闭，台账留痕）；**R5 D3 固定快照轮**——version-seal 封存、页面层旅程 J1.1–J1.7 实测（4 隔离会话）、性能 3 轮同环境留证（新工具 `Back/D/product-journey/perf-d3.mjs`）；新立缺陷 **DEF-G04N-04（P1，页面提案链无法绑定依据包）**、**DEF-G04N-05（P2，消息通道对端不渲染）**。

## 二、人现在能做什么、不能做什么（对照任务书共同完成标准）

**能做（R5 页面实测通过）**：受控登录（9 身份目录，无角色下拉提权）→ 业务建客户（零内部 ID）→ 发受限邀请（角色×材料白名单×有效期，code 明文一次、撤销可用）→ 客户邀请码兑换进门户 → 授权内上传真实文件（≤512KB，授权外服务端拒绝）→ 页内留言（服务端回执）→ 查看决策状态/四域/额度（服务端权威投影，未开始不冒充通过）→ 撤销+重发邀请后客户重进数据不丢 → 双客户双会话结构隔离。

**不能做（如实单列，均有缺陷条目与 owner）**：
- **方案→批准→激活全链页面不可达**（DEF-G04N-04，P1）：提案被 A 权威门 409 `BASIS_PACKAGE_REQUIRED` 拒绝（服务端行为正确），但页面不传 `packageId` 且交付运行时无 service 主体可冻结依据包；页面如实显示阻断不伪造成功。owner 03+01。
- **上传后的分段进度推进**：交付形态未接 Connectors 处理链，门户「我的材料」停在「已登记（待处理）」（owner 02/03；API 层全链已通=R4 金丝雀）。
- **页内问答双向可见**（DEF-G04N-05，P2）：双方发送均有服务端回执，但对端页面不渲染。owner 03。
- **原件预览**：等 A 单件读回端点（IR-03-3）。
- 页面层旅程硬门 **D27-L-UI 不判 PASS**（J1：PASS 3 项/BLOCKED 4 项，见 ACCEPTANCE_MATRIX）；反例集页面层、真人试用轮（人证轮）、真实媒体/模型（D27-R）、三维（D27-S）均未发生，不冒充完成。

## 三、合流入 main 前必须裁决/处理的事（2026-09-19 全部已处理）

1. **回归证据 .log 入库方式（R2）✅已裁决执行**：采用窄化负模式 `!docs/**/*.log`（04 路派工授权），救回 196 个证据 log；运行态凭据另加忽略。
2. **任务书包入库（R3）✅已执行**：`JW_product_delivery_four_tasks/` 已扁平化一层入库，六文件 sha256 复核一致，4 处嵌套路径引用同步修正。
3. 根 DECISIONS/CHANGELOG ✅已补任务02/03/04 登记；PR 描述如实列 OPEN（G04N-04/05 修复已交付待页面级复测、IR 遗留、反例集页面层、人证轮、D27-R/S）。
4. ✅已在 PR 分支补跑"单一固定快照"回归（e1 全链+各路默认入口+02 路金丝雀临时段 17943/17945），九路全绿后 push，证据在 `evidence/d4-merge/`。

## 四、怎么跑（最快看到页面）

本轮交付形态（R5 实测命令；凭据/种子为本地合成、Git 排除）：

```bash
# 一键栈：PG(已登记容器只 start)→迁移→矩阵种子→A 内核→Edge --live 同源托管 dist
node Back/Edge/scripts/delivery-up.mjs --db-container jw-g04b-pg --db-port 15452 \
  --kernel-port 48282 --edge-port 17931 --serve-front C:/Users/22673/Desktop/JW/Front/dist
# 浏览器 http://127.0.0.1:17931/  （真实办理→受控身份登录）
# 停止：node Back/Edge/scripts/delivery-down.mjs（三证复核）
```

服务级首件链路（独立验证，不依赖页面）：`node Back/D/product-journey/journey-first-file.mjs`（自管 17933/17935+journey 专用库，用后即清）。端口登记见 `docs/product-delivery/goal-04/BASELINE.md` §5。注意：生产化项（HTTPS/Cookie/限流/凭据存续/Edge 会话持久化）按既定 S3 边界未开工；本机合成环境，无真实客户数据与真实模型调用。
