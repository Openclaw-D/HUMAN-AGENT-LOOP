using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

namespace EYE
{
    public sealed partial class EyeExperience
    {
        private sealed class HubFlowRoute
        {
            internal Transform Packet;
            internal Vector3 Start;
            internal Vector3 Control;
            internal Vector3 End;
            internal float Phase;
            internal float Speed;
            internal float Scale = 1f;
        }

        private sealed class HubBeamLayer
        {
            internal LineRenderer Line;
            internal Color Color;
            internal float Width;
            internal float Phase;
            internal EyeChapter Chapter;
        }

        private sealed class HubCrystalShard
        {
            internal Transform Transform;
            internal Vector3 Start;
            internal Vector3 Control;
            internal Vector3 End;
            internal float Phase;
            internal float Speed;
            internal float Spin;
            internal float Bob;
            internal Vector3 Scale;
        }

        private readonly List<Transform> hubKineticParts = new();
        private readonly List<HubFlowRoute> hubFlowRoutes = new();
        private readonly List<HubBeamLayer> hubBeamLayers = new();
        private readonly List<HubCrystalShard> hubCrystalShards = new();
        private Material motherEyeMaterial;
        private Material irisFieldMaterial;
        private Transform irisFieldRoot;
        private Transform corneaRoot;
        private Transform hubOrbitRoot;
        private Transform motherEyeSurfaceRoot;
        private float nextBlinkAt;
        private float blinkStartedAt = -1f;

        private void BuildHub()
        {
            hubRoot = new GameObject("Seven Scene Spatial Hub").transform;
            hubRoot.SetParent(generatedRoot, false);
            hubRoot.localScale = new Vector3(1f, 1.12f, 1f);
            BuildCentralEye();
            BuildOriginWing();
            BuildEcosystemWing();
        }

