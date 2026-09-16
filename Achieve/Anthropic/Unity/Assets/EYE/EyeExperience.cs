using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering.Universal;

namespace EYE
{
    [DisallowMultipleComponent]
    public sealed partial class EyeExperience : MonoBehaviour
    {
        private const float ChapterCycleDuration = 10f;

        private readonly Dictionary<Collider, EyeChapter> hitTargets = new();
        private readonly Dictionary<EyeChapter, Transform> hubAnchors = new();
        private readonly Dictionary<Transform, Vector3> baseScales = new();
        private readonly HashSet<EyeChapter> completedChapters = new();
        private readonly List<Transform> irisLayers = new();
        private readonly List<Transform> wingNodes = new();
        private readonly List<Transform> chapterNodes = new();
        private readonly List<Vector3> chapterNodePositions = new();
        private readonly List<LineRenderer> chapterLines = new();
        private readonly List<Transform> flowPackets = new();

        private Camera sceneCamera;
        private Transform generatedRoot;
        private Transform hubRoot;
        private Transform chapterRoot;
        private Transform chapterEyeRoot;
        private Transform backgroundGrid;
        private Transform centralEyeRoot;
        private Transform leftWingRoot;
        private Transform rightWingRoot;
        private Transform chapterCore;
        private Vector3 chapterCorePosition;
        private Vector3 chapterEyePosition;
        private EyeAudioSynth audioSynth;
        private EyeChapter currentChapter = EyeChapter.Hub;
        private EyeChapter hoveredChapter = EyeChapter.Hub;
        private EyeChapter previousHoveredChapter = EyeChapter.Hub;
        private float chapterClock;
        private float transitionProgress = 1f;
        // 比赛版进入即启动，真人眼本身就是系统状态，不再设置额外“唤醒”门槛。
        private bool awakened = true;
        private bool cyclePaused;
        private bool pointerHasHit;
        private bool competitionQuality = true;
        private Vector3 cameraBasePosition = new(0, 0, -17.8f);
        private Vector2 smoothedPointer;
        private ParticleSystem ambientDust;

        private Font chineseFont;
        private GUIStyle eyebrowStyle;
        private GUIStyle heroStyle;
        private GUIStyle titleStyle;
        private GUIStyle subtitleStyle;
        private GUIStyle nodeStyle;
        private GUIStyle smallStyle;
        private GUIStyle stepStyle;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Bootstrap()
        {
            if (FindAnyObjectByType<EyeExperience>() == null)
                new GameObject("EYE Experience").AddComponent<EyeExperience>();
        }

        private void Awake()
        {
            Application.targetFrameRate = 60;
            QualitySettings.vSyncCount = 1;
            QualitySettings.antiAliasing = 0;
            Cursor.visible = true;
            BuildWorld();
        }

        private void Start()
        {
            if (!Application.isEditor)
                Screen.SetResolution(1920, 1080, FullScreenMode.FullScreenWindow);
        }

        private void BuildWorld()
        {
            sceneCamera = Camera.main;
            if (sceneCamera == null)
            {
                sceneCamera = new GameObject("Main Camera").AddComponent<Camera>();
                sceneCamera.tag = "MainCamera";
            }
            sceneCamera.transform.SetPositionAndRotation(cameraBasePosition, Quaternion.identity);
            sceneCamera.orthographic = false;
            sceneCamera.fieldOfView = 37.5f;
            sceneCamera.nearClipPlane = .1f;
            sceneCamera.farClipPlane = 80f;
            sceneCamera.clearFlags = CameraClearFlags.SolidColor;
            // 会议室低亮度屏幕优先：接近纯白的暖米白基底，深色信息层负责对比。
            // 深石墨宇宙底：保留投影对比度，同时让眼源光束和钻石切面成为视觉焦点。
            sceneCamera.backgroundColor = new Color(.012f, .026f, .038f);
            sceneCamera.allowHDR = true;
            sceneCamera.allowMSAA = true;
            UniversalAdditionalCameraData cameraData = sceneCamera.GetUniversalAdditionalCameraData();
            cameraData.renderPostProcessing = true;
            cameraData.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            cameraData.antialiasingQuality = AntialiasingQuality.High;
            cameraData.dithering = true;
            foreach (Light light in FindObjectsByType<Light>()) light.enabled = false;

            generatedRoot = new GameObject("EYE Generated World").transform;
            generatedRoot.SetParent(transform, false);
            ambientDust = EyeVisualFactory.CreateDust(generatedRoot);
            BuildBackgroundGrid();
            BuildHub();
            chapterRoot = new GameObject("Chapter Stage").transform;
            chapterRoot.SetParent(generatedRoot, false);
            chapterRoot.gameObject.SetActive(false);
            chapterEyeRoot = new GameObject("Chapter Mother Eye / Fixed Layer").transform;
            chapterEyeRoot.SetParent(generatedRoot, false);
            chapterEyeRoot.gameObject.SetActive(false);
            audioSynth = gameObject.AddComponent<EyeAudioSynth>();
            audioSynth.Wake();
            ApplyQualityPreset();
        }

