using System.Collections.Generic;
using UnityEngine;

namespace EYE
{
    internal static class EyeVisualFactory
    {
        private static readonly int BaseColor = Shader.PropertyToID("_BaseColor");
        private static readonly int BaseMap = Shader.PropertyToID("_BaseMap");
        private static readonly int Energy = Shader.PropertyToID("_Energy");
        private static readonly int Clarity = Shader.PropertyToID("_Clarity");
        private static readonly int CrystalSeed = Shader.PropertyToID("_CrystalSeed");
        private static readonly int Sparkle = Shader.PropertyToID("_Sparkle");
        private static readonly int TintStrength = Shader.PropertyToID("_TintStrength");
        private static readonly int Dispersion = Shader.PropertyToID("_Dispersion");
        private static readonly int InternalReflection = Shader.PropertyToID("_InternalReflection");
        private static readonly int Blink = Shader.PropertyToID("_Blink");
        private static readonly Dictionary<string, Material> SharedMaterials = new();

        internal static Material CreateMaterial(Color color, Texture texture = null)
        {
            return CreateSharedMaterial("EYEUnlit", "EYE/Unlit", color, texture, 1f);
        }

        internal static Material CreateGlowMaterial(Color color, float energy = 1f)
        {
            return CreateSharedMaterial("EYEGlow", "EYE/Glow", color, null, energy);
        }

        internal static Material CreateHologramMaterial(Color color, float energy = 1f)
        {
            return CreateSharedMaterial("EYEHologram", "EYE/Hologram", color, null, energy);
        }

        internal static Material CreateRibbonMaterial(Color color, float energy = 1f)
        {
            return CreateSharedMaterial("EYERibbon", "EYE/Transmission Ribbon", color, null, energy);
        }

        internal static Material CreateDiamondMaterial(
            Color color,
            float energy = 1.5f,
            float clarity = .86f,
            float crystalSeed = 0f,
            float sparkle = 1f)
        {
            Color.RGBToHSV(color, out float hue, out float saturation, out float value);
            // 业务色只进入内部折射与少量焦散，不再把整颗晶体染成高饱和发光玻璃。
            Color businessHue = Color.HSVToRGB(hue, Mathf.Clamp(saturation, .56f, .78f), 1f);
            businessHue.a = color.a;
            // 晶体必须拥有独立的种子，才能让切面、内部包裹体与高光节奏产生差异。
            Material material = new(LoadShader("EYEDiamond", "EYE/Diamond")) { name = "EYE Crystal " + crystalSeed.ToString("0.00") };
            material.SetColor(BaseColor, businessHue);
            material.SetFloat(Energy, energy);
            material.SetFloat(Clarity, clarity);
            material.SetFloat(CrystalSeed, crystalSeed);
            material.SetFloat(Sparkle, sparkle);
            // 小尺寸节点需要略高于微距参考图的染色浓度，才能在深色背景上保留业务识别。
            material.SetFloat(TintStrength, Mathf.Lerp(.28f, .40f, saturation));
            material.SetFloat(Dispersion, .82f + Mathf.Repeat(crystalSeed * .173f, 1f) * .20f);
            material.SetFloat(InternalReflection, .82f + Mathf.Repeat(crystalSeed * .319f, 1f) * .16f);
            return material;
        }

        internal static Material CreateParticleMaterial(Color color, float energy = 1f, Texture texture = null)
        {
            return CreateSharedMaterial("EYEParticle", "EYE/Particle", color, texture, energy);
        }

        internal static Material CreateLeafMaterial(Color tint)
        {
            const string key = "EYELeaf:CC0";
            if (SharedMaterials.TryGetValue(key, out Material shared)) return shared;
            Shader shader = LoadShader("EYELeaf", "EYE/Leaf Hologram");
            Material material = new(shader) { name = "CC0 Ivy Hologram" };
            material.SetTexture("_BaseMap", Resources.Load<Texture2D>(
                "External/ambientCG/LeafSet017/LeafSet017_1K-PNG_Color"));
            material.SetTexture("_OpacityMap", Resources.Load<Texture2D>(
                "External/ambientCG/LeafSet017/LeafSet017_1K-PNG_Opacity"));
            material.SetColor("_BaseColor", tint);
            SharedMaterials.Add(key, material);
            return material;
        }

