# B0 Codex 独立审查

日期：2026-09-06。结论：交付物齐备，现有后端回归复验通过；B0接口候选需修订，不放行B1。

## 已独立验证

- 本轮 npm.cmd test：exit 0，612通过、0失败。
- 本轮 node scripts/v4life-http-quality.mjs：exit 0，27通过、0失败，进程内检查，未启动服务。
- 报告、接口候选、基线清单与六份证据文件均存在。
- typecheck/lint/build为ZCode提供exit 0日志，本轮未独立重跑；协议来源链接存在，本轮未在线逐项复核其版本及能力断言。
- Git状态条目与已知dirty结构相符，但无逐文件执行前后哈希，不能仅凭porcelain证明untracked目录内没有变化。

## B1前需修订

1. 局部纠偏与版本失效冲突：INTERFACE §4承诺未受影响任务继续，但按全局contextVersion较旧隔离全部晚到结果，会误伤未受影响任务。须定义任务输入版本/有效依赖判定，以及新全局版本下旧但仍有效结果的接受条件，补受影响与未受影响对照轨迹。
2. 恢复载荷不足：INTERFACE §4要求全量事件恢复，但合成轨迹的派发仅写packetHash/newPacketHash，未给packet正文或不可变引用的持久化解析位置。须明确冷启动可恢复的完整输入、目标与纠偏依据，哈希本身不能恢复上下文。
3. A2A目标与实现路线未对齐：INTERFACE §0预设Node自实现，§6把wire兼容层列可选；还混用标准任务状态与candidate_ready/superseded等应用状态。须明确协议任务状态、应用结果有效性和Human Gate的独立映射，比较复用adapter/SDK选项；内部API与测试替身阶段不能称完成A2A互通。不因本轮禁止安装就推导长期自实现路线。
4. 合成商务packet写“等待信审/政策Candidate后才能正式化”含糊。Candidate只可支持准备性协作；正式条件必须明确依赖有效Human Decision/Receipt，不能由候选完成解锁。

文档质量补充：BASELINE §4文件数量自相矛盾（当前实际9文件）；共享服务内存/持久配置不能仅凭默认代码约定断言运行现状，应标未核实；“site零写入”缺少hash证据应限定为自报。

当前只是审查状态请求，未向ZCode发送新指令、未修改其交付正文、未放行代码。后续先完成上述候选修订，再处理既定基线及接口Gate。

## 历史证据补充（2026-09-06）

已按用户授权只读核对精选STARS和JW代码/测试，映射见 [HISTORICAL_REUSE.md](../HISTORICAL_REUSE.md)。可复用修订保留、载荷快照、消息去重和零权威写入的测试思路；旧全Context修订不证明局部失效正确、旧快照损坏返回undefined不能照搬、旧A2A compatible subset不等于官方互通。四项问题仍开放。本轮未执行旧代码或触碰ZCode交付正文。
