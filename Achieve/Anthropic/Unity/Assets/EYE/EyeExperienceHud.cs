using UnityEngine;

namespace EYE
{
    public sealed partial class EyeExperience
    {
        private const float HudWidth = 1920f;
        private const float HudHeight = 1080f;
        private const int TransitionRingSegments = 64;
        private static readonly Color Graphite = new(.92f, .96f, .95f, 1f);
        private static readonly Color MutedGraphite = new(.56f, .68f, .69f, 1f);
        private static readonly Color IvoryPanel = new(.018f, .038f, .052f, .62f);

        private static readonly string[] StepNumbers = { "01", "02", "03", "04", "05" };
        private ChapterDefinition[] hudDefinitionCache;
        private float[] transitionRingCos;
        private float[] transitionRingSin;
        private GUIStyle leftEyebrowStyle;
        private GUIStyle rightEyebrowStyle;
        private GUIStyle leftHeroStyle;
        private GUIStyle brandHeroStyle;
        private GUIStyle rightHeroStyle;
        private GUIStyle leftSubtitleStyle;
        private GUIStyle rightSubtitleStyle;
        private GUIStyle worldLabelStyle;
        private GUIStyle worldCoreStyle;
        private GUIStyle hudMicroLeftStyle;
        private GUIStyle hudMicroRightStyle;
        private GUIStyle hudMicroCenterStyle;
        private GUIStyle stepNumberStyle;
        private GUIStyle stepBodyStyle;
        private bool hudStylesReady;
        private float hudScale = 1f;
        private float hudOffsetX;
        private float hudOffsetY;

        private void OnGUI()
        {
            EnsureStyles();
            UpdateHudTransform();

            Matrix4x4 previousMatrix = GUI.matrix;
            Color previousColor = GUI.color;
            GUI.matrix = Matrix4x4.TRS(
                new Vector3(hudOffsetX, hudOffsetY, 0f),
                Quaternion.identity,
                new Vector3(hudScale, hudScale, 1f));

            if (currentChapter == EyeChapter.Hub) DrawHubHud();
            else DrawChapterHud();
            DrawTransition();

            GUI.matrix = previousMatrix;
            GUI.color = previousColor;
        }

        private void DrawHubHud()
        {
            ChapterDefinition hub = GetHudDefinition(EyeChapter.Hub);
            DrawBrandHeader(hub);

            DrawHubWorldLabel(EyeChapter.Origin);
            for (int i = 0; i < EyeChapterData.CoreOrder.Length; i++)
            {
                EyeChapter chapter = EyeChapterData.CoreOrder[i];
                DrawHubWorldLabel(chapter);
            }
            DrawHubWorldLabel(EyeChapter.Ecosystem);
        }

        private void DrawBrandHeader(ChapterDefinition hub)
        {
            Color accent = hub.Color;
            DrawRect(new Rect(54f, 52f, 3f, 146f), new Color(accent.r, accent.g, accent.b, .76f));
            DrawRect(new Rect(70f, 52f, 118f, 2f), new Color(accent.r, accent.g, accent.b, .62f));

            leftEyebrowStyle.normal.textColor = new Color(accent.r, accent.g, accent.b, .88f);
            GUI.Label(new Rect(82f, 38f, 760f, 48f), hub.Eyebrow, leftEyebrowStyle);
            GUI.Label(new Rect(78f, 76f, 620f, 82f), hub.Title, brandHeroStyle);
            GUI.Label(new Rect(82f, 152f, 620f, 42f), hub.Tagline, leftSubtitleStyle);
        }

