# UI R5：入口具象化与流程扫描

2026-09-20。范围：Front 入口、六助手、材料全景/补充材料/原件预览、格子详情、角色流程、时间轴、方案面板。原有用户浏览器 viewport、缩放与响应模式保持不变。未改后端契约、授权、业务状态或正式决定。

## 本轮已实施

- 六助手改为纯图标入口：皇冠、尺子、盾牌、合同、钻石、见微眼睛；保留 aria-label、悬停说明、选中状态和长按 @ 行为。
- 补充材料、材料导航、上传入口使用牛皮纸；材料列表/画布/原件标题按类别统一，流水与账表用账单、合同用签字文件、主体登记用证书、设备与生产库存用齿轮卡尺。类别判定仅用于图像展示，不修改服务端证据分类。
- 核验/分析/方案/结果操作、角色流程首尾、时间轴类别沿用同一对象体系。
- 补件抽屉将上传操作放在已收到材料之前；处理进展默认折叠。材料种类保留可读文字，切换类型同步改变对应图像。未把缺少授权的上传按钮改成可用。

## 按重要程度排列的后续工作

| 优先级 | 当前证据 | 必须达到的交互 |
| --- | --- | --- |
| P0 | 真实政策角色/棉纺客户已有原件和完成任务，但上传仍禁用。ChannelCard 只在本组件接受邀请后存 invitationId，重新打开不能恢复。CTRL核查当前没有授权绑定恢复读面。 | 后端提供基于当前用户与客户的有效 upload-context；前端读取并显示具体连接原因。不能用任务完成或旧 ID 猜授权。见 ../ZCODE_REAL_MODULE_HANDOFF.md。 |
| P0 | 助手已有 GLM 建议，矩阵仍全部未开始；建议与共享专业结果尚未接成同一办理链。 | 材料→真实分析→人工核验→真实结果闭环；不得将助手建议直接标成专业办结。 |
| P1 | 窄窗口仍将1920逻辑画面整体缩小，文字/图标/点击目标过小。 | 前端内容随宽度重排：主操作可见、右侧按需展开、保持可读尺寸；不改变用户浏览器 viewport 来掩盖问题。 |
| P1 | 办理/需求/建议/待办分散，锁格提供入口但不形成连续下一步。 | 每步只保留一个明确主要动作，完成后给出实际可做的下一步；保留必要人类确认。 |
| P1 | RoleFlow 仍是固定五条泳道；JEV 当前只有下一步核验建议，没有未来状态预测。 | 已走路径＋眼前可选分支逐步展开；预测须依赖结构化 forecast 契约，证据不足明确显示，不能重命名现有行动建议为预测。 |
| P1 | 时间轴有真实事件，但右侧没有贯穿各步的完整决策记录。 | 清晰记录材料、Agent建议和依据、人类选择、执行者、回执、下一步；展示可审计摘要，不虚构模型内部思考。 |
| P2 | 补件抽屉仍把提取记录与原件混排、泛称客户材料，材料全景已能区分并显示文件名。 | 统一材料读模型和文件名；原件与分析记录一致区分，取消重复表格。 |
| P2 | 刷新页面重新回到角色入口，丢失所在客户和阅读位置。 | 在有效授权下恢复业务上下文；会话失效仍清理敏感内容，不绕过登录。 |

## 验证

- typecheck、生产 build 通过；主改动全套129项测试通过，后续时间轴图标改动再做对应视觉工作区行为测试。
- 在真实48214服务打开政策角色与棉纺客户，核对六个图标及实际建议；补充材料抽屉的上传区域已位于材料表之前，处理进展默认折叠。
- 切换材料类型到购销合同，对应图标成功加载；整个过程未上传额外材料、未调用新模型或伪造回执。
- 模型/上传/五域办理端到端尚未通过，此次不能称系统稳定或全量流程完成。

## 新素材

由内置 imagegen 生成并保留 alpha，无 CLI fallback。保存路径：

- Front/preview/public/objects/statement-v1.png
- Front/preview/public/objects/license-v1.png
- Front/preview/public/objects/equipment-v1.png

最终公共提示词：Create ONE isolated tactile 3D toy-like UI icon on genuinely transparent alpha background. [SUBJECT] Premium restrained iOS-style physical materials, softly rounded, clear silhouette at 48 pixels, front three-quarter view, soft studio light. Center object filling 82% square canvas. No background, floor, scene, extra items, caption or frame around image. Match champagne brass, pale silver, cream paper and petrol blue family.

SUBJECT分别为：

- A cream paper bank statement with simple teal transaction rows and two small stacked gold coins, no readable text or digits.
- A single cream framed business certificate, embossed gold circular seal and restrained deep blue ribbon, no words, letters, numbers.
- A small blue industrial gear and brushed steel vernier caliper together, representing factory equipment inspection, no words or digits.
