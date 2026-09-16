using System.Collections.Generic;
using UnityEngine;

namespace EYE
{
    public sealed partial class EyeExperience
    {
        private readonly struct ChapterRoute
        {
            internal readonly Vector3 Start;
            internal readonly Vector3 ControlA;
            internal readonly Vector3 ControlB;
            internal readonly Vector3 End;

            internal ChapterRoute(Vector3 start, Vector3 controlA, Vector3 controlB, Vector3 end)
            {
                Start = start;
                ControlA = controlA;
                ControlB = controlB;
                End = end;
            }

            internal Vector3 Evaluate(float value)
            {
                float t = Mathf.Clamp01(value);
                float u = 1f - t;
                return u * u * u * Start
                    + 3f * u * u * t * ControlA
                    + 3f * u * t * t * ControlB
                    + t * t * t * End;
            }
        }

        private readonly List<ChapterRoute> chapterRoutes = new();
        private readonly List<Vector3> chapterPacketBaseScales = new();
        private readonly List<Transform> chapterRotors = new();
        private readonly List<Vector3> chapterRotorAxes = new();
        private readonly List<float> chapterRotorSpeeds = new();
        private readonly List<Quaternion> chapterRotorBases = new();
        private readonly List<Transform> chapterBobs = new();
        private readonly List<Vector3> chapterBobBases = new();
        private readonly List<Vector3> chapterBobAxes = new();
        private readonly List<float> chapterBobAmplitudes = new();
        private readonly List<float> chapterBobSpeeds = new();
        private readonly List<float> chapterBobPhases = new();
        private Transform chapterSharedScan;
        private Vector3 chapterSharedScanBasePosition;

        private void BuildChapterStage(EyeChapter chapter)
        {
            ClearPreviousChapterStage();

            ChapterDefinition definition = EyeChapterData.Get(chapter);
            Color color = definition.Color;
            // 商务与资产均从左侧母眼向右侧业务网络展开；资产页与右下标题形成同一阅读方向。
            bool eyeOnLeft = chapter == EyeChapter.Commerce || chapter == EyeChapter.Asset || chapter == EyeChapter.Ecosystem;
            // 协同从主页瞳孔中心直接放大展开：核心不再偏向左上或任一侧。
            float coreY = chapter == EyeChapter.Collaboration
                ? 0f
                : chapter == EyeChapter.Credit || chapter == EyeChapter.Commerce
                    ? .18f
                    : -.95f;
            chapterCorePosition = new Vector3(
                chapter == EyeChapter.Collaboration ? 0f : eyeOnLeft ? -1.90f : 1.90f,
                coreY,
                -.42f);

            BuildChapterMotherEye(chapter, color);
            switch (chapter)
            {
                case EyeChapter.Origin:
                    BuildOriginStage(definition);
                    break;
                case EyeChapter.Credit:
                    BuildCreditStage(definition);
                    break;
                case EyeChapter.Commerce:
                    BuildCommerceStage(definition);
                    break;
                case EyeChapter.Policy:
                    BuildPolicyStage(definition);
                    break;
                case EyeChapter.Asset:
                    BuildAssetStage(definition);
                    break;
                case EyeChapter.Collaboration:
                    BuildCollaborationStage(definition);
                    break;
                case EyeChapter.Ecosystem:
                    BuildEcosystemStage(definition);
                    break;
            }

            BuildSharedChapterScanner(color);
            BuildFlowPackets(definition.Color, chapter == EyeChapter.Collaboration ? 12 : 10);
            ApplyChapterRendererBudget();
        }