        private void BuildCentralEye()
        {
            centralEyeRoot = new GameObject("Mother Eye / Living Interface").transform;
            centralEyeRoot.SetParent(hubRoot, false);
            Shader.SetGlobalVector("_EyeLightPositionWS", centralEyeRoot.TransformPoint(new Vector3(.08f, -.02f, .62f)));

            Texture2D eyeTexture = Resources.Load<Texture2D>("EYE-mother-visual-A");
            Texture2D halfEyeTexture = Resources.Load<Texture2D>("EYE-mother-visual-half");
            Texture2D closedEyeTexture = Resources.Load<Texture2D>("EYE-mother-visual-closed");
            if (eyeTexture != null)
            {
                motherEyeMaterial = EyeVisualFactory.CreateEyeSurfaceMaterial(eyeTexture);
                if (halfEyeTexture != null) motherEyeMaterial.SetTexture("_HalfBlinkMap", halfEyeTexture);
                if (closedEyeTexture != null) motherEyeMaterial.SetTexture("_BlinkMap", closedEyeTexture);
                motherEyeSurfaceRoot = EyeVisualFactory.CreateCurvedQuad(
                    "Curved Mother Eye Surface",
                    centralEyeRoot,
                    new Vector3(.05f, 0, 2.05f),
                    // 背景面覆盖整个 16:9 视口；贴图在材质中保持约 72% 内容宽度，
                    // 因此眼睛只相对旧版放大约 20%，同时消除照片矩形边界。
                    new Vector2(24.80f, 13.95f),
                    motherEyeMaterial,
                    .08f,
                    64,
                    40).transform;
            }

            // 写实眼睛自身承担眼睑与睫毛，移除额外的几何睫毛轮廓，避免与背景割裂。

            irisFieldMaterial = EyeVisualFactory.CreateIrisMaterial();
            GameObject iris = EyeVisualFactory.CreateQuad(
                "GPU Iris Fiber Field",
                centralEyeRoot,
                new Vector3(.08f, -.02f, 1.24f),
                new Vector3(4.23f, 4.23f, 1),
                irisFieldMaterial);
            irisFieldRoot = iris.transform;

            Material corneaMaterial = EyeVisualFactory.CreateHologramMaterial(new Color(.26f, .92f, 1f, .18f), 1.20f);
            GameObject cornea = EyeVisualFactory.CreateSphere(
                "Reactive Corneal Lens",
                centralEyeRoot,
                new Vector3(.08f, -.02f, .98f),
                1f,
                corneaMaterial);
            Object.Destroy(cornea.GetComponent<Collider>());
            cornea.transform.localScale = new Vector3(2.34f, 2.34f, .46f);
            corneaRoot = cornea.transform;
            EyeVisualFactory.CreateEnergyHalo(
                centralEyeRoot,
                new Vector3(.08f, -.02f, .88f),
                new Color(.20f, .82f, 1f, .38f),
                2.24f);

            Material pupilGlow = EyeVisualFactory.CreateGlowMaterial(new Color(.42f, 1f, .86f, .62f), 1.75f);
            Transform pupilRing = EyeVisualFactory.CreateRing(
                "Pupil Aperture",
                centralEyeRoot,
                new Vector3(.08f, -.02f, .72f),
                .82f,
                .052f,
                pupilGlow);
            hubKineticParts.Add(pupilRing);
            hubAnchors[EyeChapter.Collaboration] = pupilRing;
            baseScales[pupilRing] = pupilRing.localScale;

            // 大面积柔焦区遮住所有汇聚线的硬起点，让它们像从眼睛的光晕中自然显现。
            EyeVisualFactory.CreateSoftFocusDisc(
                "Pupil Soft Focus Veil",
                centralEyeRoot,
                new Vector3(.08f, -.02f, .28f),
                3.85f,
                new Color(.008f, .020f, .032f, .88f));
            EyeVisualFactory.CreateSoftFocusDisc(
                "Pupil Soft Focus Halo",
                centralEyeRoot,
                new Vector3(.08f, -.02f, .25f),
                2.90f,
                new Color(.16f, .72f, .78f, .23f));

            GameObject pupilTarget = new("Pupil / 看见 Target");
            pupilTarget.transform.SetParent(centralEyeRoot, false);
            pupilTarget.transform.localPosition = new Vector3(.08f, -.02f, .62f);
            SphereCollider pupilCollider = pupilTarget.AddComponent<SphereCollider>();
            pupilCollider.radius = .90f;
            hitTargets[pupilCollider] = EyeChapter.Collaboration;

            hubOrbitRoot = new GameObject("Five Chapter Orbit").transform;
            hubOrbitRoot.SetParent(centralEyeRoot, false);
            Material orbitMaterial = EyeVisualFactory.CreateGlowMaterial(new Color(.12f, .62f, .82f, .18f), 1.35f);
            Transform orbitA = EyeVisualFactory.CreateRing("Chapter Orbit A", hubOrbitRoot,
                new Vector3(.08f, -.02f, 1.02f), 4.35f, .024f, orbitMaterial, default, 128);
            orbitA.localScale = new Vector3(1, .64f, 1);
            Transform orbitB = EyeVisualFactory.CreateRing("Chapter Orbit B", hubOrbitRoot,
                new Vector3(.08f, -.02f, 1.08f), 4.72f, .014f,
                EyeVisualFactory.CreateGlowMaterial(new Color(.42f, .82f, .72f, .10f), 1.15f), default, 128);
            orbitB.localScale = new Vector3(1, .60f, 1);
            hubKineticParts.Add(orbitA);
            hubKineticParts.Add(orbitB);

            EyeChapter[] chapters = { EyeChapter.Credit, EyeChapter.Commerce, EyeChapter.Policy, EyeChapter.Asset };
            Vector3[] positions =
            {
                new(-4.30f, 2.18f, .62f),
                new(4.42f, 2.12f, .72f),
                new(-4.28f, -2.30f, .67f),
                new(4.40f, -2.24f, .76f)
            };
            for (int i = 0; i < chapters.Length; i++)
            {
                CreatePortalGate(chapters[i], positions[i], i);
                BuildPrimaryPortalBeam(chapters[i], positions[i], i);
            }

            BuildEyeTelemetry();
        }

        private void CreatePortalGate(EyeChapter chapter, Vector3 position, int index)
        {
            Color color = EyeChapterData.Get(chapter).Color;
            Transform gate = new GameObject(chapter + " Spatial Gate").transform;
            gate.SetParent(hubOrbitRoot, false);
            gate.localPosition = position;
            float crystalSeed = 4.31f + index * 8.79f;
            GameObject crystal = EyeVisualFactory.CreateCrystal(
                chapter + " Signal Crystal",
                gate,
                Vector3.zero,
                .36f,
                EyeVisualFactory.CreateDiamondMaterial(new Color(color.r, color.g, color.b, .90f), 2.10f, .84f, crystalSeed, 1.35f),
                crystalSeed,
                .86f + index * .07f);
            crystal.transform.localScale = new Vector3(.58f + index * .025f, 1f, .56f + (index % 2) * .08f);
            crystal.transform.localRotation = Quaternion.Euler(11f + index * 8f, 16f + index * 47f, 38f - index * 13f);
            hubKineticParts.Add(crystal.transform);
            hitTargets[crystal.GetComponent<Collider>()] = chapter;
            Transform ring = EyeVisualFactory.CreateRing(
                chapter + " Gate Halo",
                gate,
                Vector3.zero,
                .48f,
                .032f,
                EyeVisualFactory.CreateGlowMaterial(new Color(color.r, color.g, color.b, .62f), 2f),
                Quaternion.Euler(58f, index % 2 == 0 ? 18f : -18f, 0));
            Transform ring2 = EyeVisualFactory.CreateRing(
                chapter + " Gate Gyro",
                gate,
                Vector3.zero,
                .39f,
                .012f,
                EyeVisualFactory.CreateGlowMaterial(new Color(color.r, color.g, color.b, .32f), 1.45f),
                Quaternion.Euler(-38f, 72f, index * 24f));
            hubKineticParts.Add(ring);
            hubKineticParts.Add(ring2);
            hubAnchors[chapter] = gate;
            baseScales[gate] = gate.localScale;
        }