        private void DrawHubWorldLabel(EyeChapter chapter)
        {
            if (!hubAnchors.TryGetValue(chapter, out Transform anchor)) return;

            ChapterDefinition definition = GetHudDefinition(chapter);
            bool open = CanOpen(chapter);
            bool complete = completedChapters.Contains(chapter);
            bool hover = hoveredChapter == chapter;
            Color color = open
                ? definition.Color
                : Color.Lerp(new Color(.48f, .56f, .54f, 1f), definition.Color, .30f);
            if (!TryGetHubLabelPoint(chapter, anchor, out Vector2 point)) return;
            string displayTitle = chapter switch
            {
                EyeChapter.Origin => "共创",
                EyeChapter.Ecosystem => "全域",
                _ => definition.Title
            };
            DrawHudTag(point, displayTitle, color, hover, complete, !open, false);
        }

        private bool TryGetHubHudHit(Vector2 screenPoint, out EyeChapter chapter)
        {
            chapter = EyeChapter.Hub;
            if (sceneCamera == null) return false;

            UpdateHudTransform();
            Vector2 pointer = ScreenToHud(new Vector3(screenPoint.x, screenPoint.y, 1f));
            EyeChapter[] chapters =
            {
                EyeChapter.Origin,
                EyeChapter.Credit,
                EyeChapter.Commerce,
                EyeChapter.Policy,
                EyeChapter.Asset,
                EyeChapter.Collaboration,
                EyeChapter.Ecosystem
            };

            for (int i = 0; i < chapters.Length; i++)
            {
                EyeChapter candidate = chapters[i];
                if (!hubAnchors.TryGetValue(candidate, out Transform anchor)
                    || !TryGetHubLabelPoint(candidate, anchor, out Vector2 labelPoint))
                    continue;

                // 标签本身 286×68；扩大为柔焦可触达区，并补齐到入口之间的视觉连接走廊。
                Rect softHitArea = new(labelPoint.x - 202f, labelPoint.y - 82f, 404f, 164f);
                Vector3 anchorScreen = sceneCamera.WorldToScreenPoint(anchor.position);
                Vector2 anchorPoint = ScreenToHud(anchorScreen);
                if (softHitArea.Contains(pointer) || DistanceToSegment(pointer, anchorPoint, labelPoint) <= 46f)
                {
                    chapter = candidate;
                    return true;
                }
            }
            return false;
        }

        private bool TryGetHubLabelPoint(EyeChapter chapter, Transform anchor, out Vector2 point)
        {
            point = default;
            if (anchor == null || sceneCamera == null) return false;
            Vector3 screen = sceneCamera.WorldToScreenPoint(anchor.position);
            if (screen.z <= 0f) return false;

            Vector2 labelOffset = chapter switch
            {
                // 两侧入口与中央眼睛共用水平中线，文字放在图形内侧并保持垂直居中。
                EyeChapter.Origin => new Vector2(150f, 0f),
                EyeChapter.Ecosystem => new Vector2(-150f, 0f),
                _ => new Vector2(0f, -104f)
            };
            point = ClampHudTagPoint(ScreenToHud(screen) + labelOffset, false);
            return true;
        }

        private static float DistanceToSegment(Vector2 point, Vector2 start, Vector2 end)
        {
            Vector2 segment = end - start;
            float lengthSquared = segment.sqrMagnitude;
            if (lengthSquared < .001f) return Vector2.Distance(point, start);
            float t = Mathf.Clamp01(Vector2.Dot(point - start, segment) / lengthSquared);
            return Vector2.Distance(point, start + segment * t);
        }

        private void DrawChapterHud()
        {
            ChapterDefinition definition = GetHudDefinition(currentChapter);
            bool headerOnRight = currentChapter == EyeChapter.Commerce
                || currentChapter == EyeChapter.Ecosystem
                || currentChapter == EyeChapter.Asset;

            float cycle = Mathf.Repeat(chapterClock, ChapterCycleDuration);
            int stepCount = Mathf.Max(1, definition.CycleSteps.Length);
            float stepDuration = ChapterCycleDuration / stepCount;
            int step = Mathf.Min(stepCount - 1, Mathf.FloorToInt(cycle / stepDuration));
            float stepProgress = Mathf.Clamp01((cycle - step * stepDuration) / stepDuration);

            // 子页面只保留场景中的单层业务路径；HUD 不再重复叠加点阵线路。
            DrawChapterHeader(definition, headerOnRight);
            DrawChapterWorldLabels(definition, step);
            // 领导演示时始终从同一处读取流程：所有章节固定在左上标题下方。
            DrawCurrentStepPod(definition, step, stepProgress);

        }