        private void ClearPreviousChapterStage()
        {
            if (chapterCore != null) baseScales.Remove(chapterCore);
            for (int i = 0; i < chapterNodes.Count; i++)
                if (chapterNodes[i] != null) baseScales.Remove(chapterNodes[i]);

            List<Collider> staleTargets = new();
            foreach (KeyValuePair<Collider, EyeChapter> target in hitTargets)
            {
                Collider collider = target.Key;
                if (collider == null || collider.transform.IsChildOf(chapterRoot)
                    || (chapterEyeRoot != null && collider.transform.IsChildOf(chapterEyeRoot)))
                    staleTargets.Add(collider);
            }
            for (int i = 0; i < staleTargets.Count; i++) hitTargets.Remove(staleTargets[i]);

            for (int i = chapterRoot.childCount - 1; i >= 0; i--)
            {
                GameObject child = chapterRoot.GetChild(i).gameObject;
                child.SetActive(false);
                child.transform.SetParent(generatedRoot, false);
                Destroy(child);
            }
            if (chapterEyeRoot != null)
            {
                for (int i = chapterEyeRoot.childCount - 1; i >= 0; i--)
                {
                    GameObject child = chapterEyeRoot.GetChild(i).gameObject;
                    child.SetActive(false);
                    child.transform.SetParent(generatedRoot, false);
                    Destroy(child);
                }
            }

            chapterNodes.Clear();
            chapterNodePositions.Clear();
            chapterLines.Clear();
            flowPackets.Clear();
            chapterRoutes.Clear();
            chapterPacketBaseScales.Clear();
            chapterRotors.Clear();
            chapterRotorAxes.Clear();
            chapterRotorSpeeds.Clear();
            chapterRotorBases.Clear();
            chapterBobs.Clear();
            chapterBobBases.Clear();
            chapterBobAxes.Clear();
            chapterBobAmplitudes.Clear();
            chapterBobSpeeds.Clear();
            chapterBobPhases.Clear();
            chapterCore = null;
            chapterSharedScan = null;
        }

        private void BuildOriginStage(ChapterDefinition definition)
        {
            Color color = definition.Color;
            Vector3[] nodes = CreateUnifiedHexNodes();
            BuildHologramCore(definition, color, 1.02f);

            ChapterRoute[] routes = CreateUnifiedRadialRoutes(nodes);
            BuildHologramNetwork(definition, nodes, routes, null, .43f);

        }

        private void BuildCreditStage(ChapterDefinition definition)
        {
            Color color = definition.Color;
            Vector3[] nodes = CreateUnifiedHexNodes();
            BuildHologramCore(definition, color, 1.06f);

            ChapterRoute[] routes = CreateUnifiedRadialRoutes(nodes);
            BuildHologramNetwork(definition, nodes, routes, null, .42f);

            Material glass = EyeVisualFactory.CreateHologramMaterial(new Color(color.r, color.g, color.b, .105f), .72f);
            for (int i = 0; i < nodes.Length; i++)
            {
                Transform frame = CreateBlock("Evidence Slice " + i, chapterRoot, nodes[i] + new Vector3(0, 0, .42f),
                    new Vector3(1.36f, .86f, .018f), glass);
                frame.localRotation = Quaternion.Euler(0, -10 + i * 5, -7 + i * 3);
                RegisterBob(frame, Vector3.forward, .12f, .72f + i * .07f, i * .8f);
            }

            // 删除眼睛附近四根独立风险频谱柱，避免形成无业务含义的视觉噪声。
        }

        private void BuildCommerceStage(ChapterDefinition definition)
        {
            Color color = definition.Color;
            Vector3[] nodes = CreateUnifiedHexNodes();
            BuildHologramCore(definition, color, .98f);

            ChapterRoute[] routes = CreateUnifiedRadialRoutes(nodes);
            BuildHologramNetwork(definition, nodes, routes, null, .41f);

            Material rollerMaterial = EyeVisualFactory.CreateGlowMaterial(new Color(color.r, color.g, color.b, .28f), 1.55f);
            for (int i = 0; i < nodes.Length; i++)
            {
                Vector3 position = Vector3.Lerp(chapterCorePosition, nodes[i], .58f) + new Vector3(0, 0, .34f);
                Transform roller = CreateCylinder("Contract Conveyor Roller " + i, chapterRoot, position,
                    new Vector3(.22f, .08f, .22f), rollerMaterial, Quaternion.Euler(90, 0, 0));
                RegisterRotor(roller, Vector3.up, 110f + i * 9f);
            }

        }

        private void BuildPolicyStage(ChapterDefinition definition)
        {
            Color color = definition.Color;
            Vector3[] nodes = CreateUnifiedHexNodes();
            BuildHologramCore(definition, color, 1.0f);

            ChapterRoute[] routes = CreateUnifiedRadialRoutes(nodes);
            BuildHologramNetwork(definition, nodes, routes, null, .41f);

            Material tabletMaterial = EyeVisualFactory.CreateHologramMaterial(new Color(color.r, color.g, color.b, .12f), .82f);
            for (int i = 0; i < nodes.Length; i++)
            {
                Transform tablet = EyeVisualFactory.CreateQuad("Policy Version Tablet " + i, chapterRoot,
                    nodes[i] + new Vector3(0, 0, .48f), new Vector3(1.18f, 1.52f, 1), tabletMaterial).transform;
                tablet.localRotation = Quaternion.Euler(0, -12 + i * 6, -9 + i * 4);
                RegisterBob(tablet, Vector3.forward, .10f, .64f + i * .06f, i * .9f);
                for (int rule = 0; rule < 2; rule++)
                    EyeVisualFactory.CreateLine("Policy Text Rule " + i + "-" + rule, tablet,
                        new[] { new Vector3(-.38f, .24f - rule * .28f, -.01f), new Vector3(.38f - rule * .12f, .24f - rule * .28f, -.01f) },
                        new Color(color.r, color.g, color.b, .20f), .012f);
            }

        }

