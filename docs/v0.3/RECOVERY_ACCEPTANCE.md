# V0.3 本地运行栈恢复记录

2026-09-20，CTRL实际执行，依据用户本轮恢复授权。未执行 takeoff-up、迁移、重新播种、付费模型、提交或发布。

## 已核验

- 原容器 jw-takeoff-pg 恢复，原卷 jw_takeoff_pgdata 保留；PostgreSQL接受连接。
- A 48194（PID 22372）、Connectors 48114（PID 30224）恢复；为启动入口增加显式 `--no-migrate`，默认行为不变。Connectors跳过迁移时仍执行 `SELECT 1`。
- 经归属核验，使用现有 edge-stop/edge-start 重载 Edge 48214（PID 19812），复用原配置、账本及存储路径。
- ready 中 kernel-a、db、assistant-model配置、connectors、connectors-channel 全部通过。biz1会话200、客户目录200。模型配置检查不代表模型调用或质量验收。
- 候选反馈专项测试 CTRL 独立执行：5/5、退出码0。

## 证据与边界

本地证据：`.local/v03-recovery/verification.json`、`decision-feedback.log`、各服务日志、`source-hashes.json`；原PID和资源清单备份亦在该目录。资源清单已同步当前PID及marker，不含凭据。

FRONT已接续页面验收，尚未收到最终结果。共享客户目录未找到已登记的KS-LASER-500客户映射；现有合成客户可用于入口验证，不能冒称500万元主案例通过。

Connectors恢复进程尚无常驻心跳维护，现有takeoff-down会因心跳过期保守拒绝。不得为停服务伪造心跳或放宽归属检查；必要停止须重新核对PID、命令行marker和端口服务身份后受控处理。A心跳已有更新。此次没有再次停止服务。

恢复操作未备份被edge-start重置的旧daemon日志；不将新日志描述为完整历史。

## 待验收

ZCode整链和性能仍在产出。其引用断言存在恒真条件、性能分类和计数存在待核问题，见 `ZCODE_SERIAL_REVIEW.md`。执行者通过数不等于CTRL独立验收。