        private void DrawChapterHeader(ChapterDefinition definition, bool onRight)
        {
            bool bottom = currentChapter == EyeChapter.Policy || currentChapter == EyeChapter.Asset;
            float top = bottom ? 778f : 48f;
            float x = onRight ? 1040f : 76f;
            float lineX = onRight ? 1862f : 56f;
            GUIStyle eyebrow = onRight ? rightEyebrowStyle : leftEyebrowStyle;
            GUIStyle hero = onRight ? rightHeroStyle : leftHeroStyle;
            GUIStyle subtitle = onRight ? rightSubtitleStyle : leftSubtitleStyle;

            eyebrow.normal.textColor = new Color(definition.Color.r, definition.Color.g, definition.Color.b, .90f);
            DrawRect(new Rect(lineX, top, 3f, 205f), new Color(definition.Color.r, definition.Color.g, definition.Color.b, .72f));
            DrawRect(new Rect(onRight ? lineX - 118f : lineX + 15f, top, 104f, 2f),
                new Color(definition.Color.r, definition.Color.g, definition.Color.b, .42f));
            GUI.Label(new Rect(x, top - 14f, 820f, 48f), definition.Eyebrow, eyebrow);
            GUI.Label(new Rect(x, top + 28f, 820f, 112f), definition.Title, hero);
            GUI.Label(new Rect(x, top + 140f, 820f, 58f), definition.Tagline, subtitle);
        }

        private void DrawChapterWorldLabels(ChapterDefinition definition, int activeStep)
        {
            if (sceneCamera == null) return;
            Color coreColor = definition.Color;
            if (chapterCore != null)
            {
                Vector3 coreScreen = sceneCamera.WorldToScreenPoint(chapterCore.position);
                if (coreScreen.z > 0f)
                {
                    Vector2 coreAnchor = ScreenToHud(coreScreen);
                    Vector2 coreOffset = new(0f, -146f);
                    Vector2 coreLabel = ClampHudTagPoint(coreAnchor + coreOffset, true);
                    DrawHudConnector(coreAnchor, coreLabel, coreColor, true, true);
                    DrawHudTag(coreLabel, definition.Core, coreColor, true, false, false, true);
                }
            }

            int count = Mathf.Min(chapterNodes.Count, definition.Nodes.Length);
            for (int i = 0; i < count; i++)
            {
                Color source = currentChapter == EyeChapter.Collaboration ? CollaborationColor(i) : definition.Color;
                bool active = i == activeStep;
                Color color = active
                    ? source
                    : new Color(source.r * .62f, source.g * .68f, source.b * .66f, .86f);
                Vector3 screen = sceneCamera.WorldToScreenPoint(chapterNodes[i].position);
                if (screen.z <= 0f) continue;
                Vector2 anchor = ScreenToHud(screen);
                // 标签必须跟随对应晶体的实时投影，固定在晶体正上方；不能使用独立屏幕网格，
                // 否则晶体位置或页面构图变化后，文字会与所属节点脱钩。
                Vector2 label = ClampChapterNodeLabelPoint(anchor + new Vector2(0f, -112f));
                DrawHudConnector(anchor, label, color, active, false);
                DrawHudTag(label, definition.Nodes[i], color, active, false, false, false, true);
            }
        }

        private static Vector2 ClampChapterNodeLabelPoint(Vector2 point)
        {
            const float width = 286f;
            const float height = 68f;
            point.x = Mathf.Clamp(point.x, width * .5f + 18f, HudWidth - width * .5f - 18f);
            // 子页面顶部的中央区域可安全承载节点文字，不能沿用通用的 250px 标题避让，
            // 否则顶部晶体的标签会被钳到晶体下方。
            point.y = Mathf.Clamp(point.y, height * .5f + 28f, HudHeight - height * .5f - 42f);
            return point;
        }

