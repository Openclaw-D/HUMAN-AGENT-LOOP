# 任务04（合流集成）· board-round-02 · INTERFACE_REQUESTS（终版）

本文件只登记本路对外接口请求与对收到的反向请求之回应；不写入其他路文件、不改 Back/CONTRACT.md（03 维护）。

## IR-R2-04-1（对任务02 · 已本侧实现，已真实栈验证）可信调用上下文的 Edge 侧落地形态 ✅

- Edge 转发附加服务端派生 `x-jw-actor-principal/roles`（浏览器同名头不透传）；6 个人工动作路由转发前以会话 principal **覆写** body actor 字段（correct-fact→correctedBy、manual-entry→enteredBy、pause→actor、questions/verify→verifiedBy、questions/answer→answerer、customers/link→requestedBy）。
- 页面旅程实证：回答/转录/复核/映射登记留痕全部为会话 principal（biz1），与 02 的 token→调用方绑定语义（gateway_delegated）吻合。02 的"header 存在性不构成信任"立场不受影响——授权仍靠绑定+逐资源预检，头仅留痕。

## IR-R2-04-2（对任务01 · ✅ 已由 01 交付并页面验证）统一上传路径收敛

方案 R 页面收敛已落地：材料页唯一入口「材料提交与处理链」，A 直传表单移除，未绑定时诚实阻断不降级。旅程步骤5 单次上传直达处理链并 A 自动回写。唯一遗留=IR-R2-04-5 的绑定状态显示缺口。

## IR-R2-04-3（对任务01 · 页面消费语义）blocked_*/aRegistered/Gate 呈现 ✅（本轮页面已如实显示）

Edge 读面 JSON 原样透传；页面本轮如实呈现了 Gate：NEEDS_EVIDENCE（非通过状态）、决策未就绪、任务失败码等，未见吞没。

## IR-R2-04-4（对任务03 · 未获回复，本路按标注启用并如实登记）必需域政策受控入口

本路已实现入口（delivery-up §5.5：配置显式声明+annotation 强制含"非公司制度（演示）"或"经公司批准"才播种 domain_requirement_policies 并透传 --required-domains-policy）；验收配置声明 `domreq-acceptance-synthetic`（四域全必需）。03 请复核：①入口是否符合受控初始化要求；②政策位内容属演示标注、真实政策须另行获准录入。未获确认前该政策位仅用于合成旅程（本轮即如此，已全程标注）。

## IR-R2-04-5（缺陷移交 · 对任务02+01 · OPEN）D-R2-14 通道绑定状态不可见

`GET /api/connectors/processing/status`（statusForCustomer）不含绑定状态 → 前端重进材料面板误显"通道未绑定（上传暂不可用）"并禁用上传；服务端绑定真实存在。请求：02 在 status 载荷增加绑定事实（如 binding:{invitationId,status,role}，不破坏既有字段）；01 由服务端事实推导绑定显示并解除误禁。过渡绕行（本轮采用）：重发通道邀请+接受（同一单一路径）。

## IR-R2-04-6（缺陷移交 · 对任务01 · 低）D-R2-15 受限邀请列表滞后

兑换后列表行仍显示"有效"（API 已返回 used+usedPrincipalId），整页刷新才出现「撤权客户身份」。请求：邀请列表随 SSE/面板重进刷新。

## 收到的反向请求之回应（对 02 两条，均已闭环）

1. blocked_* 原样透出：Edge 读面 JSON 全文透传（本轮核对无字段裁剪）+ 页面已如实呈现。
2. A 原件上传路径收敛：01 已完成（IR-R2-04-2），双入口过渡状态结束。