        private void BuildAssetStage(ChapterDefinition definition)
        {
            Color color = definition.Color;
            Vector3[] nodes = CreateUnifiedHexNodes();
            BuildHologramCore(definition, color, 1.02f);

            ChapterRoute[] routes = CreateUnifiedRadialRoutes(nodes);
            BuildHologramNetwork(definition, nodes, routes, null, .42f);

            Material telemetryMaterial = EyeVisualFactory.CreateGlowMaterial(new Color(color.r, color.g, color.b, .34f), 1.75f);
            for (int i = 0; i < nodes.Length; i++)
            {
                Transform bar = CreateBlock("Asset Telemetry Bar " + i, chapterRoot,
                    nodes[i] + new Vector3(.62f, -.08f, .2f), new Vector3(.095f, .48f + i * .13f, .095f), telemetryMaterial);
                RegisterBob(bar, Vector3.up, .12f + i * .018f, 1.2f + i * .11f, i * .7f);
            }

        }

        private void BuildCollaborationStage(ChapterDefinition definition)
        {
            Vector3[] nodes = CreateUnifiedHexNodes();
            Color[] colors = new Color[nodes.Length];
            for (int i = 0; i < colors.Length; i++) colors[i] = CollaborationColor(i);
            BuildHologramCore(definition, new Color(.78f, 1f, .94f), 1.12f);

            ChapterRoute[] routes = CreateUnifiedRadialRoutes(nodes);
            BuildHologramNetwork(definition, nodes, routes, colors, .45f);

        }

        private void BuildEcosystemStage(ChapterDefinition definition)
        {
            Color color = definition.Color;
            Vector3[] nodes = CreateUnifiedHexNodes();
            BuildHologramCore(definition, color, 1.12f);

            ChapterRoute[] routes = CreateUnifiedRadialRoutes(nodes);
            BuildHologramNetwork(definition, nodes, routes, null, .43f);

            Material mastMaterial = EyeVisualFactory.CreateGlowMaterial(new Color(color.r, color.g, color.b, .30f), 1.7f);
            for (int i = 0; i < nodes.Length; i++)
            {
                Transform mast = CreateBlock("Agent Antenna " + i, chapterRoot,
                    nodes[i] + new Vector3(0, -.68f, .28f), new Vector3(.055f, .55f, .055f), mastMaterial);
                RegisterBob(mast, Vector3.up, .08f, 1f + i * .12f, i * .75f);
            }

        }

        private Vector3[] CreateUnifiedHexNodes()
        {
            // 五个业务节点围绕“看见 EYE”核心排布；各节点仅保留一条核心业务路径。
            float mirror = currentChapter == EyeChapter.Commerce || currentChapter == EyeChapter.Asset || currentChapter == EyeChapter.Ecosystem ? -1f : 1f;
            // 按标注图将信审、商务、协同、共创、全域的完整节点单元沿原射线向外展开。
            // 文字由 HUD 实时锁定在晶体上方，因此只移动节点世界坐标即可保持二者始终成组。
            bool expandedLayout = currentChapter == EyeChapter.Credit
                || currentChapter == EyeChapter.Commerce
                || currentChapter == EyeChapter.Collaboration
                || currentChapter == EyeChapter.Origin
                || currentChapter == EyeChapter.Ecosystem;
            float spread = expandedLayout ? 1.42f : 1f;
            Vector3[] offsets =
            {
                new(3.70f, 1.45f, 1.02f),
                new(-.35f, 2.55f, .62f),
                new(-4.05f, 1.20f, 1.24f),
                new(-3.65f, -1.35f, .48f),
                new(-.35f, -2.55f, 1.32f)
            };
            Vector3[] nodes = new Vector3[offsets.Length];
            for (int i = 0; i < offsets.Length; i++)
            {
                Vector3 offset = offsets[i];
                offset.x *= mirror;
                // 镜像页的左上节点为固定流程看板留出完整标签宽度。
                if (mirror < 0f && i == 0) offset.x += .80f;
                offset.x *= spread;
                offset.y *= spread;
                nodes[i] = chapterCorePosition + offset;
            }
            return nodes;
        }

