using UnityEngine;

namespace EYE
{
    internal enum EyeChapter
    {
        Hub,
        Origin,
        Credit,
        Commerce,
        Policy,
        Asset,
        Collaboration,
        Ecosystem
    }

    internal sealed class ChapterDefinition
    {
        public EyeChapter Chapter { get; }
        public string Eyebrow { get; }
        public string Title { get; }
        public string Tagline { get; }
        public string Core { get; }
        public Color Color { get; }
        public string[] Nodes { get; }
        public string[] CycleSteps { get; }

        public ChapterDefinition(
            EyeChapter chapter,
            string eyebrow,
            string title,
            string tagline,
            string core,
            Color color,
            string[] nodes,
            string[] cycleSteps)
        {
            Chapter = chapter;
            Eyebrow = eyebrow;
            Title = title;
            Tagline = tagline;
            Core = core;
            Color = color;
            Nodes = nodes;
            CycleSteps = cycleSteps;
        }
    }

    internal static class EyeChapterData
    {
        internal static readonly EyeChapter[] CoreOrder =
        {
            EyeChapter.Credit,
            EyeChapter.Commerce,
            EyeChapter.Policy,
            EyeChapter.Asset,
            EyeChapter.Collaboration
        };

        private static readonly ChapterDefinition[] Definitions =
        {
            new(
                EyeChapter.Hub, "EYE / RISK INTELLIGENCE", "看见 EYE", "看见事实，看见风险，看见结果", "看见",
                Hex("#0F766E"),
                new[] { "信审", "商务", "政策", "资产", "协同" },
                new[] { "共创溯源", "信审", "商务", "政策", "资产", "协同", "Agent 全域协作" }),
            new(
                EyeChapter.Origin, "ORIGIN / 共创现场", "共创溯源", "五方并行 · 同处构建 · 持续反馈", "看见 EYE",
                Hex("#4E6B43"),
                new[] { "我", "需求", "前端", "后端", "AI" },
                new[] { "需求被共同看见", "方案在同一现场生成", "前后端持续对齐", "AI 参与构建与校验", "反馈回到共同系统" }),
            new(
                EyeChapter.Credit, "01 / CREDIT REVIEW", "信审", "让风险发现早一步", "看见 EYE",
                Hex("#095FB7"),
                new[] { "现场尽调", "多模态解析", "事实核验", "证据回链", "人工判断" },
                new[] { "现场采集进入系统", "材料被解析为事实", "跨材料一致性核验", "异常定位原始证据", "人工完成最终判断" }),
            new(
                EyeChapter.Commerce, "02 / COMMERCE", "商务", "把条件变成可执行任务", "看见 EYE",
                Hex("#087A70"),
                new[] { "审批条件", "合同任务", "付款核验", "交付查勘", "人工验收" },
                new[] { "接收审批条件", "拆分合同执行任务", "核验付款前置条件", "跟踪交付与查勘", "人工确认执行结果" }),
            new(
                EyeChapter.Policy, "03 / POLICY", "政策", "让每次核验都有依据", "看见 EYE",
                Hex("#6246C5"),
                new[] { "规则版本", "适用范围", "原文依据", "前置核验", "人工发布" },
                new[] { "识别当前规则版本", "匹配项目适用范围", "回链制度原文依据", "执行前置规则核验", "变更经过人工发布" }),
            new(
                EyeChapter.Asset, "04 / ASSET", "资产", "让结果回到同一个项目", "看见 EYE",
                Hex("#A85B00"),
                new[] { "投放表现", "异常信号", "条件验证", "旁路评估", "结果反馈" },
                new[] { "观察投放后表现", "捕捉资产异常信号", "验证前期审批条件", "结果进入旁路评估", "反馈沉淀到项目事实" }),
            new(
                EyeChapter.Collaboration, "05 / COLLABORATION", "协同", "一个项目 · 一套事实 · 一条责任链", "看见 EYE",
                Hex("#25343D"),
                new[] { "事实", "证据", "规则", "任务", "结果" },
                new[] { "事实形成共同底座", "证据保持全程可追溯", "规则提供明确依据", "任务连接不同角色", "结果回流形成闭环" }),
            new(
                EyeChapter.Ecosystem, "SYSTEM / AGENT 全域协作", "全域风控", "多 Agent 协作 · 主脑统筹 · 管理决策", "看见 EYE",
                Hex("#08785A"),
                new[] { "看见 Agent", "政策 Agent", "资产 Agent", "业务 Agent", "执行 Agent" },
                new[] { "专业 Agent 感知任务", "共享同一项目上下文", "多路分析汇聚主脑", "管理主脑形成计划", "执行反馈再次进入系统" })
        };

        private static readonly Vector2[][] CachedNodePositions =
        {
            new[] { new Vector2(50, 22), new Vector2(72, 39), new Vector2(67, 69), new Vector2(35, 71), new Vector2(28, 40) },
            new[] { new Vector2(31, 22), new Vector2(20, 47), new Vector2(34, 76), new Vector2(62, 78), new Vector2(73, 30) },
            new[] { new Vector2(51, 18), new Vector2(31, 36), new Vector2(71, 31), new Vector2(35, 69), new Vector2(57, 79) },
            new[] { new Vector2(47, 18), new Vector2(68, 31), new Vector2(74, 53), new Vector2(64, 72), new Vector2(47, 81) },
            new[] { new Vector2(37, 19), new Vector2(23, 40), new Vector2(75, 34), new Vector2(69, 69), new Vector2(53, 80) },
            new[] { new Vector2(47, 18), new Vector2(72, 30), new Vector2(68, 66), new Vector2(35, 76), new Vector2(26, 49) },
            new[] { new Vector2(50, 22), new Vector2(72, 39), new Vector2(67, 69), new Vector2(35, 71), new Vector2(28, 40) },
            new[] { new Vector2(39, 24), new Vector2(57, 18), new Vector2(48, 73), new Vector2(80, 25), new Vector2(84, 72) }
        };

        internal static ChapterDefinition Get(EyeChapter chapter)
        {
            int index = Mathf.Clamp((int)chapter, 0, Definitions.Length - 1);
            return Definitions[index];
        }

        internal static int CoreIndex(EyeChapter chapter)
        {
            for (int i = 0; i < CoreOrder.Length; i++)
                if (CoreOrder[i] == chapter) return i;
            return -1;
        }

        internal static Vector2 CorePosition(EyeChapter chapter)
        {
            return chapter switch
            {
                EyeChapter.Origin => new Vector2(52.5f, 52f),
                EyeChapter.Credit => new Vector2(56.5f, 52.5f),
                EyeChapter.Commerce => new Vector2(48.5f, 50f),
                EyeChapter.Policy => new Vector2(52f, 46f),
                EyeChapter.Asset => new Vector2(50f, 46f),
                EyeChapter.Collaboration => new Vector2(50f, 50f),
                EyeChapter.Ecosystem => new Vector2(68f, 51f),
                _ => new Vector2(50f, 50f)
            };
        }

        internal static Vector2[] NodePositions(EyeChapter chapter)
        {
            int index = Mathf.Clamp((int)chapter, 0, CachedNodePositions.Length - 1);
            return CachedNodePositions[index];
        }

        internal static Color Hex(string hex)
        {
            return ColorUtility.TryParseHtmlString(hex, out Color color) ? color : Color.white;
        }
    }
}
