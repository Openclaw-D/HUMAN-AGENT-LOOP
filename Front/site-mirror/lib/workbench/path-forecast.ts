// One question identity: ordinary next-action suggestions must not be relabeled as forecasts.
export const PATH_FORECAST_QUESTION = '基于当前已读取的客户原件，预测这个客户接下来可能出现的业务状态与办理路径。给出3至5个有证据支持的可比较候选：label写未来可能状态，impact简短写触发条件、预计变化和下一步核验动作；confidence仅表示当前材料对这条判断的支持把握，不是违约率或经过校准的发生概率。证据不足时明确待核验，不得假设批准、签约或材料已经补齐。只引用本次实际读取的原件。';

export const PATH_EVENT_NAMES: Record<string, string> = {
  customer_created: '客户建档', artifact_registered: '材料已收到', artifact_processing_updated: '材料处理已更新',
  artifact_superseded: '材料已更新', assessment_created: '预评估已建立',
  admission_request_updated: '需求已登记', assessment_basis_revised: '评估依据已更新',
  domain_result_recorded: '专业意见已登记', package_frozen: '本次依据已保存',
  assessment_candidate_ready: '建议方案已生成', assessment_candidate: '建议方案已更新',
  assessment_submitted_for_review: '已提交人工复核', preassessment_confirmed: '预评估已确认',
  assessment_decided: '本次办理已结束',
};
