-- 任务01·A3 提交边界（审核 F04 修复，第二层去重）：
-- 第一层 = requestId 幂等（v2_idempotency）；第二层 = 同一申请同一业务迁移至多一条账目。
-- 状态机（submitted→reserved→committed→disbursed→settled；取消/对账退出均为终局）保证每个
-- (fr_id, entry_type) 业务上至多发生一次；此索引使"加锁前旧快照"类竞态即使逃过状态门也被 DB 拒绝。
CREATE UNIQUE INDEX uq_exposure_fr_entry_once ON exposure_entries (fr_id, entry_type) WHERE fr_id IS NOT NULL;