        private static void DrawHudConnector(
            Vector2 anchor,
            Vector2 label,
            Color color,
            bool active,
            bool core)
        {
            Vector2 direction = label - anchor;
            float distance = direction.magnitude;
            if (distance < 28f) return;
            Vector2 normalized = direction / distance;
            float startPadding = core ? 34f : 22f;
            float endPadding = core ? 52f : 42f;
            float usable = Mathf.Max(0f, distance - startPadding - endPadding);
            Vector2 start = anchor + normalized * startPadding;
            int points = Mathf.Clamp(Mathf.RoundToInt(usable / 18f), 4, 28);
            for (int i = 0; i < points; i++)
            {
                float t = points <= 1 ? 0f : i / (float)(points - 1);
                Vector2 point = start + normalized * usable * t;
                float size = active && i % 4 == 0 ? 4f : 2f;
                float alpha = active ? Mathf.Lerp(.20f, .62f, t) : Mathf.Lerp(.08f, .24f, t);
                Color ink = Color.Lerp(Graphite, color, .58f);
                DrawRect(new Rect(point.x - size * .5f, point.y - size * .5f, size, size),
                    new Color(ink.r, ink.g, ink.b, alpha));
            }
        }

        private void DrawCurrentStepPod(ChapterDefinition definition, int step, float stepProgress)
        {
            Rect pod = currentChapter switch
            {
                EyeChapter.Commerce or EyeChapter.Ecosystem => new Rect(1530f, 270f, 360f, 286f),
                EyeChapter.Policy => new Rect(30f, 472f, 360f, 286f),
                EyeChapter.Asset => new Rect(1530f, 472f, 360f, 286f),
                _ => new Rect(30f, 270f, 360f, 286f)
            };
            Color accent = definition.Color;
            Color accentInk = Color.Lerp(Graphite, accent, .62f);

            DrawRect(new Rect(pod.x + 8f, pod.y + 9f, pod.width, pod.height), new Color(.04f, .06f, .07f, .10f));
            DrawPanel(pod, IvoryPanel, accentInk);
            DrawRect(new Rect(pod.x, pod.y, 3f, pod.height), new Color(accentInk.r, accentInk.g, accentInk.b, .78f));
            DrawRect(new Rect(pod.x + 24f, pod.y + 34f, 42f, 2f), new Color(accentInk.r, accentInk.g, accentInk.b, .72f));

            hudMicroLeftStyle.normal.textColor = new Color(accentInk.r, accentInk.g, accentInk.b, .90f);
            GUI.Label(new Rect(pod.x + 78f, pod.y + 13f, 240f, 42f), "LIVE PROCESS", hudMicroLeftStyle);

            stepNumberStyle.normal.textColor = new Color(accentInk.r, accentInk.g, accentInk.b, 1f);
            GUI.Label(new Rect(pod.x + 24f, pod.y + 44f, 132f, 92f), StepNumbers[Mathf.Min(step, StepNumbers.Length - 1)], stepNumberStyle);
            hudMicroLeftStyle.normal.textColor = new Color(MutedGraphite.r, MutedGraphite.g, MutedGraphite.b, .78f);
            GUI.Label(new Rect(pod.x + 148f, pod.y + 77f, 88f, 42f), "/ 05", hudMicroLeftStyle);

            stepBodyStyle.normal.textColor = Graphite;
            GUI.Label(new Rect(pod.x + 24f, pod.y + 132f, pod.width - 54f, 74f), definition.CycleSteps[step], stepBodyStyle);

            const float progressWidth = 294f;
            DrawRect(new Rect(pod.x + 24f, pod.y + 216f, progressWidth, 2f), new Color(.16f, .21f, .22f, .26f));
            DrawRect(new Rect(pod.x + 24f, pod.y + 216f, progressWidth * stepProgress, 2f),
                new Color(accentInk.r, accentInk.g, accentInk.b, .88f));
            float scanX = pod.x + 24f + progressWidth * stepProgress;
            DrawRect(new Rect(scanX - 2f, pod.y + 209f, 4f, 16f), new Color(accentInk.r, accentInk.g, accentInk.b, .92f));

            hudMicroLeftStyle.normal.textColor = cyclePaused
                ? new Color(.62f, .34f, .08f, .88f)
                : new Color(MutedGraphite.r, MutedGraphite.g, MutedGraphite.b, .76f);
            GUI.Label(new Rect(pod.x + 24f, pod.y + 226f, pod.width - 48f, 42f),
                cyclePaused ? "PAUSED / SPACE" : "AUTO CYCLE / LIVE", hudMicroLeftStyle);

            for (int i = 0; i < definition.CycleSteps.Length; i++)
            {
                float y = pod.y + 58f + i * 34f;
                float alpha = i == step ? .94f : i < step ? .48f : .18f;
                DrawRect(new Rect(pod.xMax - 24f, y, i == step ? 12f : 6f, 3f),
                    new Color(accentInk.r, accentInk.g, accentInk.b, alpha));
            }
        }