        private void BuildBackgroundGrid()
        {
            backgroundGrid = new GameObject("Deep Spatial Field").transform;
            backgroundGrid.SetParent(generatedRoot, false);
            Color color = new(.055f, .22f, .28f, .10f);
            for (int i = -6; i <= 6; i++)
            {
                float y = i * .82f;
                EyeVisualFactory.CreateBezierLine("Field Latitude", backgroundGrid,
                    new Vector3(-11, y, 6.8f), new Vector3(-4.2f, y * .88f, 4.2f),
                    new Vector3(4.2f, y * .88f, 4.2f), new Vector3(11, y, 6.8f), color, .011f, 30);
            }
            for (int i = -8; i <= 8; i++)
            {
                float x = i * 1.25f;
                EyeVisualFactory.CreateLine("Field Longitude", backgroundGrid,
                    new[] { new Vector3(x, -5.6f, 7.5f), new Vector3(x * .38f, 0, 4.1f), new Vector3(x, 5.6f, 7.5f) },
                    new Color(color.r, color.g, color.b, .095f), .009f);
            }

            Transform horizon = new GameObject("Distant Gravitational Horizon").transform;
            horizon.SetParent(backgroundGrid, false);
            Material coldLens = EyeVisualFactory.CreateGlowMaterial(new Color(.42f, .78f, 1f, .075f), 1.45f);
            Material warmLens = EyeVisualFactory.CreateGlowMaterial(new Color(1f, .73f, .38f, .055f), 1.35f);
            Transform outerLens = EyeVisualFactory.CreateRing(
                "Cold Cosmic Lens", horizon, new Vector3(0, .15f, 9.2f), 9.1f, .040f, coldLens,
                Quaternion.Euler(0, 0, -5f), 180);
            outerLens.localScale = new Vector3(1f, .34f, 1f);
            Transform innerLens = EyeVisualFactory.CreateRing(
                "Warm Cosmic Lens", horizon, new Vector3(0, .08f, 9.0f), 8.45f, .052f, warmLens,
                Quaternion.Euler(0, 0, 4f), 180);
            innerLens.localScale = new Vector3(1f, .30f, 1f);
            EyeVisualFactory.CreateLine(
                "Cosmic Horizon Filament",
                horizon,
                new[] { new Vector3(-11.4f, .08f, 8.92f), new Vector3(0, -.02f, 8.82f), new Vector3(11.4f, .08f, 8.92f) },
                new Color(.66f, .84f, 1f, .055f),
                .032f);
        }

        private void Update()
        {
            transitionProgress = Mathf.MoveTowards(transitionProgress, 1f, Time.unscaledDeltaTime * 1.55f);
            HandleInput();
            if (currentChapter == EyeChapter.Hub) UpdateHubAnimation();
            else UpdateChapterAnimation();
            UpdateCameraMotion();
        }

        private void HandleInput()
        {
            Mouse mouse = Mouse.current;
            Keyboard keyboard = Keyboard.current;
            bool goBack = (mouse != null && mouse.rightButton.wasPressedThisFrame)
                || (keyboard != null && keyboard.escapeKey.wasPressedThisFrame);
            if (goBack && currentChapter != EyeChapter.Hub)
            {
                ReturnToHub();
                return;
            }
            if (keyboard != null)
            {
                if (keyboard.spaceKey.wasPressedThisFrame && currentChapter != EyeChapter.Hub)
                {
                    cyclePaused = !cyclePaused;
                }
                if (keyboard.mKey.wasPressedThisFrame)
                {
                    audioSynth.ToggleMute();
                }
                if (keyboard.qKey.wasPressedThisFrame)
                {
                    competitionQuality = !competitionQuality;
                    ApplyQualityPreset();
                }
                if (keyboard.f11Key.wasPressedThisFrame) Screen.fullScreen = !Screen.fullScreen;
            }

            hoveredChapter = EyeChapter.Hub;
            pointerHasHit = false;
            if (mouse == null) return;
            Ray ray = sceneCamera.ScreenPointToRay(mouse.position.ReadValue());
            if (Physics.Raycast(ray, out RaycastHit hit, 60f) && hitTargets.TryGetValue(hit.collider, out EyeChapter target))
            {
                hoveredChapter = target;
                pointerHasHit = true;
            }
            // 主页标签属于 HUD 绘制，不自带 3D Collider。将标题卡片、周围柔焦留白与
            // 标签到入口的连接走廊统一视为入口热区，避免只能精准点到晶体本体。
            if (currentChapter == EyeChapter.Hub && !pointerHasHit
                && TryGetHubHudHit(mouse.position.ReadValue(), out EyeChapter hudTarget))
            {
                hoveredChapter = hudTarget;
                pointerHasHit = true;
            }
            if (hoveredChapter != previousHoveredChapter)
            {
                if (currentChapter == EyeChapter.Hub && CanOpen(hoveredChapter)) audioSynth.Hover(hoveredChapter);
                previousHoveredChapter = hoveredChapter;
            }
            if (!mouse.leftButton.wasPressedThisFrame) return;
            if (currentChapter != EyeChapter.Hub)
            {
                if (pointerHasHit && hoveredChapter == EyeChapter.Hub) ReturnToHub();
                return;
            }
            if (!pointerHasHit || hoveredChapter == EyeChapter.Hub) return;
            EnterChapter(hoveredChapter);
        }