        private ChapterRoute[] CreateUnifiedRadialRoutes(Vector3[] nodes)
        {
            ChapterRoute[] routes = new ChapterRoute[nodes.Length];
            for (int i = 0; i < nodes.Length; i++)
            {
                float bend = (i - 2) * .18f;
                routes[i] = MakeArc(chapterCorePosition, nodes[i], bend, .72f + i * .055f);
            }
            return routes;
        }

        private void BuildHologramCore(ChapterDefinition definition, Color color, float size)
        {
            chapterCore = CreatePivot("Chapter Core / " + definition.Core, chapterRoot, chapterCorePosition);
            baseScales[chapterCore] = Vector3.one;

            Material coreMaterial = EyeVisualFactory.CreateDiamondMaterial(new Color(color.r, color.g, color.b, .92f), 1.92f, .92f);
            Transform crystal = EyeVisualFactory.CreateCrystal(
                "Core Diamond Crystal",
                chapterCore,
                Vector3.zero,
                size,
                coreMaterial,
                (int)currentChapter * 19.37f + 3.1f,
                .92f).transform;
            Destroy(crystal.GetComponent<Collider>());
            crystal.localRotation = Quaternion.Euler(14f, 18f, 45f);
            RegisterRotor(crystal, Vector3.forward, 10f);

            // 核心只保留晶体本身；取消多层椭圆光环，避免背景线条抢夺信息层级。
        }

        private void BuildHologramNetwork(
            ChapterDefinition definition,
            Vector3[] positions,
            ChapterRoute[] routes,
            Color[] colors,
            float nodeSize)
        {
            for (int i = 0; i < positions.Length; i++)
            {
                Color nodeColor = colors == null ? definition.Color : colors[i];
                BuildHologramNode(definition.Nodes[i], i, positions[i], nodeColor, nodeSize);
                ChapterRoute route = routes[i];
                chapterRoutes.Add(route);

                // 子页通路与主页六条主通路统一：宽幅透光水晶带 + 体积层 + 能量层 + 亮核。
                // 每页只保留核心至五个节点的五条，避免恢复已剔除的背景杂线。
                EyeVisualFactory.CreateBezierRibbon("Chapter Wide Transmission Ribbon " + i, chapterRoot,
                    route.Start, route.ControlA, route.ControlB, route.End,
                    new Color(nodeColor.r, nodeColor.g, nodeColor.b, .44f), .54f, 38);

                LineRenderer volume = EyeVisualFactory.CreateBezierLine("Chapter Beam Volume " + i, chapterRoot,
                    route.Start, route.ControlA, route.ControlB, route.End,
                    new Color(nodeColor.r, nodeColor.g, nodeColor.b, .13f), .22f, 34);
                volume.widthCurve = new AnimationCurve(
                    new Keyframe(0f, .14f), new Keyframe(.10f, .76f), new Keyframe(.86f, 1f), new Keyframe(1f, .16f));
                volume.endColor = new Color(nodeColor.r, nodeColor.g, nodeColor.b, .08f);

                LineRenderer energy = EyeVisualFactory.CreateBezierLine("Chapter Beam Energy " + i, chapterRoot,
                    route.Start, route.ControlA, route.ControlB, route.End,
                    new Color(nodeColor.r, nodeColor.g, nodeColor.b, .58f), .092f, 38);
                energy.widthCurve = new AnimationCurve(
                    new Keyframe(0f, .12f), new Keyframe(.08f, .78f), new Keyframe(.90f, 1f), new Keyframe(1f, .18f));
                energy.endColor = new Color(nodeColor.r, nodeColor.g, nodeColor.b, .34f);

                Color hot = Color.Lerp(new Color(.82f, .92f, 1f, 1f), nodeColor, .36f);
                LineRenderer logicLine = EyeVisualFactory.CreateBezierLine("Chapter Beam Hot Core " + i, chapterRoot,
                    route.Start, route.ControlA, route.ControlB, route.End,
                    new Color(hot.r, hot.g, hot.b, .90f), .038f, 42);
                logicLine.widthCurve = new AnimationCurve(
                    new Keyframe(0f, .10f), new Keyframe(.08f, .64f), new Keyframe(.90f, 1f), new Keyframe(1f, .16f));
                chapterLines.Add(logicLine);
            }
            // 不再生成节点外环；核心到每颗节点各保留一条业务路径。
        }

