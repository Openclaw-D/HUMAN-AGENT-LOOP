/goal
任务名：V0.3-Z1-MATERIAL-QA
目标：独立复核合成材料解析缺陷，交付可复现失败用例与精确预期，供 CTRL 后续修复。
项目：C:/Users/22673/Desktop/JW。
只读输入：Materials/kashgar-demo-v1、docs/v0.3/material/REPORT.md、PARSER_PROBE.json、probe-parser.mjs、SCENARIO_MANIFEST.json、GOLD_ANSWERS.json，以及 Back/C/src、Back/C/test 中对应解析代码。先按记录定位流水、PDF中文、XLSX问题，不宽扫历史。不把合成答案当作经业务确认的标准。
独占写入：C:/Users/22673/Desktop/JW/docs/v0.3/zcode/material-qa/ 和 C:/Users/22673/Desktop/JW/.local/v03-zcode-material/。候选测试、最小合成fixture、日志均在这两个目录。不得修改材料原件、Back、Front、公共文档或其他任务目录。
执行：各格式选一个代表反例，记录输入hash和预期字段来源，调用现有解析入口；补正常对照及缺件/不可读输入，区分失败、未覆盖、不支持。测试可用一条命令复跑。不要实施解析器修复，不改变业务标准，不无限扩大覆盖。
验收：保留实际断言、命令、退出码、源码hash、用例数、原始日志；最多列三个主要缺陷。仅测试前后相关源码hash一致时称为本版本证据，否则标记漂移。
交付：REPORT.md、可复跑测试、日志及hash清单；REPORT末尾提供不超过12行CTRL摘要。
协作：你不是唯一执行者。CTRL正修改模型回执和前端观察，另外两任务也并行。只写自己的目录，不回退他人修改。不得commit/push/worktree、付费模型调用、访问真实客户或密钥、共享数据库或现有服务；不启动常驻任务，不联系/唤醒Codex。临时资源仅使用自己创建且确认归属的文件和随机loopback端口，完成后仅清理自己的资源。完成即停，用户手动交回CTRL。