        private bool CanOpen(EyeChapter chapter)
        {
            // 比赛展示采用自由浏览：主页上的全部业务入口从启动时即可进入。
            return true;
        }

        private void EnterChapter(EyeChapter chapter)
        {
            currentChapter = chapter;
            hoveredChapter = EyeChapter.Hub;
            previousHoveredChapter = EyeChapter.Hub;
            chapterClock = 0f;
            cyclePaused = false;
            transitionProgress = 0f;
            BuildChapterStage(chapter);
            hubRoot.gameObject.SetActive(false);
            backgroundGrid.gameObject.SetActive(false);
            chapterRoot.gameObject.SetActive(true);
            chapterEyeRoot.gameObject.SetActive(true);
            audioSynth.Activate(chapter);
        }

        private void ReturnToHub()
        {
            EyeChapter leaving = currentChapter;
            int coreIndex = EyeChapterData.CoreIndex(leaving);
            if (coreIndex >= 0)
            {
                completedChapters.Add(leaving);
            }
            currentChapter = EyeChapter.Hub;
            transitionProgress = 0f;
            chapterRoot.gameObject.SetActive(false);
            chapterEyeRoot.gameObject.SetActive(false);
            backgroundGrid.gameObject.SetActive(true);
            hubRoot.gameObject.SetActive(true);
            Shader.SetGlobalVector("_EyeLightPositionWS", centralEyeRoot.TransformPoint(new Vector3(.08f, -.02f, .62f)));
            audioSynth.Return(leaving);
        }

        private void ApplyQualityPreset()
        {
            QualitySettings.antiAliasing = 0;
            QualitySettings.anisotropicFiltering = AnisotropicFiltering.ForceEnable;
            QualitySettings.globalTextureMipmapLimit = 0;
            QualitySettings.lodBias = competitionQuality ? 2f : 1.25f;
            if (UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline
                is UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset pipeline)
            {
                pipeline.renderScale = competitionQuality ? 1.08f : .90f;
                pipeline.msaaSampleCount = 1;
            }
            if (sceneCamera != null)
            {
                UniversalAdditionalCameraData cameraData = sceneCamera.GetUniversalAdditionalCameraData();
                cameraData.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
                cameraData.antialiasingQuality = competitionQuality ? AntialiasingQuality.High : AntialiasingQuality.Medium;
                cameraData.dithering = true;
            }
            if (ambientDust != null)
            {
                var emission = ambientDust.emission;
                emission.rateOverTime = competitionQuality ? 22f : 9f;
                var main = ambientDust.main;
                main.maxParticles = competitionQuality ? 340 : 130;
            }
            UnityEngine.Rendering.Volume volume = FindAnyObjectByType<UnityEngine.Rendering.Volume>();
            if (volume != null && volume.profile != null
                && volume.profile.TryGet(out UnityEngine.Rendering.Universal.Bloom bloom))
            {
                // 只让 HDR 晶体切面与碎片热点绽开，维持背景暗部以获得珠宝级反差。
                bloom.threshold.value = .65f;
                bloom.intensity.value = competitionQuality ? .84f : .40f;
                bloom.maxIterations.value = competitionQuality ? 5 : 3;
            }
            if (volume != null && volume.profile != null
                && volume.profile.TryGet(out Tonemapping tonemapping))
                tonemapping.mode.value = TonemappingMode.Neutral;
            if (volume != null && volume.profile != null
                && volume.profile.TryGet(out Vignette vignette))
                vignette.intensity.value = 0f;
            if (volume != null && volume.profile != null
                && volume.profile.TryGet(out ColorAdjustments grading))
            {
                grading.postExposure.value = competitionQuality ? -.04f : -.08f;
                grading.contrast.value = competitionQuality ? 8f : 5f;
            }
        }
    }
}