        private void DrawTransition()
        {
            if (transitionProgress >= 1f) return;

            float progress = Mathf.Clamp01(transitionProgress);
            float eased = progress * progress * (3f - 2f * progress);
            float envelope = Mathf.Sin(progress * Mathf.PI);
            Color accent = GetHudDefinition(currentChapter).Color;
            Vector2 center = GetTransitionCenter();
            float radius = Mathf.Lerp(54f, 1160f, eased);

            DrawRadialRing(center, radius, radius * .56f, accent, envelope * .66f, 0);
            DrawRadialRing(center, Mathf.Max(18f, radius - 42f), Mathf.Max(12f, radius * .56f - 24f),
                accent, envelope * .28f, 2);
            DrawRadialRing(center, radius + 58f, radius * .56f + 32f, accent, envelope * .16f, 3);

            float sweepAngle = (-118f + progress * 422f) * Mathf.Deg2Rad;
            DrawScannerRay(center, sweepAngle, Mathf.Min(radius + 80f, 1220f), accent, envelope);

            float scanY = Mathf.Lerp(86f, HudHeight - 86f, Mathf.Repeat(progress * 1.34f, 1f));
            DrawRect(new Rect(0f, scanY, HudWidth, 1f), new Color(accent.r, accent.g, accent.b, envelope * .16f));
            DrawRect(new Rect(0f, scanY + 7f, HudWidth, 1f), new Color(accent.r, accent.g, accent.b, envelope * .05f));

            DrawRect(new Rect(center.x - 17f, center.y, 34f, 1f), new Color(accent.r, accent.g, accent.b, envelope * .82f));
            DrawRect(new Rect(center.x, center.y - 17f, 1f, 34f), new Color(accent.r, accent.g, accent.b, envelope * .82f));
            DrawCornerFrame(new Rect(center.x - 28f, center.y - 28f, 56f, 56f),
                new Color(accent.r, accent.g, accent.b, envelope * .58f), 9f, 1f);
        }

        private Vector2 GetTransitionCenter()
        {
            Transform target = null;
            if (currentChapter == EyeChapter.Hub)
                hubAnchors.TryGetValue(EyeChapter.Collaboration, out target);
            else
                target = chapterCore;

            if (target == null || sceneCamera == null) return new Vector2(HudWidth * .5f, HudHeight * .5f);
            Vector3 screen = sceneCamera.WorldToScreenPoint(target.position);
            if (screen.z <= 0f) return new Vector2(HudWidth * .5f, HudHeight * .5f);
            return ScreenToHud(screen);
        }

