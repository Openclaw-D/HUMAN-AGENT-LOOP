# V0.1 首次公开发布范围

2026-09-16。用户明确指定 https://github.com/Openclaw-D/HUMAN-AGENT-LOOP ，并在获知公开可见性及历史记录后要求“全部上传”“全部公开”。首次推送前核实该仓库为空、公开；不需要另建JWV7或第二个远端。

## 两个工作区不混用

- 唯一Git根、提交与推送工作目录：`C:/Users/22673/Desktop/JW`。
- 活动目录为Front、Back；Achieve为保留历史和迁移证据。根部只保留必要入口文档与Git配置。
- `Achieve/Anthropic`是此前从旧项目复制到JW的归档，包含历史版本、早期探索代码和少量研究资料；用户此次全部公开授权涵盖这些已迁移文件。它不是另一个活动项目，不代表历史探索已成为决赛需求。
- 原`C:/Users/22673/Desktop/Anthropic`不作为此次Git根，不新增到此仓库，不更改、不删除；清单中的旧绝对路径只是出处记录。
- 不建立跨目录symlink或submodule；提交文件realpath必须全部位于JW根下。

## 全部上传的工程边界

上传本JW中已选定的前后端源码、锁文件、配置示例、说明、归档和迁移证据。manifest中publish不为false的副本全部纳入Git，并加入新生成的项目入口/验证工具。保留912份原始Markdown及轻量代码。

node_modules、构建缓存、真实凭据、数据库、原始运行日志与临时测试状态不进入Git。31份旧临时状态副本留在本地Achieve/Migration/Local-Test-State供恢复。源目录未迁移的大文件/数据仍按excluded.json记录保留在原处；“全部上传”不是将整个桌面或原Anthropic重新打包。

## 验证与状态读取

首次提交前使用tools/staged-check.mjs检查全量Git暂存文件：blob字节一致、禁止路径、高置信凭据模式、manifest覆盖；结果见staged-check.json。模式扫描未发现匹配不等于证明所有内容不存在敏感信息；本次公开范围由用户明确决定。

首次commit/push后，比对本地HEAD与远端refs/heads/main，并只读核对远端顶层目录。staged-check.json中的commit:false/push:false是检查时点，不是持续更新状态；实际Git状态使用git与远端核验。

本次是源码和资料公开，不部署服务，不承诺前后端已接线、真实模型已验证或遗留缺陷已关闭。现有功能验证与问题仍以VERIFICATION.md和根部README为准。

## 体积标准补充与第二次同步

首次提交d67b940已推送，远端main与本地HEAD核对一致。用户随后明确几十MB资料无需因体积排除，已补回886份历史参考资料；最大单文件约45MiB。原excluded.json为首次筛选快照，补齐后的实际范围见manifest.json与size-policy-supplement.json。补齐内容约823MB（原始文件总和），全部落在JW/Achieve，不从旧Anthropic根直接提交。依赖/临时状态仍排除。

两份内容相同的旧HTML触发Google key模式，独立检查确认命中位于内嵌PNG的base64随机串（PNG签名有效），不是配置凭据。扫描器仅对精确SHA256、位置、长度与图片边界匹配的已核实误报作记录，其余匹配仍阻断；未修改历史HTML原文。

用户进一步要求完整前后端联调交付，当前尚未满足；见DELIVERY_STATUS.md。公开上传资料不等于该功能目标已经完成。
