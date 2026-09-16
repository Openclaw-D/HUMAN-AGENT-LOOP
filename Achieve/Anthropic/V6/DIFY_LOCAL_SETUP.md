# Dify本机兼容环境｜2026-09-12

## 目标与当前状态

用户确认以本机Dify 1.13.2进行六角色协作编排验证，对齐历史记录中的公司内网版本。现有1.16.1保留，不对其数据库执行向下迁移。此文是环境记录，不是产品后端改造完成声明，也不是公司内网部署授权。

当前：Docker引擎恢复成功；独立1.13.2启动检查exit 0。11个长运行服务已运行，初始化权限服务成功退出；数据库、Redis、sandbox健康。`/install` HTTP 200，Chrome实际打开简体中文管理员初始化页；API容器pyproject和Web容器package.json均实读1.13.2。`/console/api/setup`为not_started，因此应用尚未初始化到可编排状态。已向用户请求是否创建本机测试管理员，尚未获答复；没有擅自创建账户。无模型凭证录入、无真实模型调用、无新任务代发。

## 路径与隔离

- 原环境：`C:\Users\22673\Documents\Codex\2026-09-03\b-wo\work\dify\docker`，Compose项目`docker`，源码和镜像1.16.1。保留原配置、容器及数据。
- 新环境：`C:\Users\22673\Documents\Codex\2026-09-03\b-wo\work\dify-1.13.2-local\source\dify-1.13.2\docker`，Compose项目`jw-dify-1132`。
- 官方源码归档SHA256：`9CE2728D16F21A67CCEE20672B2A3224F271326971C0D3E8614F2CB7B73B7EC5`；归档来自官方1.13.2 tag。
- 新数据目录均位于新环境的`volumes`，不挂载原数据库、知识库或应用存储。
- `compose.jw-local.yaml`仅为本机覆盖：只开放`127.0.0.1:8132`，关闭插件调试端口公开映射；启用服务的restart为no，不新增Docker启动后的自动启动行为。
- `prepare-local.ps1`从官方示例生成新`.env`；内部服务随机凭证只写入受当前Windows账户ACL保护的本地文件，不输出、不写入项目仓库。此文件不是用户模型密钥录入器，不宣称采用DPAPI加密。
- 新增同目录上两级的`Save-ModelCredential.ps1`供用户手动运行：隐藏输入、Windows用户绑定DPAPI加密保存到本机JW凭证目录，拒绝覆盖已有凭证。当前只做语法检查，未读取或保存真实密钥；它不会自动配置Dify或发出API调用。

原环境启动后实测Windows空闲物理内存约325MiB；核对16个容器均属于原Dify Compose路径后，用原项目的`docker compose stop`暂停，未remove/down/delete。两套环境不同时运行。

## Docker启动修复

故障顺序：原run目录的sailor-ingest.sock重命名失败；首次隔离后，docker-secrets-engine目录的engine.sock重命名失败。后者目录核对只有一个零字节通信文件。不存在已证明的数据损坏或Dify版本原因。

可恢复隔离目录：

- `C:\Users\22673\AppData\Local\Docker\run-before-jw-repair-20260912-215953`
- `C:\Users\22673\AppData\Local\Docker\run-before-jw-repair-20260912-220301`
- `C:\Users\22673\AppData\Local\docker-secrets-engine-before-jw-repair-20260912-220301`

每次移动前验证绝对目录、运行进程和内容；原样保留，未删除。恢复后`docker version`取得实际Server版本29.7.2，Docker正常主窗口出现。属于本机启动恢复已验证；造成旧通信文件不可访问的更底层原因未定，不能声明Docker上游缺陷已修复。未恢复出厂、未上传诊断包。

## 操作与恢复

在新环境目录运行：

```powershell
docker compose --project-name jw-dify-1132 -f docker-compose.yaml -f compose.jw-local.yaml up -d --wait --wait-timeout 180
docker compose --project-name jw-dify-1132 -f docker-compose.yaml -f compose.jw-local.yaml stop
```

若要恢复原环境，先停止新项目，再在原环境目录运行`docker compose --project-name docker -f docker-compose.yaml start`。这只恢复旧容器，不降级、迁移或重新创建数据库。Docker运行目录备份仅供诊断恢复，不要把遗留socket复制回正在运行的Docker。

## 后续验收，不提前声明

1. 容器就绪、只监听本机端口、HTTP页面可打开，前后端实际版本为1.13.2。
   - 已通过上述环境门；新项目12个服务定义的挂载路径、本机端口、自启动关闭和.env ACL保护均独立断言通过。
2. 管理员初始化由用户决定账户信息；不自动创建账户、不猜密码、不搬原身份数据。
3. 模型凭证安全录入后，验证模型与资源抵扣；用户允许一批约30万至50万tokens，以50万为预算上限而非消耗目标。
4. 角色与编排开发仍需有界任务包及写面交接；产品代码归ZCode，Codex负责需求、Dify可视核对和独立验收。同一DSL每次单writer。
5. 可迁移性必须由导出、无凭证扫描、另一个干净同版本实例重新导入运行证明；不能只凭文件存在宣布通过。目标包包含DSL、依赖版本/必要离线插件、合成用例和重新绑定说明，不含真实客户、模型密钥、本机数据库或整个Docker镜像。

官方证据：[Dify 1.13.2发布](https://github.com/langgenius/dify/releases/tag/1.13.2)、[该版本DSL导入导出](https://github.com/langgenius/dify/blob/1.13.2/api/services/app_dsl_service.py)。支持YAML导出/导入并检查依赖；知识库等环境绑定、插件和内网权限仍需单独核对。

## 编排准备与验证边界

`V6/DIFY_BOOTSTRAP/connectivity.workflow.yml`是用户授权的初步接入配置，仅三个技术节点，明确无模型推理。用实际1.13.2 API容器的Start/Code/End节点schema验证通过，内含确定性代码7个合成输入用例通过，外部模型调用为0。尚未管理员初始化，故实际Dify导入、sandbox图执行和再次导出均NOT TESTED。它不是六角色成品，也不是新的预设业务演示。

新版方案和ZCode有界任务已写入DIFY_SIX_ROLE_PLAN.md与ZCODE_DIFY_SIX_ROLE_EXECUTION.md，已同步主要authority入口，未代发；当前首关为精确接口/写面/基线，不能跳过重大改版Gate。
