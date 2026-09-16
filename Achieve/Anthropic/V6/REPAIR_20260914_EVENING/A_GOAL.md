# A：共享状态与最终集成
先读COMMON.md。Goal：让固定演示与远程尽调共享同一演示项目事实，并集成B/C页面，首次完成可操作闭环。
写面：本目录main/**；baseline硬门满足后唯一写site产品及预览白名单。其他路目录只读。你不是唯一工作者，不回退别人修改。
输入：旧main/RESULT与INTEGRATION_LOG、story/CORE_MAPPING、qa/RESULT、现有store/remote-store/demo-story-service及相关路由；旧报告不覆盖COMMON。
执行：先交BASELINE_GATE.md和INTERFACE.md；保留JSON存储，不做新平台。设计稳定project/session/evidence关联和命令提交规则；对跨存储部分失败给恢复策略和测试，不把两次独立写当事务。将纠正、补充、复核产生的版本与受影响域投影到首页。当前步用稳定标识记录，避免展示文案变化导致free。重开仅当前专属演示，保留其他会话及真实记录。尊重人工拒绝/未解决，不用结清强迫成功。
接收B/C候选时逐项映射R-01至R-08；仅可做兼容集成修改，不随意放弃页面要求。断开真实模型仍可用合成输入走相同后端；不调用付费API。
证据：独立合成案例从首页进入尽调→新增证据→纠正→旧意见待复核→相关四域同步→刷新/返回一致→重开隔离；并发重复请求和故障中断恢复测试。运行相称typecheck/lint/build。
交付STATUS、BASELINE_GATE、INTERFACE、ADOPTION、RESULT，实际URL/hash/恢复方法和未完成项。最多R1/R2批量修复，不对候选自测直接放行。不自行改变审批/材料/业务规则。
