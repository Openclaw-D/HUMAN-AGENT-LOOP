# V0.3-BACK 阶段交接 · P0上传上下文

2026-09-21。本原Jev任务接续BACK；已核实误建任务只读、零改动并释放ownership，未恢复其执行。用户特殊阶段直接后端授权有效；FRONT独占Front，B及parallel-qa不写。

**状态：P0候选模块与隔离反例完成，未装配，不能称上传恢复完成。**CTRL已明确要求先交本阶段，暂不进入材料、路径或沙盘。

## 已做

- 新 `Back/Connectors/src/intake/upload-context.mjs`：只读联查本人JW绑定及接受邀请，不选择最近邀请；有效唯一才恢复，多邀请、撤销、未验证、过期、身份/租户/客户不符均失败关闭。返回不透明绑定引用及现上传契约必需的invitationId，不返回token或providerUserId。
- 同模块显式代理校验：服务凭据必须配置mayDelegateActor=true及tenantIds白名单；无配置/普通token/跨租户拒绝，不沿用旧默认代理放行。
- 同模块`withAuthorizedUpload`：在事务内以FOR SHARE锁绑定/邀请后复核范围，写回调必须使用传入tx；未接入现有原件对象存储与登记链，不能声称跨对象存储原子性。
- 新 `Back/Edge/src/upload-context.mjs`：候选读适配器要求每次提供独立上传授权结果，读取前后重验会话/客户/上传权；仅从服务端身份和权威tenant派生归属，响应字段白名单。
- 既有外部provider接受邀请流程完全未改；旧记录不自动迁移为JW principal。未创建绑定、延长期限或修改共享业务数据。

## 测试证据

`node --test Back/Connectors/test/upload-context.test.mjs Back/Edge/test/upload-context.test.mjs`

结果：8通过、0失败、exit 0。覆盖刷新/重建service、跨租户/客户/身份、普通token/伪造actor、撤权、期限、多邀请、非法范围、读后撤权和事务回调拒绝。Edge使用真实本地临时HTTP端口，但授权和数据库为明确的合成替身；没有装配共享Edge实例。

`node --test Back/Connectors/test/upload-context.pg.test.mjs`

结果：0通过、1跳过、exit 0；原因：专用测试PostgreSQL默认15443不可达。**跳过不计通过，真实SQL联查和撤权锁竞态未验证。**测试准备好后在专用测试PG环境重跑同一命令，使用CONNECTORS_TEST_PG_*指定独占实例，创建正则约束的cnext_test_*独立库并只清理该库。不读取共享凭据、不启动或停止共享服务。

## 精确授权来源与缺口

1. A已有正式上传写门在 `Back/A/src/domain/credit.ts:397` 的registerArtifact：withCommandV2认证、requireHuman、租户锁/客户范围、customer_identities.allowed_kinds校验。customer角色如为邀请兑换身份受种类限制；既有合成目录身份保留旧行为。这里没有一份可以照搬成Edge角色白名单的统一“允许上传角色表”，不得自行发明。
2. `Back/A/src/domain/v2kit.ts:211` requireHuman按可信principal.kind判定，不是浏览器角色字符串；客户归属还需授权表。核验等级提升的business/policy/credit/commerce/asset/admin列表仅适用于核验等级，不能误当通用上传权。
3. `Back/Edge/src/kernel-store.mjs:521` checkCustomer只GET客户并返回tenantId；无法证明kind=human、上传种类与撤销状态，不能替代上述写门。当前没有已核实可消费的零写上传授权读接口。
4. 建议下一阶段由CTRL冻结A零写上传授权投影，复用原写门而非复制政策；至少返回可信principalId/customerId/tenantId/canRead/canUpload及材料种类限制，原写入继续重验。是否允许邀请兑换前的身份认领，必须复用真实邀请/身份授权证明，不能仅凭任意登录人或浏览器providerUserId认领。
5. 新Connectors代理需显式租户allowlist；既有默认serviceToken没有该限制。共享配置未改。在上述来源和事务整链验证前，不接入公开GET或改既有accept/upload路由。

## 脱敏DTO候选（不是线上响应）

```json
{"ok":true,"customerId":"synthetic-c","available":true,"reason":null,"bindingRef":"opaque-binding","invitationId":"opaque-invitation","allowedKinds":["invoice"],"allowedObjects":[],"expiresAt":"2030-01-01T00:00:00.000Z"}
```

不可恢复时bindingRef/invitationId/expiresAt为null，两个范围数组为空。稳定原因：IDENTITY_UNPROVEN、NO_ACTIVE_UPLOAD_BINDING、AMBIGUOUS_UPLOAD_BINDING、INVALID_UPLOAD_SCOPE。数据库/授权源故障属于服务不可用，不能伪装为无绑定。

## 未做与ownership

未接公开路由、未改A/B既有代码、未改默认测试入口、未调用付费模型、未改服务配置、未重启服务、未commit/push。未进行真实页面上传、旧外部流程回归或真实数据库竞态验收；材料/路径/沙盘均未开始。

本阶段只新增上述两个模块及三个定向测试文件。阶段报告交CTRL和FRONT；本路暂停后续写入等待CTRL收敛上传授权来源，不授权其他writer自动接管共享文件。FRONT暂不能消费为已上线接口。