        internal static Material CreateEyeSurfaceMaterial(
            Texture texture,
            Color? tint = null,
            float opacity = 1f,
            float exposure = 1f,
            float inspection = 0f)
        {
            Shader shader = LoadShader("EYEEyeSurface", "EYE/Eye Surface");
            Material material = new(shader) { name = "EYE Mother Surface" };
            if (material.HasProperty(BaseMap)) material.SetTexture(BaseMap, texture);
            if (material.HasProperty(BaseColor)) material.SetColor(BaseColor, tint ?? Color.white);
            if (material.HasProperty("_Opacity")) material.SetFloat("_Opacity", opacity);
            if (material.HasProperty("_Exposure")) material.SetFloat("_Exposure", exposure);
            if (material.HasProperty("_Inspection")) material.SetFloat("_Inspection", inspection);
            if (material.HasProperty(Blink)) material.SetFloat(Blink, 0f);
            return material;
        }

        internal static Material CreateIrisMaterial()
        {
            Shader shader = LoadShader("EYEIris", "EYE/Iris Field");
            Material material = new(shader) { name = "EYE Procedural Iris" };
            material.SetColor("_CreditColor", EyeChapterData.Get(EyeChapter.Credit).Color * 2.2f);
            material.SetColor("_CommerceColor", EyeChapterData.Get(EyeChapter.Commerce).Color * 2.0f);
            material.SetColor("_PolicyColor", EyeChapterData.Get(EyeChapter.Policy).Color * 2.0f);
            material.SetColor("_AssetColor", EyeChapterData.Get(EyeChapter.Asset).Color * 2.1f);
            return material;
        }

        private static Material CreateSharedMaterial(
            string resourceName,
            string shaderName,
            Color color,
            Texture texture,
            float energy,
            float clarity = -1f)
        {
            string key = resourceName + ":" + ColorUtility.ToHtmlStringRGBA(color) + ":"
                + energy.ToString("0.###") + ":" + clarity.ToString("0.###") + ":"
                + (texture == null ? "0" : texture.GetEntityId().ToString());
            if (SharedMaterials.TryGetValue(key, out Material shared)) return shared;
            Material material = new(LoadShader(resourceName, shaderName)) { name = resourceName + " Shared" };
            if (material.HasProperty(BaseColor)) material.SetColor(BaseColor, color);
            else material.color = color;
            if (material.HasProperty(Energy)) material.SetFloat(Energy, energy);
            if (clarity >= 0f && material.HasProperty(Clarity)) material.SetFloat(Clarity, clarity);
            if (texture != null)
            {
                if (material.HasProperty(BaseMap)) material.SetTexture(BaseMap, texture);
                else material.mainTexture = texture;
            }
            SharedMaterials.Add(key, material);
            return material;
        }

        private static Shader LoadShader(string resourceName, string shaderName)
        {
            return Resources.Load<Shader>(resourceName)
                ?? Shader.Find(shaderName)
                ?? Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Unlit/Texture")
                ?? Shader.Find("Sprites/Default");
        }

        internal static GameObject CreateSphere(string name, Transform parent, Vector3 position, float size, Material material)
        {
            GameObject sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            sphere.name = name;
            sphere.transform.SetParent(parent, false);
            sphere.transform.localPosition = position;
            sphere.transform.localScale = Vector3.one * size;
            sphere.GetComponent<Renderer>().sharedMaterial = material;
            return sphere;
        }

