// 来自已批准的 docs/materials/kashgar-demo-v1/case-index.json；这些是合成案例设定，不是模型结论。
// customerId 必须来自当前已授权的真实服务目录，禁止在这里预造运行身份。
export const DEMO_CASES = [
  { name: '喀什示例塑料制品有限公司', runtimeDisplayName: '喀什示例塑料制品有限公司（注塑场景·合成）', industry: '塑料制品', scenario: '好', description: '经营较好', amount: '1,000 万元' },
  { name: '喀什示例金属加工有限公司', runtimeDisplayName: '喀什示例金属加工有限公司（激光场景·合成）', industry: '金属加工', scenario: '中', description: '经营正常', amount: '500 万元' },
  { name: '喀什示例棉纺有限公司', runtimeDisplayName: '喀什示例棉纺有限公司（棉纺场景·合成）', industry: '棉纱纺织', scenario: '差', description: '经营承压', amount: '200 万元' },
] as const;
