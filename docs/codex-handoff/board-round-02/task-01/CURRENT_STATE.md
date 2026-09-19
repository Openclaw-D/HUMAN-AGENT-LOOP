# 任务01（board-round-02）· 业务视角横屏二维作业看板 · CURRENT_STATE

更新：2026-09-20。基线：main@8dcef63（多路 dirty 工作区，未 commit/push/切分支）。
Writer 范围：Front/**（独占 Front/dist、package.json、lock）+ 本文档目录 docs/codex-handoff/board-round-02/task-01/。未写 Back/** 与其他路文件。
前序成果：上一轮 docs/v02-remediation/task-01/ 的六项修复与 51 项组件测试全部保留（openCustomer 统一入口/客户隔离/最近访问分身份/稳定 requestId/错误恢复/引用系统关联），本轮在其上接续。

## 一、本轮已交付

### 1. 业务视角横屏二维看板（customer-workbench.tsx 重构，复用真实工作本与全部既有面板）
- **顶部摘要**：客户名/标识/状态/连接相位/身份；金额摘要分列——「融资申请」「授信额度」「项目采购金额」三行独立，采购金额如实标注"系统未单列采购金额字段，不用授信额度冒充"（deriveBoardSummary）。
- **阶段概览条**（deriveLifecycleStages，纯函数）：商机·建档→尽调·检查→政策·规则→信审·评估→商务·额度→资产·用信→结清·合同 七段并行呈现（不强制流水线、无推进器/连线/概率）。状态全部来自服务端字段投影：商机=客户档案、尽调=检查会话 runStatus、政策/信审=依据包域 currency、商务=设施状态、资产=融资申请/在途敞口；**结清如实标「未支持」**（后端无起租/租后/结清完整能力）。每段带 title 依据说明；灰=未开始/未知，绿=该段有当前产出（≠批准）。
- **主区=当前事项卡**：六张卡（材料·处理/核验/问题·补证/方案·决定/结果·对账/受限邀请），摘要为服务端字段投影（档案件数/通道任务四态计数/核验覆盖/开放问题/依据包+Gate/报告数/在册邀请）。点卡片进入原面板（Originals/Verify/Qa/Proposal/Result/Invitations 原样复用，无第二套状态机），「← 返回看板」回到卡片。
- **右栏按需**：未选中=待办（服务端 next-actions 口径）+四域判定+额度要点；选中事项后切换为该事项的「依据/版本/动作」（如方案页显示依据包修订/版本/Gate 回执与规则包版本）。
- **沟通可折叠**：默认收起为一条栏（显示对客户/内部条数与敞口合计），展开后为原双列沟通（4 秒轮询以服务端线程为权威）；不再固定吃掉半屏。动画仅展开/状态转换，CSS `prefers-reduced-motion` 关闭过渡。
- **身份纪律**：默认业务身份；其他岗位以责任与意见呈现（域意见 authority=none、回答按钮按目录角色禁用），无五身份切换。受限客户门户完整保留（customer-only 会话仍进入 CustomerPortal）。

### 2. 方案R 统一上传链前端消费（任务02 冻结 × 任务04 装配）
- **内部侧（channel-card.tsx 重构为「材料提交与处理链」）**：唯一提交入口=通道面上传（evidence/upload），确认框明示"一次提交进常驻处理链，A 档案登记与运行/Gate 回执由后台自动回写"；**A 直传表单（uploadOriginal）已从 originals-panel 移除**——不再要求用户选 A/Connectors、复制内部 ID 或重复上传。绑定缺失=按钮禁用+诚实阻断说明，不降级。任务表新增 **「A 回写」列**：消费逐任务 `aRegistered`/`bridgeState`；**done 且未回写 A 渲染为「本地完成（未回写 A：不等于全链完成）」**，不冒充全链完成。
- **客户门户（customer-portal.tsx）**：提交改单路径——第一步「关联处理通道（一次性）」粘贴办理人令牌→intake/accept 换绑定；绑定后「提交」走通道面一次提交，材料种类=通道词表（实际范围以邀请白名单为准，服务端强制）；未绑定时提交禁用+引导，不降级走档案直传。
- **blocked/unknown 等待态消费**（wb-logic）：`blocked_link`/`blocked_a_unavailable`/`blocked_unknown` 业务语言文案（"等待映射登记后自动续跑，勿重复提交"）；新失败码 A_CUSTOMER_NOT_IN_A/A_TENANT_MISMATCH/A_UNREACHABLE/A_UPLOAD_PRINCIPAL_MISSING/CUSTOMER_MISMATCH/ROLE_FORBIDDEN/CHANNEL_NOT_CONFIGURED 等映射。
- **同号对账恢复**：useAction 确认框固定 requestId、502 保留确认框"用同一编号重试"纪律贯穿门户与内部上传（组件测试覆盖 502 重试同号）。
- **两路对账合一（result-panel.tsx）**：A 动作回执（A /receipts）+ 处理通道动作回执（`GET /api/jw/v2/connectors/processing/receipts/:requestId`，IR-T01-3 页面面已由任务04交付）同页可查；对账簿未命中时如实指引编号来源（ptx-… 见任务回执对账编号列）；404/503 如实显示"对账口不可用"，不冒充查无回执。

## 二、真实页面验证（合流栈，执行者自验；用户验收待做）

栈：任务04 装配脚本 `delivery-up --config config/delivery-runtime.acceptance.json`（全部合成值），Edge@48210 同源托管新 dist；A@48190 / Connectors@48110 / PG jw-v01-pg@15442。**因原运行实例早于任务02 交付（mtime 核实），经官方 delivery-down（三证复核、数据保留）→ delivery-up 重启加载当前后端**；未修改任何 Back/** 文件。

完整旅程（biz1 + 受邀客户联系人，1440×900 横屏，全部 PASS，证据见 EVIDENCE_INDEX）：
1. 登录→目录→新建客户（一次 openCustomer）→看板渲染（阶段条/事项卡/右栏/收起沟通）。
2. 业务发起通道邀请+受限邀请；客户兑换码进入门户→粘贴令牌绑定→**一次提交**银行流水（requestId 固定于确认框）。
3. 处理链自动推进（解析 4 事实→四域分析→aBridge 回写 A）：任务 `aRegistered=true, bridgeState=registered`；A 档案自动出现原件 material.bank_statement + 派生件 parse_extraction（客户申报=unverified 如实）；门户「我的材料」显示"分析完成"。
4. 业务侧看板卡「档案登记 2 件 · 完成且已回写 A 1」；任务表三态并存（本地完成未回写/重复件已跳过/已回写 A 档案）；任务回执阶段留痕+aOps 对账编号；结果面板通道对账查询 found:true。
5. 同字节重复提交被诚实判重（skipped_duplicate）；结果页未命中编号如实指引。
6. biz1 **退出重进**：以标识打开同一客户，看板/材料/任务全部从服务端恢复一致。

## 三、验证状态（区分层级）

| 层级 | 状态 |
|---|---|
| 代码完成 | 本节"一"全部 |
| 组件测试（jsdom+RTL 用户行为级） | **67/67 通过**（含既有 51 项中的全部有效回归；门户 3 例按方案R契约更新；新增 originals 统一链 3、看板 4、两路对账 3、wb-logic 新投影 3），见 TEST_RESULTS.md |
| typecheck / build | 通过；Front/dist 已用最终代码重建（Edge 同源托管验证生效） |
| 真实页面（合流栈旅程+截图） | 执行者自验 PASS（五张 1440×900 截图入库）；**用户验收未做** |
| 独立验收 | 未做（Codex 复核待用户安排） |

## 四、遗留与边界

- 结清/起租/租后能力后端未提供——看板如实标「未支持」，未用本地状态编造。
- 通道邀请令牌一次性：客户会话失效后需重新取令牌绑定（门户诚实阻断引导）；批量/免重复绑定待后续接口（见 INTERFACE_REQUESTS.md IR-T01-6）。
- IAB 自动化无系统文件选择器：旅程中文件经页面 DataTransfer 注入合成字节（真实 File 对象、真实网络与后端链路）；真人操作用系统文件选择器，不受影响。
- run/gate 回执登记在新任务上 skipped（partial_unlinked_artifacts：旧实例产生的未链接 evidence 与新材料并存）——逐动作语义如实留痕于任务回执；全链门待 Codex 独立验收评估。