        internal static GameObject CreateOctahedron(string name, Transform parent, Vector3 position, float size, Material material)
        {
            Vector3[] sourceVertices =
            {
                new(0, 1, 0), new(1, 0, 0), new(0, 0, 1), new(-1, 0, 0), new(0, 0, -1), new(0, -1, 0)
            };
            int[] faces =
            {
                0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4,
                5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1
            };
            // 每个三角面复制顶点，保留真正的硬切面法线，避免晶体被平滑成塑料球。
            Vector3[] vertices = new Vector3[faces.Length];
            int[] triangles = new int[faces.Length];
            for (int i = 0; i < faces.Length; i++)
            {
                vertices[i] = sourceVertices[faces[i]];
                triangles[i] = i;
            }
            Mesh mesh = new() { name = name + " Mesh", vertices = vertices, triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            GameObject go = new(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = position;
            go.transform.localScale = Vector3.one * size;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
            SphereCollider collider = go.AddComponent<SphereCollider>();
            collider.radius = .78f;
            return go;
        }

        internal static GameObject CreateCrystal(
            string name,
            Transform parent,
            Vector3 position,
            float size,
            Material material,
            float seed,
            float elongation = 1f)
        {
            // 珠宝切割结构：桌面、冠部、腰棱、亭部与底尖。每颗仅保留极轻微比例差异，
            // 既有真实钻石轮廓，也不会重新变成完全相同的复制品。
            int sides = 12 + Mathf.FloorToInt(Mathf.Repeat(seed * 13.7f, 1f) * 3f);
            float angleOffset = seed * .73f;
            float tableRadius = .37f + Mathf.Sin(seed * 17.1f) * .025f;
            float crownHeight = (.50f + Mathf.Sin(seed * 9.3f) * .035f) * elongation;
            float girdleUpperY = .08f * elongation;
            float girdleLowerY = -.035f * elongation;
            float pavilionY = (-.56f + Mathf.Cos(seed * 11.3f) * .035f) * elongation;
            float culetY = (-1.04f + Mathf.Sin(seed * 5.7f) * .035f) * elongation;
            Vector3[] table = new Vector3[sides];
            Vector3[] girdleUpper = new Vector3[sides];
            Vector3[] girdleLower = new Vector3[sides];
            Vector3[] pavilion = new Vector3[sides];
            for (int i = 0; i < sides; i++)
            {
                float angle = i * Mathf.PI * 2f / sides + angleOffset;
                float radiusVariation = 1f + Mathf.Sin(i * 7.13f + seed * 31.7f) * .018f;
                Vector2 direction = new(Mathf.Cos(angle), Mathf.Sin(angle));
                table[i] = new Vector3(direction.x * tableRadius, crownHeight, direction.y * tableRadius);
                girdleUpper[i] = new Vector3(direction.x * radiusVariation, girdleUpperY, direction.y * radiusVariation);
                girdleLower[i] = new Vector3(direction.x * radiusVariation, girdleLowerY, direction.y * radiusVariation);
                float pavilionRadius = .47f + Mathf.Sin(i * 4.31f + seed * 8.9f) * .012f;
                pavilion[i] = new Vector3(direction.x * pavilionRadius, pavilionY, direction.y * pavilionRadius);
            }

            List<Vector3> vertices = new(sides * 30);
            List<int> triangles = new(sides * 30);
            void AddFacet(Vector3 a, Vector3 b, Vector3 c)
            {
                int first = vertices.Count;
                vertices.Add(a);
                vertices.Add(b);
                vertices.Add(c);
                triangles.Add(first);
                triangles.Add(first + 1);
                triangles.Add(first + 2);
            }

            Vector3 tableCenter = new(0f, crownHeight, 0f);
            Vector3 culet = new(Mathf.Sin(seed * 2.7f) * .018f, culetY, Mathf.Cos(seed * 3.9f) * .018f);
            for (int i = 0; i < sides; i++)
            {
                int next = (i + 1) % sides;
                AddFacet(tableCenter, table[next], table[i]);
                AddFacet(table[i], table[next], girdleUpper[i]);
                AddFacet(table[next], girdleUpper[next], girdleUpper[i]);
                AddFacet(girdleUpper[i], girdleUpper[next], girdleLower[i]);
                AddFacet(girdleUpper[next], girdleLower[next], girdleLower[i]);
                AddFacet(girdleLower[i], girdleLower[next], pavilion[i]);
                AddFacet(girdleLower[next], pavilion[next], pavilion[i]);
                AddFacet(pavilion[i], pavilion[next], culet);
            }
            Mesh mesh = new() { name = name + " Mesh", vertices = vertices.ToArray(), triangles = triangles.ToArray() };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            GameObject go = new(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = position;
            go.transform.localScale = Vector3.one * size;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
            SphereCollider collider = go.AddComponent<SphereCollider>();
            collider.radius = .78f;
            return go;
        }

        internal static GameObject CreateQuad(
            string name,
            Transform parent,
            Vector3 position,
            Vector3 scale,
            Material material)
        {
            GameObject quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            quad.name = name;
            quad.transform.SetParent(parent, false);
            quad.transform.localPosition = position;
            quad.transform.localScale = scale;
            quad.GetComponent<Renderer>().sharedMaterial = material;
            Object.Destroy(quad.GetComponent<Collider>());
            return quad;
        }

        internal static Transform CreateLeafCard(
            string name,
            Transform parent,
            Vector3 position,
            Vector2 size,
            float rotation,
            Color tint)
        {
            GameObject card = CreateQuad(name, parent, position, new Vector3(size.x, size.y, 1), CreateLeafMaterial(tint));
            card.transform.localRotation = Quaternion.Euler(0, 0, rotation);
            return card.transform;
        }

        internal static Transform CreateSoftFocusDisc(
            string name,
            Transform parent,
            Vector3 position,
            float diameter,
            Color color)
        {
            Texture2D softSprite = Resources.Load<Texture2D>("External/Kenney/ParticlePack/circle_05");
            GameObject disc = CreateQuad(
                name,
                parent,
                position,
                new Vector3(diameter, diameter, 1f),
                CreateParticleMaterial(color, .55f, softSprite));
            return disc.transform;
        }

        internal static GameObject CreateCurvedQuad(
            string name,
            Transform parent,
            Vector3 position,
            Vector2 size,
            Material material,
            float curvature = .22f,
            int columns = 64,
            int rows = 40)
        {
            int stride = columns + 1;
            Vector3[] vertices = new Vector3[(columns + 1) * (rows + 1)];
            Vector2[] uv = new Vector2[vertices.Length];
            int[] triangles = new int[columns * rows * 6];
            for (int y = 0; y <= rows; y++)
            {
                float v = y / (float)rows;
                float py = (v - .5f) * size.y;
                for (int x = 0; x <= columns; x++)
                {
                    float u = x / (float)columns;
                    float px = (u - .5f) * size.x;
                    float nx = u * 2f - 1f;
                    float ny = v * 2f - 1f;
                    float bulge = -curvature * Mathf.Max(0f, 1f - nx * nx) * Mathf.Max(0f, 1f - ny * ny);
                    int index = y * stride + x;
                    vertices[index] = new Vector3(px, py, bulge);
                    uv[index] = new Vector2(u, v);
                }
            }
            int triangle = 0;
            for (int y = 0; y < rows; y++)
            {
                for (int x = 0; x < columns; x++)
                {
                    int a = y * stride + x;
                    int b = a + 1;
                    int c = a + stride;
                    int d = c + 1;
                    triangles[triangle++] = a;
                    triangles[triangle++] = d;
                    triangles[triangle++] = b;
                    triangles[triangle++] = a;
                    triangles[triangle++] = c;
                    triangles[triangle++] = d;
                }
            }
            Mesh mesh = new() { name = name + " Mesh", vertices = vertices, uv = uv, triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            GameObject go = new(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = position;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
            return go;
        }

        internal static Transform CreateRing(
            string name,
            Transform parent,
            Vector3 position,
            float radius,
            float width,
            Material material,
            Quaternion rotation = default,
            int segments = 128)
        {
            Vector3[] vertices = new Vector3[segments * 2];
            Vector2[] uv = new Vector2[vertices.Length];
            int[] triangles = new int[segments * 6];
            float inner = Mathf.Max(.001f, radius - width * .5f);
            float outer = radius + width * .5f;
            for (int i = 0; i < segments; i++)
            {
                float t = i / (float)segments;
                float angle = t * Mathf.PI * 2f;
                Vector2 direction = new(Mathf.Cos(angle), Mathf.Sin(angle));
                vertices[i * 2] = new Vector3(direction.x * inner, direction.y * inner, 0);
                vertices[i * 2 + 1] = new Vector3(direction.x * outer, direction.y * outer, 0);
                uv[i * 2] = new Vector2(t, 0);
                uv[i * 2 + 1] = new Vector2(t, 1);
                int next = (i + 1) % segments;
                int index = i * 6;
                triangles[index] = i * 2;
                triangles[index + 1] = next * 2 + 1;
                triangles[index + 2] = i * 2 + 1;
                triangles[index + 3] = i * 2;
                triangles[index + 4] = next * 2;
                triangles[index + 5] = next * 2 + 1;
            }
            Mesh mesh = new() { name = name + " Mesh", vertices = vertices, uv = uv, triangles = triangles };
            mesh.RecalculateBounds();
            GameObject go = new(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = position;
            go.transform.localRotation = rotation == default ? Quaternion.identity : rotation;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
            return go.transform;
        }

        internal static LineRenderer CreateLine(
            string name,
            Transform parent,
            IReadOnlyList<Vector3> points,
            Color color,
            float width,
            int sortingOrder = 0)
        {
            LineRenderer line = new GameObject(name).AddComponent<LineRenderer>();
            line.transform.SetParent(parent, false);
            line.useWorldSpace = false;
            line.alignment = LineAlignment.View;
            line.textureMode = LineTextureMode.Stretch;
            line.positionCount = points.Count;
            for (int i = 0; i < points.Count; i++) line.SetPosition(i, points[i]);
            line.widthCurve = new AnimationCurve(
                new Keyframe(0, .16f), new Keyframe(.12f, 1f), new Keyframe(.82f, .72f), new Keyframe(1, 0f));
            line.widthMultiplier = width;
            line.numCapVertices = 10;
            line.numCornerVertices = 10;
            line.sharedMaterial = CreateGlowMaterial(Color.white, 1.65f);
            line.startColor = color;
            line.endColor = new Color(color.r, color.g, color.b, color.a * .08f);
            line.sortingOrder = sortingOrder;
            return line;
        }

        internal static LineRenderer CreateBezierLine(
            string name,
            Transform parent,
            Vector3 start,
            Vector3 controlA,
            Vector3 controlB,
            Vector3 end,
            Color color,
            float width,
            int segments = 28)
        {
            Vector3[] points = new Vector3[segments + 1];
            for (int i = 0; i <= segments; i++)
            {
                float t = i / (float)segments;
                float u = 1f - t;
                points[i] = u * u * u * start
                    + 3f * u * u * t * controlA
                    + 3f * u * t * t * controlB
                    + t * t * t * end;
            }
            return CreateLine(name, parent, points, color, width);
        }

        internal static Transform CreateBezierRibbon(
            string name,
            Transform parent,
            Vector3 start,
            Vector3 controlA,
            Vector3 controlB,
            Vector3 end,
            Color color,
            float width,
            int segments = 32)
        {
            Vector3[] points = new Vector3[segments + 1];
            for (int i = 0; i <= segments; i++)
            {
                float t = i / (float)segments;
                float u = 1f - t;
                points[i] = u * u * u * start + 3f * u * u * t * controlA + 3f * u * t * t * controlB + t * t * t * end;
            }
            Vector3[] vertices = new Vector3[(segments + 1) * 2];
            Vector2[] uv = new Vector2[vertices.Length];
            int[] triangles = new int[segments * 6];
            for (int i = 0; i <= segments; i++)
            {
                Vector3 tangent = (i == 0 ? points[1] - points[0] : i == segments ? points[segments] - points[segments - 1] : points[i + 1] - points[i - 1]).normalized;
                Vector3 sideways = Vector3.Cross(Vector3.forward, tangent).normalized * width * .5f;
                int vertex = i * 2;
                vertices[vertex] = points[i] - sideways;
                vertices[vertex + 1] = points[i] + sideways;
                float t = i / (float)segments;
                uv[vertex] = new Vector2(t, 0f);
                uv[vertex + 1] = new Vector2(t, 1f);
                if (i == segments) continue;
                int triangle = i * 6;
                triangles[triangle] = vertex;
                triangles[triangle + 1] = vertex + 2;
                triangles[triangle + 2] = vertex + 1;
                triangles[triangle + 3] = vertex + 1;
                triangles[triangle + 4] = vertex + 2;
                triangles[triangle + 5] = vertex + 3;
            }
            Mesh mesh = new() { name = name + " Mesh", vertices = vertices, uv = uv, triangles = triangles };
            mesh.RecalculateBounds();
            GameObject ribbon = new(name);
            ribbon.transform.SetParent(parent, false);
            ribbon.AddComponent<MeshFilter>().sharedMesh = mesh;
            ribbon.AddComponent<MeshRenderer>().sharedMaterial = CreateRibbonMaterial(color, 2.1f);
            return ribbon.transform;
        }

        internal static Transform CreateFiberRing(
            string name,
            Transform parent,
            Color color,
            int count,
            int offset,
            float innerRadius,
            float outerRadius)
        {
            GameObject go = new(name);
            go.transform.SetParent(parent, false);
            MeshFilter filter = go.AddComponent<MeshFilter>();
            MeshRenderer renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = CreateGlowMaterial(color, 1.8f);

            Vector3[] vertices = new Vector3[count * 4];
            int[] triangles = new int[count * 6];
            Color[] colors = new Color[vertices.Length];
            for (int i = 0; i < count; i++)
            {
                int globalIndex = offset + i * 4;
                float angle = globalIndex * Mathf.PI * 2f / (count * 4f);
                float jitter = Mathf.Sin(globalIndex * 2.17f) * .12f;
                float inner = innerRadius + jitter * .12f;
                float outer = outerRadius + jitter;
                float curl = .10f + .035f * Mathf.Sin(globalIndex * 1.71f);
                Vector2 a = new(Mathf.Cos(angle) * inner, Mathf.Sin(angle) * inner);
                Vector2 b = new(Mathf.Cos(angle + curl) * outer, Mathf.Sin(angle + curl) * outer);
                Vector2 normal = new(-(b.y - a.y), b.x - a.x);
                normal.Normalize();
                normal *= .008f + .004f * (.5f + .5f * Mathf.Sin(globalIndex));
                int v = i * 4;
                vertices[v] = new Vector3(a.x - normal.x, a.y - normal.y, 0);
                vertices[v + 1] = new Vector3(a.x + normal.x, a.y + normal.y, 0);
                vertices[v + 2] = new Vector3(b.x + normal.x, b.y + normal.y, 0);
                vertices[v + 3] = new Vector3(b.x - normal.x, b.y - normal.y, 0);
                colors[v] = colors[v + 1] = color * .35f;
                colors[v + 2] = colors[v + 3] = color;
                int t = i * 6;
                triangles[t] = v;
                triangles[t + 1] = v + 1;
                triangles[t + 2] = v + 2;
                triangles[t + 3] = v;
                triangles[t + 4] = v + 2;
                triangles[t + 5] = v + 3;
            }

            Mesh mesh = new() { name = name + " Mesh", vertices = vertices, triangles = triangles, colors = colors };
            mesh.RecalculateBounds();
            filter.sharedMesh = mesh;
            return go.transform;
        }

        internal static ParticleSystem CreateDust(Transform parent)
        {
            ParticleSystem particles = new GameObject("Volumetric Data Dust").AddComponent<ParticleSystem>();
            particles.transform.SetParent(parent, false);
            particles.transform.localPosition = new Vector3(0, 0, 3.4f);
            var main = particles.main;
            main.loop = true;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.startLifetime = new ParticleSystem.MinMaxCurve(10f, 18f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(.018f, .085f);
            main.startSize = new ParticleSystem.MinMaxCurve(.018f, .064f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(.05f, .30f, .52f, .12f),
                new Color(.18f, 1f, .72f, .66f));
            main.maxParticles = 340;
            var emission = particles.emission;
            emission.rateOverTime = 22f;
            var shape = particles.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(20f, 10.5f, 6f);
            var noise = particles.noise;
            noise.enabled = true;
            noise.strength = .12f;
            noise.frequency = .11f;
            noise.scrollSpeed = .06f;
            ParticleSystemRenderer renderer = particles.GetComponent<ParticleSystemRenderer>();
            Texture2D sprite = Resources.Load<Texture2D>("External/Kenney/ParticlePack/circle_05");
            renderer.sharedMaterial = CreateParticleMaterial(Color.white, 1.7f, sprite);
            return particles;
        }

        internal static ParticleSystem CreateEnergyHalo(Transform parent, Vector3 position, Color color, float radius)
        {
            ParticleSystem particles = new GameObject("Iris Energy Halo").AddComponent<ParticleSystem>();
            particles.transform.SetParent(parent, false);
            particles.transform.localPosition = position;
            var main = particles.main;
            main.loop = true;
            main.startLifetime = new ParticleSystem.MinMaxCurve(1.8f, 3.6f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(.015f, .09f);
            main.startSize = new ParticleSystem.MinMaxCurve(.05f, .16f);
            main.startRotation = new ParticleSystem.MinMaxCurve(0, Mathf.PI * 2f);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(color.r, color.g, color.b, .12f),
                new Color(color.r, color.g, color.b, .82f));
            main.maxParticles = 120;
            var emission = particles.emission;
            emission.rateOverTime = 18f;
            var shape = particles.shape;
            shape.shapeType = ParticleSystemShapeType.Circle;
            shape.radius = radius;
            shape.radiusThickness = .18f;
            var velocity = particles.velocityOverLifetime;
            velocity.enabled = true;
            // Unity requires all orbital axes to use the same MinMaxCurve mode.
            velocity.orbitalX = new ParticleSystem.MinMaxCurve(0f, 0f);
            velocity.orbitalY = new ParticleSystem.MinMaxCurve(0f, 0f);
            velocity.orbitalZ = new ParticleSystem.MinMaxCurve(-.22f, .22f);
            var noise = particles.noise;
            noise.enabled = true;
            noise.strength = .11f;
            noise.frequency = .32f;
            ParticleSystemRenderer renderer = particles.GetComponent<ParticleSystemRenderer>();
            Texture2D sprite = Resources.Load<Texture2D>("External/Kenney/ParticlePack/flare_01");
            renderer.sharedMaterial = CreateParticleMaterial(Color.white, 2.05f, sprite);
            return particles;
        }

        internal static TrailRenderer CreateTrail(Transform target, Color color, float width = .10f, float time = .65f)
        {
            TrailRenderer trail = target.gameObject.AddComponent<TrailRenderer>();
            trail.time = time;
            trail.minVertexDistance = .04f;
            trail.startWidth = width;
            trail.endWidth = 0f;
            trail.numCapVertices = 8;
            trail.sharedMaterial = CreateGlowMaterial(Color.white, 2f);
            Gradient gradient = new();
            gradient.SetKeys(
                new[] { new GradientColorKey(color, 0), new GradientColorKey(color * .45f, 1) },
                new[] { new GradientAlphaKey(.88f, 0), new GradientAlphaKey(0, 1) });
            trail.colorGradient = gradient;
            return trail;
        }
    }
}