        private void DrawRadialRing(Vector2 center, float radiusX, float radiusY, Color color, float alpha, int skip)
        {
            if (alpha <= .001f) return;
            int stride = skip + 1;
            for (int i = 0; i < TransitionRingSegments; i += stride)
            {
                float x = center.x + transitionRingCos[i] * radiusX;
                float y = center.y + transitionRingSin[i] * radiusY;
                float marker = i % 8 == 0 ? 4f : 2f;
                DrawRect(new Rect(x - marker * .5f, y - marker * .5f, marker, marker),
                    new Color(color.r, color.g, color.b, alpha));
            }
        }

        private static void DrawScannerRay(Vector2 center, float angle, float radius, Color color, float envelope)
        {
            float directionX = Mathf.Cos(angle);
            float directionY = Mathf.Sin(angle) * .56f;
            for (int trail = 0; trail < 4; trail++)
            {
                float trailAngle = angle - trail * .022f;
                directionX = Mathf.Cos(trailAngle);
                directionY = Mathf.Sin(trailAngle) * .56f;
                float alpha = envelope * (.42f - trail * .085f);
                for (int point = 2; point <= 32; point++)
                {
                    float distance = radius * point / 32f;
                    float size = point % 5 == 0 ? 3f : 1f;
                    DrawRect(new Rect(center.x + directionX * distance - size * .5f,
                            center.y + directionY * distance - size * .5f, size, size),
                        new Color(color.r, color.g, color.b, alpha * point / 32f));
                }
            }
        }

        private void DrawWorldTag(
            Vector3 worldPosition,
            string text,
            Color color,
            bool active,
            bool complete,
            bool locked,
            bool core)
        {
            if (sceneCamera == null) return;
            Vector3 screen = sceneCamera.WorldToScreenPoint(worldPosition);
            if (screen.z <= 0f) return;

            Vector2 point = ScreenToHud(screen);
            DrawHudTag(point, text, color, active, complete, locked, core);
        }

        private void DrawHudTag(
            Vector2 point,
            string text,
            Color color,
            bool active,
            bool complete,
            bool locked,
            bool core,
            bool chapterNode = false)
        {
            float width = core ? 346f : 286f;
            float height = core ? 84f : 68f;
            point = chapterNode ? ClampChapterNodeLabelPoint(point) : ClampHudTagPoint(point, core);
            Rect tag = new(point.x - width * .5f, point.y - height * .5f, width, height);
            float panelAlpha = active ? .70f : locked ? .62f : .58f;

            DrawRect(new Rect(tag.x + 6f, tag.y + 7f, tag.width, tag.height), new Color(.04f, .06f, .07f, .14f));
            DrawRect(tag, new Color(IvoryPanel.r, IvoryPanel.g, IvoryPanel.b, panelAlpha));
            DrawCornerFrame(tag, new Color(Graphite.r, Graphite.g, Graphite.b, active ? .34f : .22f), 18f, 1f);
            DrawRect(new Rect(tag.x, tag.y, active ? tag.width : 34f, 1f),
                new Color(color.r, color.g, color.b, active ? .86f : .42f));
            DrawRect(new Rect(tag.x, tag.y, 2f, tag.height),
                new Color(Graphite.r, Graphite.g, Graphite.b, active ? .58f : .22f));
            DrawRect(new Rect(tag.x + 18f, tag.yMax - 1f, tag.width - 36f, 1f),
                new Color(Graphite.r, Graphite.g, Graphite.b, active ? .32f : .12f));
            DrawRect(new Rect(tag.xMax - 26f, tag.y + 9f, 16f, 2f),
                new Color(Graphite.r, Graphite.g, Graphite.b, active ? .64f : .24f));
            DrawRect(new Rect(tag.xMax - 12f, tag.y + 9f, 2f, 14f),
                new Color(Graphite.r, Graphite.g, Graphite.b, active ? .64f : .24f));
            DrawRect(new Rect(tag.x + 14f, tag.center.y - 4f, 8f, 8f),
                new Color(color.r, color.g, color.b, locked ? .18f : active ? .96f : .58f));

            GUIStyle style = core ? worldCoreStyle : worldLabelStyle;
            // 深色宇宙底上保持文字高亮，色相只作为轻微边缘染色，避免节点标题被背景吞掉。
            Color accentText = Color.Lerp(Graphite, color, active ? .22f : .12f);
            style.normal.textColor = locked
                ? new Color(.66f, .73f, .72f, .92f)
                : new Color(accentText.r, accentText.g, accentText.b, active ? 1f : .92f);
            GUI.Label(new Rect(tag.x + 30f, tag.y, tag.width - 46f, tag.height), text, style);

            if (complete)
            {
                DrawRect(new Rect(tag.xMax - 27f, tag.y + 20f, 12f, 2f), new Color(color.r, color.g, color.b, .86f));
                DrawRect(new Rect(tag.xMax - 21f, tag.y + 14f, 2f, 14f), new Color(color.r, color.g, color.b, .86f));
            }
            else if (locked)
            {
                DrawCornerFrame(new Rect(tag.xMax - 20f, tag.y + 10f, 10f, 10f),
                    new Color(.30f, .39f, .37f, .46f), 3f, 1f);
            }
        }

