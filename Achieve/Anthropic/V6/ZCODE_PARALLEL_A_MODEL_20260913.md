# 并行任务A｜可替换模型适配器与故障验证

先完整读根AGENTS、V6/ZCODE_PARALLEL_20260913.md、V6/ZCODE_REMOTE_DD_REPAIR_20260913.md。你是ZCode独立执行者；其他任务同时写代码，不能覆盖他们的成果。

## Objective / Ownership

交付可运行的隔离模型适配模块与故障测试，帮助主任务从固定问句升级到可接真实模型的结构化调用边界。**只写V6/handoff/PARALLEL_MODEL_ADAPTER_20260913/**；产品文件及其他任务目录只读，不直接接线、不改Dify或凭据。

## 必须实现

1. 采用无新增依赖的ES模块或现有TS runtime。公开接口 `analyze(request, context)`；provider通过注入的transport提供，单一外部provider实例不等于单一角色。六角色职责可配置，但禁止每个事件强制轮转六遍。
2. 独立接口v1最小请求：requestId、projectId、sessionId、generation、contextVersion、role、purpose、evidenceRefs（id/version/hash）及经允许的合成文本。返回显式mode和status、findings/questions/evidenceRefs/error/usage；必须区分not_configured、simulated、succeeded、failed、unknown、stale、cancelled。
3. 验证结构与引用真实存在于本次输入，拒绝未给出的证据、越权批准类输出、无来源事实；验证失败不伪装成功。输出语言中文，role等协议标识英文。
4. 注入AbortSignal/时钟/transport测试取消、超时、暂停generation或版本变化后的迟到结果。外部调用可能已发生时标unknown，不声称取消等于未计费；未知状态禁止自动无限重试。
5. 同请求相同载荷可在本次适配器实例内去重；变载荷冲突。说明持久化幂等和跨进程恰好一次不在本模块保证范围，主业务层负责持久记录。
6. 成本使用独立ledger接口预留/结算/未知保留；缺usage不能记0或释放所有预留。测试上限、并发预留和失败路径，但**本轮不发送真实模型请求**。
7. provider映射最多两种：通用HTTP模型服务、Dify Workflow。可提供可执行纯映射函数与脱敏响应fixture；精确外部格式查官方文档，记录来源/版本。缺服务不声明实际兼容通过。不增加通用Agent平台。

## 故障与验收

每类至少一个独立可运行用例：正常结构、缺字段/空输出、非法角色、悬空引用、重复请求、同ID变载荷、超时前取消、请求送出后unknown、暂停后返回、版本过期、部分失败、usage缺失、预算不足。测试至少能抓住一项刻意注入的坏实现，不能全靠固定成功断言。

不读并行C的golden答案生成模型输入；自备最小合成fixture，后续由主任务组合评估。quality或金融准确率一律NOT TESTED。

交付src/、test/、一次命令可运行的测试、ADAPTER_CONTRACT.md、INTEGRATION.md、STATUS/REPORT/MANIFEST及原始证据。主任务应能在不改变前端调用方式的前提下接入业务服务；明确映射和缺口，不承诺零代码替换。

完成标READY_FOR_REVIEW并冻结交付；不要等主任务或相机任务完成，也不要直接修改他们的代码。全部禁止项遵守并行协调文件。
