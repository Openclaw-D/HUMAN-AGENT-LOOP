# 任务04（合流集成）· board-round-02 · CURRENT_STATE

更新：2026-09-20 00:55（收尾稿）。基线：`main@8f8d962`（用户 2026-09-19 22:12 方向冻结提交，纯 docs；任务启动时检查为 8dcef63）+ 多路 dirty（快照指纹 `evidence/final-journey-r2/snapshot-fingerprint.txt`，251 文件 sha256）。writer 范围：`Back/Edge/**`、`Back/D/**`、本路文档；上轮成果（`docs/v02-remediation/task-04/`）全部保留。

## 本轮最终状态：固定快照页面旅程已执行——主链 11 步实质 PASS，决定段真实语义 fail-closed

完整结果见 `evidence/final-journey-r2/JOURNEY_RECORD.md`。要点：

1. **上轮步骤5旧缺陷复验通过**：材料一次上传（方案 R 单一入口，A 直传表单已从页面移除）→ 常驻驱动全链处理 → **A 材料登记 done（aRef 留痕）→ 运行/Gate 回执登记 A → 任务 done 且 aRegistered=true**；A 材料清单自动回写。不再出现 skipped(no_customer_link)。
2. **决策链基础设施闭合**（对比上轮 POLICY_PENDING）：必需域政策受控入口（delivery-up §5.5，配置显式声明+非公司制度标注才播种）→ 规则包 1.0.0 经 A 受控激活端点激活（admin）→ 依据包冻结成功（Gate 回执系统关联+四域材料依赖）→ Gate=NEEDS_EVIDENCE（真实规则评估）→"决策未就绪，不提供绕过"。阻断从"基础设施缺失"变为"真实证据不足语义"，未伪造放行。
3. **可信调用上下文落地**：Edge 转发附加会话派生 `x-jw-actor-principal/roles`；6 个人工动作路由 actorField 会话覆写——页面全程留痕均为 biz1（回答/转录/复核/映射登记），浏览器伪造 body actor 与同名头两条路径关闭（单测）。
4. **新路由代理+越权关闭**：receipts 读面（真实回执查询 found:true + 他人 404 语义）、customers/link 受控写面均实际代理并逐资源授权。
5. **负例**：N1 第二客户隔离（页面级）PASS；N2 撤权级联失效（页面级）PASS；N4 材料新增→重新分析+新 Gate 回执+问题生成 PASS（HOLD_FOR_REVIEW 升级子路径页面未复现，组件 L6 覆盖）；N3/N5 页面级 NOT_RUN（机制在位+组件级覆盖，执行中止于收尾）。

## 四路集成状态（本轮冻结快照时点）

- **01（Front）**：方案 R 页面收敛完成（门户/材料页单一上传入口、诚实阻断、行为测试 6 文件）；dist 已重建（22:53，新于源文件）；Front 64/64 PASS。遗留：D-R2-15 邀请列表滞后；blocked_*/aRegistered 呈现按 02 语义核对（本轮页面已如实显示 Gate/等待态）。
- **02（Connectors）**：上轮 IR 全部落地+actor 令牌绑定（goal02-link-chain 6/6、blocked-recovery 3/3、actor-trust 2/2、全量 88/88、Back/C 101/101，均 02 自报；本轮真实栈全链跑通为旁证）。遗留：D-R2-14 status 载荷缺绑定事实。
- **03（A）**：无 round-02 交付目录；上轮权威清单/011 迁移在旅程中实际生效（材料清单/处理状态投影/决策状态消费正常）。IR-R2-04-4（政策入口确认）未获回复——本路按"非公司制度（演示）"标注启用并如实登记。
- **04（本路）**：Edge 增量 72/72 PASS；旅程执行如上。

## 运行资源（自有，留给统一清理）

验收栈**仍在运行**（本路 delivery-up 监督进程）：Edge@48210 / A@48190 / Connectors@48110（库 cnext、对象存储 .run/objects-delivery）/ 消息库与台账见 `Back/Edge/.run/delivery/resources.json`（快照副本 `resources-at-freeze.json`）。停止：`node scripts/delivery-down.mjs`（Back/Edge 下）。另有 48200 端口先前会话遗留 Edge 实例（非本轮拉起，未触碰）。本轮新增自有临时资源：无（PG 库 jw/cnext 沿用既有容器）。