        private static Vector2 ClampHudTagPoint(Vector2 point, bool core)
        {
            float width = core ? 346f : 286f;
            float height = core ? 84f : 68f;
            point.x = Mathf.Clamp(point.x, width * .5f + 18f, HudWidth - width * .5f - 18f);
            point.y = Mathf.Clamp(point.y, height * .5f + 250f, HudHeight - height * .5f - 42f);
            return point;
        }

        private Vector2 ScreenToHud(Vector3 screen)
        {
            float x = (screen.x - hudOffsetX) / Mathf.Max(.001f, hudScale);
            float y = (Screen.height - screen.y - hudOffsetY) / Mathf.Max(.001f, hudScale);
            return new Vector2(x, y);
        }

        private void UpdateHudTransform()
        {
            hudScale = Mathf.Max(.001f, Mathf.Min(Screen.width / HudWidth, Screen.height / HudHeight));
            hudOffsetX = (Screen.width - HudWidth * hudScale) * .5f;
            hudOffsetY = (Screen.height - HudHeight * hudScale) * .5f;
        }

        private ChapterDefinition GetHudDefinition(EyeChapter chapter)
        {
            hudDefinitionCache ??= new ChapterDefinition[8];
            int index = (int)chapter;
            ChapterDefinition definition = hudDefinitionCache[index];
            if (definition != null) return definition;
            definition = EyeChapterData.Get(chapter);
            hudDefinitionCache[index] = definition;
            return definition;
        }

