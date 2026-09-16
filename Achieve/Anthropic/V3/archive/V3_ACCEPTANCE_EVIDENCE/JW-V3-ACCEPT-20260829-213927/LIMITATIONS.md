# V3 Demo Limitations

- 本证据只证明比赛 Demo，不证明 production readiness。
- Authority runtime 为进程内内存实现；重启服务会回到固定合成 Scenario。
- 已验证 fresh reset 后三轮结构一致，但尚未实现从 Event Ledger 单独重建全部 Projection 的 event-only replay comparator。
- KPI 为比赛用受控预测/运营投影，不代表真实已实现利润。
- 模型候选 authority=none；未配置 live model 时不冒充真实模型调用。
- 未执行部署、真实内网接口、真实客户数据、生产权限或生产安全认证。