        private void BuildHologramNode(string label, int index, Vector3 position, Color color, float size)
        {
            Transform root = CreatePivot("Hologram Node / " + label, chapterRoot, position);
            chapterNodes.Add(root);
            chapterNodePositions.Add(position);
            baseScales[root] = Vector3.one;

            float crystalSeed = (int)currentChapter * 31.7f + index * 6.43f;
            Material diamond = EyeVisualFactory.CreateDiamondMaterial(
                new Color(color.r, color.g, color.b, .88f),
                1.88f + index * .10f,
                .72f + (index % 3) * .08f,
                crystalSeed,
                1.05f + (index % 4) * .16f);
            Transform glyph = EyeVisualFactory.CreateCrystal(
                "Node Crystal " + index,
                root,
                Vector3.zero,
                size * 1.46f,
                diamond,
                crystalSeed,
                .78f + (index % 4) * .13f).transform;
            Destroy(glyph.GetComponent<Collider>());
            glyph.localRotation = Quaternion.Euler(12f + index * 7f, 14f + index * 29f, 45f - index * 9f);
            RegisterRotor(glyph, Vector3.forward, (index % 2 == 0 ? 1f : -1f) * (9f + index * 1.4f));
            // 节点只保留晶体和唯一业务连线，不再附加环形与投影线装饰。
        }

        private Vector3 GetEyeEmissionPoint(Vector3 target, float spread)
        {
            Vector3 direction = target - chapterEyePosition;
            direction.z = 0f;
            if (direction.sqrMagnitude < .001f) direction = Vector3.right;
            direction.Normalize();
            Vector3 tangent = new(-direction.y, direction.x, 0f);
            // 2.45 个单位约为放大子页面虹膜的外缘，避开瞳孔并让光带先自然展开。
            return chapterEyePosition + direction * 2.45f + tangent * spread + Vector3.back * .16f;
        }

        private void BuildFlowPackets(Color chapterColor, int packetCount)
        {
            if (chapterRoutes.Count == 0) return;
            Material packetMaterial = EyeVisualFactory.CreateGlowMaterial(
                new Color(chapterColor.r, chapterColor.g, chapterColor.b, .92f), 2.35f);
            for (int i = 0; i < packetCount; i++)
            {
                int routeIndex = i % chapterRoutes.Count;
                float phase = Mathf.Repeat(i * .173f, 1f);
                ChapterRoute route = chapterRoutes[routeIndex];
                Vector3 position = route.Evaluate(phase);
                Transform packet = CreateBlock("Encrypted Data Packet " + i, chapterRoot, position,
                    new Vector3(.095f, .075f, .19f), packetMaterial);
                Vector3 direction = route.Evaluate(Mathf.Min(1f, phase + .018f)) - position;
                if (direction.sqrMagnitude > .0001f) packet.localRotation = Quaternion.LookRotation(direction.normalized, Vector3.up);
                EyeVisualFactory.CreateTrail(packet, chapterColor, .065f, .48f);
                flowPackets.Add(packet);
                chapterPacketBaseScales.Add(packet.localScale);
            }
        }