        private void BuildPrimaryPortalBeam(EyeChapter chapter, Vector3 portal, int index)
        {
            Color color = EyeChapterData.Get(chapter).Color;
            // 六条主通路均从虹膜外围的不同接收点启程，绝不再由瞳孔中心直插节点。
            bool sideChapter = chapter == EyeChapter.Origin || chapter == EyeChapter.Ecosystem;
            // 两侧“共创 / 全域”沿母眼水平中轴延伸，不能继承扇出节点的上下切线偏移。
            Vector3 start = GetHubIrisEmissionPoint(portal, sideChapter ? 3 : index);
            Vector3 end = portal + new Vector3(0, 0, -.10f);
            float arc = sideChapter ? 0f : portal.y >= 0 ? .34f : -.34f;
            Vector3 controlA = Vector3.Lerp(start, end, .31f) + new Vector3(0, arc, .88f);
            Vector3 controlB = Vector3.Lerp(start, end, .72f) + new Vector3(0, arc * .55f, .54f);

            EyeVisualFactory.CreateBezierRibbon(
                chapter + " Wide Transmission Ribbon",
                hubOrbitRoot,
                start,
                controlA,
                controlB,
                end,
                new Color(color.r, color.g, color.b, .52f),
                .78f,
                46);

            CreatePortalBeamLayer(chapter + " Primary Beam Volume", chapter, start, controlA, controlB, end,
                new Color(color.r, color.g, color.b, .12f), .31f, index * .71f);
            CreatePortalBeamLayer(chapter + " Primary Beam Energy", chapter, start, controlA, controlB, end,
                new Color(color.r, color.g, color.b, .56f), .135f, index * .71f + .8f);
            CreatePortalBeamLayer(chapter + " Primary Beam Hot Core", chapter, start, controlA, controlB, end,
                new Color(.82f + color.r * .18f, .90f + color.g * .10f, .96f + color.b * .04f, .94f),
                .034f, index * .71f + 1.7f);

            Vector3 flowControl = (start + end) * .5f + new Vector3(0, arc * .85f, .72f);
            for (int packet = 0; packet < 4; packet++)
            {
                float phase = Mathf.Repeat(index * .19f + packet * .245f, 1f);
                CreateHubFlowPacket(chapter + " Outbound Photon " + packet, hubOrbitRoot,
                    start, flowControl, end, color, phase, .72f + packet * .055f, 1.85f);
            }
            for (int packet = 0; packet < 3; packet++)
            {
                float phase = Mathf.Repeat(.12f + index * .17f + packet * .31f, 1f);
                CreateHubFlowPacket(chapter + " Inbound Photon " + packet, hubOrbitRoot,
                    end, flowControl, start, Color.Lerp(color, Color.white, .44f), phase, .82f + packet * .06f, 1.58f);
            }

            CreateCrystalShardStream(chapter, start, flowControl, end, color, index, 9 + index * 2);
            CreateCrystalShardStream(chapter, end, flowControl, start, Color.Lerp(color, Color.white, .20f), index + 17, 7 + index);
        }

        private static Vector3 GetHubIrisEmissionPoint(Vector3 target, int index)
        {
            Vector3 irisCenter = new(.08f, -.02f, .58f);
            Vector3 direction = target - irisCenter;
            direction.z = 0f;
            if (direction.sqrMagnitude < .001f) direction = Vector3.right;
            direction.Normalize();
            Vector3 tangent = new(-direction.y, direction.x, 0f);
            // 起点置于虹膜外缘，并沿切线错开，形成柔和的扇出关系而非瞳孔尖点。
            float lateralOffset = (index - 3f) * .19f;
            return irisCenter + direction * 2.42f + tangent * lateralOffset + Vector3.back * .12f;
        }

