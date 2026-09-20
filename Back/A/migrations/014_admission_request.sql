-- TAKEOFF-FA-1.0.0 v2.6 · 首次回租需求登记（契约 §12；Back/CONTRACT.md §13.5）
-- 客户的首次回租需求（产品/申请金额/用途/设备范围）= 评估级客户表述，不是融资申请：
-- 绝不写 financing_requests（正式申请须绑定额度设施，预评估轮禁止）。
-- 只新增列，零行改写；存量评估 request 为空 → 页面按"待补"如实展示。回退 = 保留对象停用入口。

ALTER TABLE credit_assessments ADD COLUMN admission_request jsonb;
ALTER TABLE credit_assessments ADD COLUMN admission_request_revision int NOT NULL DEFAULT 0;