        private void BuildChapterMotherEye(EyeChapter chapter, Color color)
        {
            Texture2D texture = Resources.Load<Texture2D>("EYE-mother-visual-A");
            if (texture == null) return;
            Vector3 position = chapter switch
            {
                // 两侧入口均沿阅读方向横向展开：左侧共创由右向左、右侧全域由左向右。
                // 因此共创视觉源在右侧中轴、全域视觉源在左侧中轴；仅消除原先下方偏移。
                EyeChapter.Origin => new Vector3(9.00f, 0f, 4.62f),
                // 信审与商务上方留白较多，母眼随业务网络同步上提。
                EyeChapter.Credit => new Vector3(9.00f, -2.55f, 4.62f),
                EyeChapter.Commerce => new Vector3(-9.00f, -2.55f, 4.62f),
                EyeChapter.Policy => new Vector3(9.00f, 3.75f, 4.62f),
                EyeChapter.Asset => new Vector3(-9.00f, 3.75f, 4.62f),
                // 协同是中心入口，母眼与核心同轴，在画面中心直接展开。
                EyeChapter.Collaboration => new Vector3(0f, 0f, 4.72f),
                EyeChapter.Ecosystem => new Vector3(-9.00f, 0f, 4.62f),
                _ => new Vector3(9.00f, -3.75f, 4.72f)
            };
            chapterEyePosition = position;
            Shader.SetGlobalVector("_EyeLightPositionWS", chapterEyeRoot.TransformPoint(position));
            Vector3 scale = chapter == EyeChapter.Collaboration
                ? new Vector3(12.2f, 8.13f, 1)
                : new Vector3(13.4f, 8.93f, 1);
            Color tint = Color.Lerp(Color.white, color, chapter == EyeChapter.Collaboration ? .04f : .12f);
            tint.a = 1f;
            Material material = EyeVisualFactory.CreateEyeSurfaceMaterial(
                texture,
                tint,
                .25f,
                chapter == EyeChapter.Collaboration ? .96f : 1.00f,
                1f);
            material.SetFloat("_Awake", 1f);
            material.SetFloat("_Focus", 1f);
            EyeVisualFactory.CreateCurvedQuad(
                "Continuous Mother Eye / Inspection",
                chapterEyeRoot,
                position,
                new Vector2(scale.x, scale.y),
                material,
                .30f,
                56,
                36);

            // 子页面所有光带靠近瞳孔时先进入柔焦区，消除“穿过眼球”的硬连接感。
            EyeVisualFactory.CreateSoftFocusDisc(
                "Chapter Iris Soft Focus Veil",
                chapterEyeRoot,
                position + Vector3.back * .34f,
                5.70f,
                new Color(.008f, .018f, .028f, .84f));
            EyeVisualFactory.CreateSoftFocusDisc(
                "Chapter Iris Soft Focus Halo",
                chapterEyeRoot,
                position + Vector3.back * .37f,
                4.15f,
                new Color(color.r, color.g, color.b, .18f));

            GameObject returnTarget = new("Mother Eye Return Target");
            returnTarget.transform.SetParent(chapterEyeRoot, false);
            returnTarget.transform.localPosition = position + Vector3.back * .12f;
            BoxCollider collider = returnTarget.AddComponent<BoxCollider>();
            collider.size = new Vector3(scale.x * 1.01f, scale.y * 1.01f, .18f);
            hitTargets[collider] = EyeChapter.Hub;

            {
                Vector3 emission = GetEyeEmissionPoint(chapterCorePosition, 0f);
                EyeVisualFactory.CreateBezierLine("Mother Eye Continuity Volume", chapterRoot,
                    emission,
                    Vector3.Lerp(emission, chapterCorePosition, .32f) + Vector3.forward * .72f,
                    Vector3.Lerp(emission, chapterCorePosition, .68f) + Vector3.forward * .72f,
                    chapterCorePosition + new Vector3(0, 0, .18f),
                    new Color(color.r, color.g, color.b, .12f), .24f, 36);
                EyeVisualFactory.CreateBezierLine("Mother Eye Continuity Energy", chapterRoot,
                    emission + Vector3.back * .02f,
                    Vector3.Lerp(emission, chapterCorePosition, .32f) + Vector3.forward * .74f,
                    Vector3.Lerp(emission, chapterCorePosition, .68f) + Vector3.forward * .74f,
                    chapterCorePosition + new Vector3(0, 0, .16f),
                    new Color(color.r, color.g, color.b, .62f), .085f, 42);
                EyeVisualFactory.CreateBezierLine("Mother Eye Continuity Hot Core", chapterRoot,
                    emission + Vector3.back * .04f,
                    Vector3.Lerp(emission, chapterCorePosition, .32f) + Vector3.forward * .76f,
                    Vector3.Lerp(emission, chapterCorePosition, .68f) + Vector3.forward * .76f,
                    chapterCorePosition + new Vector3(0, 0, .14f),
                    Color.Lerp(new Color(.025f, .045f, .060f, .96f), color, .58f), .032f, 46);
            }
        }