        private void CreateCrystalShardStream(
            EyeChapter chapter,
            Vector3 start,
            Vector3 control,
            Vector3 end,
            Color color,
            int linkIndex,
            int shardCount)
        {
            for (int i = 0; i < shardCount; i++)
            {
                float seed = linkIndex * 19.31f + i * 3.71f;
                float phase = Mathf.Repeat(.07f + i * .173f + linkIndex * .11f, 1f);
                float scale = .026f + Mathf.Repeat(Mathf.Sin(seed * 12.7f) * 83.1f, 1f) * .042f;
                float clarity = .56f + Mathf.Repeat(Mathf.Sin(seed * 4.3f) * 28.2f, 1f) * .31f;
                Material material = EyeVisualFactory.CreateDiamondMaterial(
                    new Color(color.r, color.g, color.b, .78f),
                    1.75f + (i % 4) * .24f,
                    clarity,
                    seed,
                    .70f + (i % 5) * .18f);
                GameObject shard = EyeVisualFactory.CreateCrystal(
                    chapter + " Link Crystal Shard " + i,
                    hubOrbitRoot,
                    start,
                    scale,
                    material,
                    seed,
                    .72f + Mathf.Repeat(seed * .37f, 1f) * .95f);
                Object.Destroy(shard.GetComponent<Collider>());
                hubCrystalShards.Add(new HubCrystalShard
                {
                    Transform = shard.transform,
                    Start = start,
                    Control = control,
                    End = end,
                    Phase = phase,
                    Speed = .085f + (i % 4) * .018f,
                    Spin = 38f + (i % 5) * 19f,
                    Bob = .055f + (i % 3) * .025f,
                    Scale = shard.transform.localScale
                });
            }
        }

        private void CreatePortalBeamLayer(
            string name,
            EyeChapter chapter,
            Vector3 start,
            Vector3 controlA,
            Vector3 controlB,
            Vector3 end,
            Color color,
            float width,
            float phase)
        {
            LineRenderer line = EyeVisualFactory.CreateBezierLine(
                name, hubOrbitRoot, start, controlA, controlB, end, color, width, 52);
            line.widthCurve = new AnimationCurve(
                new Keyframe(0f, .22f), new Keyframe(.10f, .78f), new Keyframe(.44f, 1f),
                new Keyframe(.88f, .84f), new Keyframe(1f, .28f));
            line.numCapVertices = 12;
            line.numCornerVertices = 12;
            line.startColor = color;
            line.endColor = new Color(color.r, color.g, color.b, color.a * .78f);
            hubBeamLayers.Add(new HubBeamLayer
            {
                Line = line,
                Color = color,
                Width = width,
                Phase = phase,
                Chapter = chapter
            });
        }

        private void BuildEyeTelemetry()
        {
            Material telemetry = EyeVisualFactory.CreateGlowMaterial(new Color(.12f, .72f, .68f, .22f), 1.35f);
            for (int i = 0; i < 3; i++)
            {
                float radius = 2.56f + i * .44f;
                Transform ring = EyeVisualFactory.CreateRing(
                    "Iris Telemetry " + i,
                    centralEyeRoot,
                    new Vector3(.08f, -.02f, 1.08f + i * .025f),
                    radius,
                    .014f + i * .005f,
                    telemetry,
                    Quaternion.Euler(i * 11f, i * 7f, 0));
                hubKineticParts.Add(ring);
            }
            for (int tick = 0; tick < 32; tick++)
            {
                float angle = tick * Mathf.PI * 2f / 32f;
                float inner = 2.30f + (tick % 4 == 0 ? .08f : .20f);
                float outer = 2.58f;
                Vector3 a = new(.08f + Mathf.Cos(angle) * inner, -.02f + Mathf.Sin(angle) * inner, .91f);
                Vector3 b = new(.08f + Mathf.Cos(angle) * outer, -.02f + Mathf.Sin(angle) * outer, .91f);
                EyeVisualFactory.CreateLine("Biometric Tick", centralEyeRoot, new[] { a, b },
                    new Color(.28f, .88f, .75f, tick % 4 == 0 ? .36f : .14f), tick % 4 == 0 ? .018f : .009f);
            }
        }