        private void EnsureStyles()
        {
            if (hudStylesReady) return;

            chineseFont = Font.CreateDynamicFontFromOSFont(
                new[] { "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "SimHei", "Arial" }, 108);
            if (chineseFont == null) chineseFont = GUI.skin.font;

            eyebrowStyle = MakeStyle(28, TextAnchor.MiddleCenter, MutedGraphite, FontStyle.Bold);
            heroStyle = MakeStyle(96, TextAnchor.MiddleCenter, Graphite, FontStyle.Bold);
            titleStyle = MakeStyle(38, TextAnchor.MiddleCenter, Graphite, FontStyle.Bold);
            subtitleStyle = MakeStyle(32, TextAnchor.MiddleCenter, MutedGraphite);
            nodeStyle = MakeStyle(32, TextAnchor.MiddleCenter, Graphite, FontStyle.Bold);
            smallStyle = MakeStyle(24, TextAnchor.MiddleCenter, MutedGraphite);
            stepStyle = MakeStyle(24, TextAnchor.UpperLeft, MutedGraphite);
            stepStyle.wordWrap = true;

            leftEyebrowStyle = MakeStyle(28, TextAnchor.MiddleLeft, Graphite, FontStyle.Bold);
            rightEyebrowStyle = MakeStyle(28, TextAnchor.MiddleRight, Graphite, FontStyle.Bold);
            leftHeroStyle = MakeStyle(96, TextAnchor.MiddleLeft, Graphite, FontStyle.Bold);
            brandHeroStyle = MakeStyle(67, TextAnchor.MiddleLeft, Graphite, FontStyle.Bold);
            rightHeroStyle = MakeStyle(96, TextAnchor.MiddleRight, Graphite, FontStyle.Bold);
            leftSubtitleStyle = MakeStyle(32, TextAnchor.MiddleLeft, MutedGraphite);
            rightSubtitleStyle = MakeStyle(32, TextAnchor.MiddleRight, MutedGraphite);
            worldLabelStyle = MakeStyle(32, TextAnchor.MiddleCenter, Graphite, FontStyle.Bold);
            worldCoreStyle = MakeStyle(38, TextAnchor.MiddleCenter, Graphite, FontStyle.Bold);
            hudMicroLeftStyle = MakeStyle(22, TextAnchor.MiddleLeft, Graphite, FontStyle.Bold);
            hudMicroRightStyle = MakeStyle(22, TextAnchor.MiddleRight, Graphite, FontStyle.Bold);
            hudMicroCenterStyle = MakeStyle(20, TextAnchor.MiddleCenter, Graphite, FontStyle.Bold);
            stepNumberStyle = MakeStyle(84, TextAnchor.MiddleLeft, Graphite, FontStyle.Bold);
            stepBodyStyle = MakeStyle(34, TextAnchor.UpperLeft, Graphite, FontStyle.Bold);
            stepBodyStyle.wordWrap = true;

            transitionRingCos = new float[TransitionRingSegments];
            transitionRingSin = new float[TransitionRingSegments];
            for (int i = 0; i < TransitionRingSegments; i++)
            {
                float angle = i * Mathf.PI * 2f / TransitionRingSegments;
                transitionRingCos[i] = Mathf.Cos(angle);
                transitionRingSin[i] = Mathf.Sin(angle);
            }

            hudStylesReady = true;
        }

        private GUIStyle MakeStyle(int fontSize, TextAnchor alignment, Color color, FontStyle fontStyle = FontStyle.Normal)
        {
            GUIStyle style = new(GUI.skin.label)
            {
                font = chineseFont,
                fontSize = fontSize,
                alignment = alignment,
                fontStyle = fontStyle,
                richText = false,
                clipping = TextClipping.Clip
            };
            style.normal.textColor = color;
            return style;
        }

        private static void DrawPanel(Rect rect, Color color, Color accent)
        {
            DrawRect(rect, color);
            DrawRect(new Rect(rect.x, rect.y, rect.width, 1f), new Color(accent.r, accent.g, accent.b, .42f));
            DrawRect(new Rect(rect.x, rect.yMax - 1f, rect.width, 1f), new Color(Graphite.r, Graphite.g, Graphite.b, .24f));
            DrawCornerFrame(rect, new Color(accent.r, accent.g, accent.b, .52f), 16f, 1f);
        }

        private static void DrawCornerFrame(Rect rect, Color color, float length, float thickness)
        {
            DrawRect(new Rect(rect.x, rect.y, length, thickness), color);
            DrawRect(new Rect(rect.x, rect.y, thickness, length), color);
            DrawRect(new Rect(rect.xMax - length, rect.y, length, thickness), color);
            DrawRect(new Rect(rect.xMax - thickness, rect.y, thickness, length), color);
            DrawRect(new Rect(rect.x, rect.yMax - thickness, length, thickness), color);
            DrawRect(new Rect(rect.x, rect.yMax - length, thickness, length), color);
            DrawRect(new Rect(rect.xMax - length, rect.yMax - thickness, length, thickness), color);
            DrawRect(new Rect(rect.xMax - thickness, rect.yMax - length, thickness, length), color);
        }

        private static void DrawRect(Rect rect, Color color)
        {
            Color previous = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = previous;
        }
    }
}