        private void UpdateChapterAnimation()
        {
            if (!cyclePaused) chapterClock += Time.deltaTime;
            float cycle = Mathf.Repeat(chapterClock, ChapterCycleDuration);
            float stepDuration = ChapterCycleDuration / 5f;
            int activeStep = Mathf.Min(4, Mathf.FloorToInt(cycle / stepDuration));
            float stepProgress = Mathf.Repeat(cycle, stepDuration) / stepDuration;
            Color chapterColor = EyeChapterData.Get(currentChapter).Color;

            for (int i = 0; i < chapterNodes.Count; i++)
            {
                Transform node = chapterNodes[i];
                if (node == null || !baseScales.TryGetValue(node, out Vector3 baseScale)) continue;
                float pulse = 1f + Mathf.Sin(Time.time * 2.25f + i * .82f) * .055f;
                float activation = i == activeStep ? 1.26f + Mathf.Sin(stepProgress * Mathf.PI) * .12f : 1f;
                node.localScale = baseScale * pulse * activation;
                // 业务矩阵使用绝对锚点：只允许脉冲缩放，不再让根节点漂移或绕中心转动。
                node.localPosition = chapterNodePositions[i];

                if (i >= chapterLines.Count) continue;
                Color lineColor = currentChapter == EyeChapter.Collaboration ? CollaborationColor(i) : chapterColor;
                float alpha = i == activeStep ? .98f : .62f;
                LineRenderer line = chapterLines[i];
                line.startColor = new Color(lineColor.r, lineColor.g, lineColor.b, alpha);
                line.endColor = new Color(lineColor.r, lineColor.g, lineColor.b, alpha * .76f);
                line.widthMultiplier = i == activeStep ? .068f : .046f;

            }

            if (chapterCore != null && baseScales.TryGetValue(chapterCore, out Vector3 coreBaseScale))
            {
                float beat = Mathf.Exp(-Mathf.Repeat(cycle, stepDuration) * 3.8f) * .13f;
                float corePulse = 1f + Mathf.Sin(Time.time * 1.58f) * .075f + beat;
                chapterCore.localScale = coreBaseScale * corePulse;
            }

            UpdateFlowPackets(activeStep);
            UpdateChapterMechanisms();
        }

        private void UpdateFlowPackets(int activeStep)
        {
            if (chapterRoutes.Count == 0) return;
            for (int i = 0; i < flowPackets.Count; i++)
            {
                Transform packet = flowPackets[i];
                if (packet == null) continue;
                int routeIndex = i % chapterRoutes.Count;
                ChapterRoute route = chapterRoutes[routeIndex];
                float speed = currentChapter == EyeChapter.Commerce ? .26f : currentChapter == EyeChapter.Ecosystem ? .31f : .22f;
                float phase = Mathf.Repeat(chapterClock * speed + i * .173f, 1f);
                Vector3 position = route.Evaluate(SmoothFlow(phase));
                float nextPhase = Mathf.Min(.999f, phase + .015f);
                Vector3 direction = route.Evaluate(SmoothFlow(nextPhase)) - position;
                packet.localPosition = position;
                if (direction.sqrMagnitude > .0001f) packet.localRotation = Quaternion.LookRotation(direction.normalized, Vector3.up);
                float visibility = Mathf.Sin(phase * Mathf.PI);
                float routeEnergy = routeIndex == activeStep ? 1.34f : .76f;
                packet.localScale = chapterPacketBaseScales[i] * (.46f + visibility * .82f) * routeEnergy;
            }
        }

        private void UpdateChapterMechanisms()
        {
            float time = Time.time;
            for (int i = 0; i < chapterRotors.Count; i++)
            {
                Transform rotor = chapterRotors[i];
                if (rotor == null) continue;
                rotor.localRotation = chapterRotorBases[i]
                    * Quaternion.AngleAxis(time * chapterRotorSpeeds[i], chapterRotorAxes[i]);
            }
            for (int i = 0; i < chapterBobs.Count; i++)
            {
                Transform bob = chapterBobs[i];
                if (bob == null) continue;
                float offset = Mathf.Sin(time * chapterBobSpeeds[i] + chapterBobPhases[i]) * chapterBobAmplitudes[i];
                bob.localPosition = chapterBobBases[i] + chapterBobAxes[i] * offset;
            }

            // 信审页的证据扫描现作为所有子页面的统一动作，使用完全相同的速度和行程。
            if (chapterSharedScan != null)
                chapterSharedScan.localPosition = chapterSharedScanBasePosition
                    + Vector3.up * (Mathf.PingPong(time * 1.35f, 5.8f) - 2.9f);

        }