        private void BuildOriginWing()
        {
            leftWingRoot = new GameObject("Origin / Organic Memory Wing").transform;
            leftWingRoot.SetParent(hubRoot, false);
            // 左右两翼共用水平中线，并继续向画面外侧让位，避免挤压中央母眼。
            leftWingRoot.localPosition = new Vector3(-8.45f, 0, .28f);
            Color vine = EyeChapterData.Get(EyeChapter.Origin).Color;
            Vector3 core = new(.12f, 0f, .18f);
            for (int branch = 0; branch < 8; branch++)
            {
                float y = (branch - 3.5f) * .66f;
                Vector3 start = new(-3.65f, y, 1.4f + Mathf.Abs(y) * .12f);
                Vector3 control = new(-2.2f, y * .78f + Mathf.Sin(branch) * .3f, .72f);
                Vector3 end = core + new Vector3(-.16f, (branch - 3.5f) * .055f, 0);
                EyeVisualFactory.CreateBezierLine(
                    "Growing Memory Root " + branch,
                    leftWingRoot,
                    start,
                    control,
                    new Vector3(-.65f, y * .24f, .30f),
                    end,
                    new Color(vine.r, vine.g, vine.b, .22f + branch % 2 * .08f),
                    branch % 2 == 0 ? .045f : .026f,
                    30);

                Vector3 budPosition = Vector3.Lerp(start, end, .34f + (branch % 3) * .16f);
                GameObject bud = EyeVisualFactory.CreateOctahedron(
                    "Co-creator Memory Bud " + branch,
                    leftWingRoot,
                    budPosition,
                    .14f + (branch % 2) * .035f,
                    EyeVisualFactory.CreateHologramMaterial(new Color(.32f, .82f, .35f, .58f), 1.35f));
                bud.transform.localScale = new Vector3(.55f, 1.45f, .45f);
                hitTargets[bud.GetComponent<Collider>()] = EyeChapter.Origin;
                wingNodes.Add(bud.transform);
                baseScales[bud.transform] = bud.transform.localScale;
                if (branch % 2 == 0)
                {
                    Transform leaves = EyeVisualFactory.CreateLeafCard(
                        "CC0 Living Leaf Cluster " + branch,
                        leftWingRoot,
                        budPosition + new Vector3(-.18f, .12f, .18f),
                        new Vector2(.82f, .82f),
                        branch * 31f - 52f,
                        new Color(.28f, .88f, .36f, .48f));
                    wingNodes.Add(leaves);
                    baseScales[leaves] = leaves.localScale;
                }

                CreateHubFlowPacket(
                    "Origin Sap " + branch,
                    leftWingRoot,
                    start,
                    control,
                    end,
                    vine,
                    branch * .127f,
                    .075f + branch * .002f);
            }

            GameObject originCore = EyeVisualFactory.CreateOctahedron(
                "Origin Co-creation Seed",
                leftWingRoot,
                core,
                .60f,
                EyeVisualFactory.CreateDiamondMaterial(new Color(.18f, .86f, .32f, .88f), 1.68f, .86f));
            hitTargets[originCore.GetComponent<Collider>()] = EyeChapter.Origin;
            hubAnchors[EyeChapter.Origin] = originCore.transform;
            baseScales[originCore.transform] = originCore.transform.localScale;
            hubKineticParts.Add(originCore.transform);
            BuildPrimaryPortalBeam(EyeChapter.Origin, leftWingRoot.localPosition + core, 5);
            Transform halo = EyeVisualFactory.CreateRing("Origin Seed Halo", leftWingRoot, core, .78f, .026f,
                EyeVisualFactory.CreateGlowMaterial(new Color(.18f, .9f, .35f, .52f), 1.85f), Quaternion.Euler(64f, 20f, 0));
            hubKineticParts.Add(halo);
        }

        private void BuildEcosystemWing()
        {
            rightWingRoot = new GameObject("Ecosystem / Agent Intelligence Wing").transform;
            rightWingRoot.SetParent(hubRoot, false);
            rightWingRoot.localPosition = new Vector3(8.45f, 0, .28f);
            Vector3 brain = new(-.08f, 0, .12f);
            Color highway = EyeChapterData.Get(EyeChapter.Ecosystem).Color;
            for (int i = 0; i < 9; i++)
            {
                float y = (i - 4) * .60f;
                Vector3 source = new(3.72f, y, 1.4f + Mathf.Abs(y) * .10f);
                Vector3 controlA = new(2.42f, y * .82f, .62f);
                Vector3 controlB = new(.72f, y * .26f, .18f);
                EyeVisualFactory.CreateBezierLine(
                    "Agent Data Highway " + i,
                    rightWingRoot,
                    source,
                    controlA,
                    controlB,
                    brain,
                    new Color(.08f, .82f, .78f, .18f + (i % 3) * .06f),
                    i % 3 == 0 ? .052f : .025f,
                    32);
                GameObject agent = EyeVisualFactory.CreateOctahedron(
                    "Distributed Agent " + i,
                    rightWingRoot,
                    source,
                    .17f,
                    EyeVisualFactory.CreateHologramMaterial(new Color(.06f, .86f, .82f, .66f), 1.65f));
                hitTargets[agent.GetComponent<Collider>()] = EyeChapter.Ecosystem;
                wingNodes.Add(agent.transform);
                baseScales[agent.transform] = agent.transform.localScale;
                CreateHubFlowPacket(
                    "Agent Outbound Packet " + i,
                    rightWingRoot,
                    source,
                    controlA,
                    brain,
                    highway,
                    i * .104f,
                    .09f + (i % 3) * .011f);
                CreateHubFlowPacket(
                    "Agent Inbound Packet " + i,
                    rightWingRoot,
                    brain,
                    controlB,
                    source,
                    Color.Lerp(highway, Color.white, .28f),
                    .43f + i * .097f,
                    .074f + (i % 4) * .010f,
                    .72f);
                CreateMatrixCodeColumn(rightWingRoot, source + new Vector3(.10f, .04f, .18f), i, highway);
            }
            GameObject brainNode = EyeVisualFactory.CreateOctahedron(
                "Management Intelligence Core",
                rightWingRoot,
                brain,
                .68f,
                EyeVisualFactory.CreateDiamondMaterial(new Color(.10f, 1f, .72f, .90f), 1.84f, .90f));
            hitTargets[brainNode.GetComponent<Collider>()] = EyeChapter.Ecosystem;
            hubAnchors[EyeChapter.Ecosystem] = brainNode.transform;
            baseScales[brainNode.transform] = brainNode.transform.localScale;
            hubKineticParts.Add(brainNode.transform);
            BuildPrimaryPortalBeam(EyeChapter.Ecosystem, rightWingRoot.localPosition + brain, 6);
            Transform haloA = EyeVisualFactory.CreateRing("Management Brain Halo A", rightWingRoot, brain, .88f, .032f,
                EyeVisualFactory.CreateGlowMaterial(new Color(.10f, 1f, .75f, .62f), 2.1f), Quaternion.Euler(70f, 0, 22f));
            Transform haloB = EyeVisualFactory.CreateRing("Management Brain Halo B", rightWingRoot, brain, .72f, .018f,
                EyeVisualFactory.CreateGlowMaterial(new Color(.10f, .62f, 1f, .42f), 1.8f), Quaternion.Euler(18f, 72f, 0));
            hubKineticParts.Add(haloA);
            hubKineticParts.Add(haloB);
        }

