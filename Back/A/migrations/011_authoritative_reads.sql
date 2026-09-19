-- 任务03（权威查询与授权支撑）IR-03-A ②：按客户权威清单（assessments / financing-requests）的
-- 键集分页排序支撑。只新增索引，不新增表/列/数据改写；回退 = 删除索引即可。
CREATE INDEX IF NOT EXISTS idx_assessments_customer_id_desc
  ON credit_assessments (customer_id, assessment_id DESC);
CREATE INDEX IF NOT EXISTS idx_frs_customer_id_desc
  ON financing_requests (customer_id, fr_id DESC);