        private static ChapterRoute MakeArc(Vector3 start, Vector3 end, float bend, float depthLift)
        {
            Vector3 delta = end - start;
            Vector3 perpendicular = new(-delta.y, delta.x, 0);
            if (perpendicular.sqrMagnitude > .0001f) perpendicular.Normalize();
            Vector3 depth = Vector3.forward * depthLift;
            return new ChapterRoute(
                start,
                start + delta * .32f + perpendicular * bend + depth,
                start + delta * .70f - perpendicular * bend * .42f + depth,
                end);
        }

        private static Transform CreatePivot(string name, Transform parent, Vector3 position)
        {
            Transform pivot = new GameObject(name).transform;
            pivot.SetParent(parent, false);
            pivot.localPosition = position;
            return pivot;
        }

        private static Transform CreateBlock(
            string name,
            Transform parent,
            Vector3 position,
            Vector3 scale,
            Material material)
        {
            GameObject block = GameObject.CreatePrimitive(PrimitiveType.Cube);
            block.name = name;
            block.transform.SetParent(parent, false);
            block.transform.localPosition = position;
            block.transform.localScale = scale;
            block.GetComponent<Renderer>().sharedMaterial = material;
            Destroy(block.GetComponent<Collider>());
            return block.transform;
        }

        private static Transform CreateCylinder(
            string name,
            Transform parent,
            Vector3 position,
            Vector3 scale,
            Material material,
            Quaternion rotation)
        {
            GameObject cylinder = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            cylinder.name = name;
            cylinder.transform.SetParent(parent, false);
            cylinder.transform.localPosition = position;
            cylinder.transform.localScale = scale;
            cylinder.transform.localRotation = rotation;
            cylinder.GetComponent<Renderer>().sharedMaterial = material;
            Destroy(cylinder.GetComponent<Collider>());
            return cylinder.transform;
        }

        private void RegisterRotor(Transform target, Vector3 axis, float degreesPerSecond)
        {
            chapterRotors.Add(target);
            chapterRotorAxes.Add(axis.normalized);
            chapterRotorSpeeds.Add(degreesPerSecond);
            chapterRotorBases.Add(target.localRotation);
        }

        private void RegisterBob(Transform target, Vector3 axis, float amplitude, float speed, float phase)
        {
            chapterBobs.Add(target);
            chapterBobBases.Add(target.localPosition);
            chapterBobAxes.Add(axis.normalized);
            chapterBobAmplitudes.Add(amplitude);
            chapterBobSpeeds.Add(speed);
            chapterBobPhases.Add(phase);
        }

        private void BuildSharedChapterScanner(Color color)
        {
            chapterSharedScan = CreatePivot(
                "Shared Evidence Tomography Scanner",
                chapterRoot,
                chapterCorePosition + new Vector3(0, 0, -.08f));
            chapterSharedScanBasePosition = chapterSharedScan.localPosition;

            EyeVisualFactory.CreateLine(
                "Shared Tomography Scan Bar",
                chapterSharedScan,
                new[] { new Vector3(-4.7f, 0, 0), new Vector3(4.7f, 0, 0) },
                new Color(color.r, color.g, color.b, .58f),
                .045f);
            Transform scanFilm = EyeVisualFactory.CreateQuad(
                "Shared Tomography Scan Film",
                chapterSharedScan,
                new Vector3(0, 0, .28f),
                new Vector3(9.2f, .38f, 1),
                EyeVisualFactory.CreateMaterial(new Color(color.r, color.g, color.b, .055f))).transform;
            scanFilm.localRotation = Quaternion.identity;
        }

        private void ApplyChapterRendererBudget()
        {
            Renderer[] renderers = chapterRoot.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                renderers[i].shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderers[i].receiveShadows = false;
                renderers[i].lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
                renderers[i].reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
            }
            if (renderers.Length > 96)
                Debug.LogWarning("EYE chapter renderer budget exceeded: " + renderers.Length);
        }

        private static Vector3 PercentToWorld(Vector2 percent)
        {
            return new Vector3((percent.x - 50f) * .15f, (50f - percent.y) * .105f, 0);
        }

        private static float SmoothFlow(float value)
        {
            value = Mathf.Clamp01(value);
            return value * value * (3f - 2f * value);
        }

        private static Color CollaborationColor(int index)
        {
            return index switch
            {
                0 => EyeChapterData.Get(EyeChapter.Credit).Color,
                1 => EyeChapterData.Get(EyeChapter.Commerce).Color,
                2 => EyeChapterData.Get(EyeChapter.Asset).Color,
                3 => EyeChapterData.Get(EyeChapter.Policy).Color,
                _ => Color.white
            };
        }
    }
}