        private void CreateMatrixCodeColumn(Transform parent, Vector3 position, int index, Color color)
        {
            string[] streams =
            {
                "010011\nEYE::IN\n7F A2\n011010",
                "{RISK}\n010110\nAUTH_OK\n9C 01",
                "SYNC//\n110011\nNODE::" + index + "\n0101",
                "RX > TX\n7A 00\n0xEYE\n101101"
            };
            GameObject code = new("Bidirectional Matrix Source " + index);
            code.transform.SetParent(parent, false);
            code.transform.localPosition = position;
            TextMesh text = code.AddComponent<TextMesh>();
            text.text = streams[index % streams.Length];
            text.fontSize = 36;
            text.characterSize = .070f;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.color = new Color(color.r, color.g, color.b, .88f);
            text.GetComponent<MeshRenderer>().sharedMaterial = EyeVisualFactory.CreateGlowMaterial(
                new Color(color.r, color.g, color.b, .80f), 2.25f);
            wingNodes.Add(code.transform);
            baseScales[code.transform] = Vector3.one;
        }

        private void CreateHubFlowPacket(
            string name,
            Transform parent,
            Vector3 start,
            Vector3 control,
            Vector3 end,
            Color color,
            float phase,
            float speed,
            float scale = 1f)
        {
            GameObject packet = EyeVisualFactory.CreateSphere(
                name,
                parent,
                start,
                .065f,
                EyeVisualFactory.CreateGlowMaterial(new Color(color.r, color.g, color.b, .92f), 2.4f));
            Object.Destroy(packet.GetComponent<Collider>());
            EyeVisualFactory.CreateTrail(packet.transform, new Color(color.r, color.g, color.b, .88f), .075f, .72f);
            hubFlowRoutes.Add(new HubFlowRoute
            {
                Packet = packet.transform,
                Start = start,
                Control = control,
                End = end,
                Phase = phase,
                Speed = speed,
                Scale = scale
            });
        }

