/goal

在 C:/Users/22673/Desktop/JW 完成一个串行后端切片：既有decisions接口显式区分下一步行动与条件化未来状态预测。先做本切片，其余共享五专业任务排后；不新增任务或并发writer。依据当前AGENTS，稳定多文件后端功能由ZCode实施，CTRL独立验收及执行真实模型；FRONT独占前端。

## 文件 ownership

仅 Back/Edge/src/assistant-decisions.mjs、assistant-model.mjs、decision-feedback-store.mjs及其相关定向测试。必要的提示词版本标识可在既有定义处更新，记录原因。不要改Back/B transport、A正式业务、Front、运行配置、账本或历史回执。保留他人修改；交回释放ownership。

## 最小契约

- 保留GET/POST assistant/decisions及feedback地址。分析POST追加taskKind枚举 `next_action | path_forecast`，缺省next_action。未知值400且零模型调用。
- GET保留当前最新结果；latest与pending追加taskKind，历史缺字段按next_action投影，不能回写历史。前端按返回kind筛选，问题文本不能证明任务类型；本切片不扩成多种任务各自独立仓库。
- taskKind进入新请求摘要、冻结decisionTask、pending和最终set；不改变租户/客户/本人/助手隔离。相同operationId换kind必须幂等冲突；同scope已有未知pending时，无论换kind还是operationId均不得重发。
- 旧回执/事件的哈希算法保持可核对，缺kind按next_action兼容，不因升级重复出站。反馈仍绑定decisionSetId与当前证据；复用反馈须同时匹配question和taskKind。

path_forecast专用模型指令与输出：

```json
{
  "decisions": [{
    "id": "branch_1",
    "label": "可能进入补证后复核状态",
    "impact": "条件成立后的预计变化及下一步核验动作",
    "confidence": null,
    "evidenceRefIds": ["本次真实片段ID"],
    "forecast": {
      "targetState": "待补证后复核",
      "conditions": ["补齐列明资料并由有权人员核验"],
      "horizon": "下一次办理步骤"
    }
  }],
  "observations": [],
  "questions": []
}
```

- next_action保持现有契约。path_forecast返回的每个候选必须含完整forecast对象；缺目标/条件/时间范围、空字符串、超过现有长度边界或无有效引用则拒绝为有效预测，不降级成预测。条件最多5项、每项240字符；targetState≤240，horizon≤120。
- 预测是条件化辅助判断，不能断言批准、签约、补件已经发生；不得制造已走事件。label应为未来可能状态，而非“核验某资料”动作标题。系统固定“仅给行动建议”的旧指令须按kind分支，不叠加互相矛盾要求。
- 返回confidenceKind继续为model_estimate_uncalibrated。分数是当前证据对条件化判断的支持把握，不是发生概率、违约率或经校准置信度。provider仍真实GLM，不冒称Jev服务；没有计算则返回空候选/待评估，不填展示数字。
- 服务器返回taskKind证明使用了哪类任务契约，不证明预测正确；语义仍须CTRL读真实输出验收，不能单靠JSON合法宣布通过。

## 验收与交付

定向覆盖：旧客户端next_action兼容；未知kind零发送；同operationId跨kind冲突；未知pending跨kind不重发；两类反馈不混用；forecast缺字段/伪引用拒绝；合法预测保留结构；材料变化失效；撤权拒绝。隔离单测不冒充真实模型质量。

不要自行调用付费模型或重启共享服务。交回变更、测试退出码、请求/响应示例及ownership释放。CTRL随后只对一例真实GLM路径预测作独立验收，通过后FRONT接画布；已存的v03-textile-policy-path-001仅是行动建议，不升级标记、不改历史。