        private void UpdateHubAnimation()
        {
            float time = Time.time;
            float wake = awakened ? 1f : .10f;
            float blinkAmount = 0f;
            if (motherEyeMaterial != null)
            {
                float current = motherEyeMaterial.GetFloat("_Awake");
                motherEyeMaterial.SetFloat("_Awake", Mathf.Lerp(current, awakened ? 1f : 0f, Time.deltaTime * 2.4f));
                motherEyeMaterial.SetFloat("_Focus", hoveredChapter == EyeChapter.Hub ? 0f : 1f);
                if (nextBlinkAt <= 0f) nextBlinkAt = time + 3.8f;
                if (blinkStartedAt < 0f && time >= nextBlinkAt) blinkStartedAt = time;
                if (blinkStartedAt >= 0f)
                {
                    float t = (time - blinkStartedAt) / .34f;
                    blinkAmount = t < .5f ? Mathf.SmoothStep(0f, 1f, t * 2f) : Mathf.SmoothStep(1f, 0f, (t - .5f) * 2f);
                    if (t >= 1f) { blinkStartedAt = -1f; nextBlinkAt = time + Random.Range(4.5f, 8.5f); }
                }
                motherEyeMaterial.SetFloat("_Blink", blinkAmount);
            }
            if (irisFieldMaterial != null)
            {
                float current = irisFieldMaterial.GetFloat("_Energy");
                float target = awakened ? (hoveredChapter == EyeChapter.Hub ? .30f : .46f) : .025f;
                irisFieldMaterial.SetFloat("_Energy", Mathf.Lerp(current, target, Time.deltaTime * 3.2f));
                float focusAngle = smoothedPointer.sqrMagnitude > .01f ? Mathf.Atan2(smoothedPointer.y, smoothedPointer.x) : 0f;
                irisFieldMaterial.SetFloat("_FocusAngle", focusAngle);
            }
            if (irisFieldRoot != null)
            {
                irisFieldRoot.localRotation = Quaternion.Euler(0, 0, Mathf.Sin(time * .23f) * 2.2f);
                irisFieldRoot.localScale = new Vector3(4.23f, 4.23f * (1f - blinkAmount), 1f);
            }
            if (corneaRoot != null)
            {
                corneaRoot.localRotation = Quaternion.Euler(-smoothedPointer.y * 7f, smoothedPointer.x * 9f, 0);
                float lensPulse = 1f + Mathf.Sin(time * 1.22f) * .016f * wake;
                corneaRoot.localScale = new Vector3(2.34f, 2.34f * (1f - blinkAmount), .46f) * lensPulse;
            }

            for (int i = 0; i < hubKineticParts.Count; i++)
            {
                Transform part = hubKineticParts[i];
                if (part == null) continue;
                float direction = i % 2 == 0 ? 1f : -1f;
                part.Rotate(new Vector3(.18f + i % 3 * .08f, .32f, 1f), direction * Time.deltaTime * (5f + i % 5 * 2.2f) * wake, Space.Self);
            }

            foreach (KeyValuePair<EyeChapter, Transform> entry in hubAnchors)
            {
                Transform target = entry.Value;
                if (target == null || !baseScales.TryGetValue(target, out Vector3 baseScale)) continue;
                bool hover = awakened && entry.Key == hoveredChapter;
                bool locked = !CanOpen(entry.Key);
                float pulse = 1f + Mathf.Sin(time * 1.8f + (int)entry.Key * .73f) * (locked ? .018f : .055f);
                target.localScale = Vector3.Lerp(target.localScale, baseScale * pulse * (hover ? 1.34f : 1f), Time.deltaTime * 7f);
            }
            for (int i = 0; i < wingNodes.Count; i++)
            {
                Transform node = wingNodes[i];
                if (node == null || !baseScales.TryGetValue(node, out Vector3 baseScale)) continue;
                node.localScale = baseScale * (1f + Mathf.Sin(time * 1.35f + i * .47f) * .09f * wake);
                node.Rotate(0, Time.deltaTime * (8f + i % 4 * 4f) * wake, Time.deltaTime * 3f * wake, Space.Self);
            }
            for (int i = 0; i < hubBeamLayers.Count; i++)
            {
                HubBeamLayer beam = hubBeamLayers[i];
                if (beam.Line == null) continue;
                bool open = CanOpen(beam.Chapter);
                bool hover = hoveredChapter == beam.Chapter;
                float breathing = 1f + Mathf.Sin(time * 2.6f + beam.Phase) * .13f;
                float energy = hover ? 1.46f : open ? 1f : .42f;
                beam.Line.widthMultiplier = beam.Width * breathing * energy;
                float alpha = Mathf.Clamp01(beam.Color.a * energy);
                beam.Line.startColor = new Color(beam.Color.r, beam.Color.g, beam.Color.b, alpha);
                beam.Line.endColor = new Color(beam.Color.r, beam.Color.g, beam.Color.b, alpha * .78f);
            }
            for (int i = 0; i < hubFlowRoutes.Count; i++)
            {
                HubFlowRoute route = hubFlowRoutes[i];
                float phase = Mathf.Repeat(time * route.Speed + route.Phase, 1f);
                float u = 1f - phase;
                Vector3 position = u * u * route.Start + 2f * u * phase * route.Control + phase * phase * route.End;
                position.z -= Mathf.Sin(phase * Mathf.PI) * .18f;
                route.Packet.localPosition = position;
                float visible = awakened ? Mathf.Sin(phase * Mathf.PI) : .08f;
                route.Packet.localScale = Vector3.one * (.035f + visible * .085f) * route.Scale;
            }
            for (int i = 0; i < hubCrystalShards.Count; i++)
            {
                HubCrystalShard shard = hubCrystalShards[i];
                if (shard.Transform == null) continue;
                float progress = Mathf.Repeat(time * shard.Speed + shard.Phase, 1f);
                Vector3 position = QuadraticBezier(shard.Start, shard.Control, shard.End, progress);
                Vector3 tangent = QuadraticBezierTangent(shard.Start, shard.Control, shard.End, progress).normalized;
                Vector3 sideways = Vector3.Cross(tangent, Vector3.forward);
                if (sideways.sqrMagnitude < .001f) sideways = Vector3.up;
                position += sideways.normalized * Mathf.Sin(time * 2.3f + shard.Phase * 31f) * shard.Bob;
                shard.Transform.localPosition = position;
                shard.Transform.localRotation = Quaternion.LookRotation(Vector3.forward, tangent) * Quaternion.Euler(time * shard.Spin, shard.Phase * 260f, time * shard.Spin * .58f);
                float flicker = .78f + Mathf.Sin(time * (3.1f + shard.Phase * 2f) + shard.Phase * 42f) * .22f;
                shard.Transform.localScale = shard.Scale * flicker * wake;
            }

            float leftHover = hoveredChapter == EyeChapter.Origin ? 1.055f : 1f;
            float rightHover = hoveredChapter == EyeChapter.Ecosystem ? 1.055f : 1f;
            leftWingRoot.localScale = Vector3.Lerp(leftWingRoot.localScale, Vector3.one * leftHover, Time.deltaTime * 4f);
            rightWingRoot.localScale = Vector3.Lerp(rightWingRoot.localScale, Vector3.one * rightHover, Time.deltaTime * 4f);
            float transitionEase = transitionProgress * transitionProgress * (3f - 2f * transitionProgress);
            hubRoot.localScale = Vector3.one * Mathf.Lerp(.86f, 1f, transitionEase);
            hubRoot.localRotation = Quaternion.Euler(0, Mathf.Lerp(-8f, 0, transitionEase), 0);
        }

        private void UpdateCameraMotion()
        {
            Vector2 pointer = Vector2.zero;
            Mouse mouse = Mouse.current;
            if (mouse != null && Screen.width > 0 && Screen.height > 0)
            {
                Vector2 screen = mouse.position.ReadValue();
                pointer = new Vector2(screen.x / Screen.width * 2f - 1f, screen.y / Screen.height * 2f - 1f);
                pointer.x = Mathf.Clamp(pointer.x, -1f, 1f);
                pointer.y = Mathf.Clamp(pointer.y, -1f, 1f);
            }
            smoothedPointer = Vector2.Lerp(smoothedPointer, pointer, 1f - Mathf.Exp(-Time.unscaledDeltaTime * 3.4f));
            float ease = transitionProgress * transitionProgress * (3f - 2f * transitionProgress);
            Vector3 basePosition = currentChapter == EyeChapter.Hub ? cameraBasePosition : new Vector3(0, 0, -16.6f);
            Vector2 motionPointer = currentChapter == EyeChapter.Hub ? smoothedPointer : Vector2.zero;
            Vector3 desiredPosition = basePosition + new Vector3(motionPointer.x * .28f, motionPointer.y * .16f, 0);
            sceneCamera.transform.position = Vector3.Lerp(sceneCamera.transform.position, desiredPosition, 1f - Mathf.Exp(-Time.unscaledDeltaTime * 4f));
            Vector3 lookTarget = new(motionPointer.x * .20f, motionPointer.y * .12f, 1.45f);
            Quaternion desiredRotation = Quaternion.LookRotation(lookTarget - sceneCamera.transform.position, Vector3.up);
            sceneCamera.transform.rotation = Quaternion.Slerp(sceneCamera.transform.rotation, desiredRotation, 1f - Mathf.Exp(-Time.unscaledDeltaTime * 3.2f));
            float normalFov = currentChapter == EyeChapter.Hub ? 37.5f : 39.2f;
            sceneCamera.fieldOfView = Mathf.Lerp(normalFov + 16f, normalFov, ease);
            if (chapterRoot != null && currentChapter != EyeChapter.Hub)
            {
                chapterRoot.localScale = Vector3.one * Mathf.Lerp(.72f, 1f, ease);
                chapterRoot.localRotation = Quaternion.Euler(0, Mathf.Lerp(9f, 0, ease), Mathf.Lerp(-2.5f, 0, ease));
            }
        }

        private static Vector3 QuadraticBezier(Vector3 start, Vector3 control, Vector3 end, float t)
        {
            float u = 1f - t;
            return u * u * start + 2f * u * t * control + t * t * end;
        }

        private static Vector3 QuadraticBezierTangent(Vector3 start, Vector3 control, Vector3 end, float t)
        {
            return 2f * (1f - t) * (control - start) + 2f * t * (end - control);
        }
    }
}
