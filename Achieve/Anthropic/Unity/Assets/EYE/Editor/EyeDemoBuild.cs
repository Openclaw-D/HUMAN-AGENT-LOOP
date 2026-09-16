using System;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.Rendering;

namespace EYE.EditorTools
{
    internal static class EyeDemoBuild
    {
        // 成品固定放在当前 Unity 项目内，便于直接定位、复制和交付。
        private const string OutputDirectory = "Builds/Windows/EYE-Competition-Final";
        private const string OutputExecutable = OutputDirectory + "/EYE.exe";

        [MenuItem("EYE/Build Competition Final", priority = 1)]
        public static void BuildWindowsDemo()
        {
            ConfigurePlayer();
            if (Directory.Exists(OutputDirectory)) Directory.Delete(OutputDirectory, true);
            Directory.CreateDirectory(OutputDirectory);
            BuildPlayerOptions options = new()
            {
                scenes = new[] { "Assets/Scenes/SampleScene.unity" },
                locationPathName = OutputExecutable,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.CleanBuildCache
            };
            BuildReport report = BuildPipeline.BuildPlayer(options);
            BuildSummary summary = report.summary;
            if (summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException("EYE Windows build failed: " + summary.result);
            foreach (string debugDirectory in Directory.GetDirectories(OutputDirectory, "*BurstDebugInformation_DoNotShip"))
                Directory.Delete(debugDirectory, true);
            File.WriteAllText(
                Path.Combine(OutputDirectory, "演示说明.txt"),
                "看见 EYE｜全域风控 最终比赛版\r\n\r\n"
                + "1. 双击 EYE.exe 启动；目标电脑无需安装 Unity，也无需联网。\r\n"
                + "2. 必须保留并复制整个 EYE-Competition-Final 文件夹，不能只复制 EYE.exe。\r\n"
                + "3. 启动即进入并自动播放音乐；左键进入，点击章内审视眼、右键或 Esc 返回。\r\n"
                + "4. Q 切换比赛画质与核显稳定画质，M 静音，F11 切换全屏。\r\n"
                + "5. 推荐分辨率 1920×1080；现场运行不流畅时按一次 Q。\r\n\r\n"
                + "Version 1.1.0-cinematic | Unity " + Application.unityVersion + "\r\n",
                new UTF8Encoding(true));
            Debug.Log($"EYE_BUILD_SUCCESS path={Path.GetFullPath(OutputExecutable)} size={summary.totalSize} warnings={summary.totalWarnings}");
            if (!Application.isBatchMode) EditorUtility.RevealInFinder(OutputDirectory);
        }

        [MenuItem("EYE/Apply Demo Player Settings", priority = 20)]
        public static void ConfigurePlayer()
        {
            PlayerSettings.companyName = "EYE";
            PlayerSettings.productName = "看见 EYE｜全域风控";
            PlayerSettings.bundleVersion = "1.1.0-cinematic";
            PlayerSettings.defaultScreenWidth = 1920;
            PlayerSettings.defaultScreenHeight = 1080;
            PlayerSettings.fullScreenMode = FullScreenMode.FullScreenWindow;
            PlayerSettings.runInBackground = true;
            PlayerSettings.resizableWindow = false;
            PlayerSettings.usePlayerLog = true;
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.SplashScreen.show = false;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneWindows64, new[] { GraphicsDeviceType.Direct3D11 });
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Standalone, "com.eye.risk-intelligence-demo");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Standalone, ScriptingImplementation.Mono2x);
            // V3 使用主视觉原图的正方形裁切版，保证程序图标与场景中心视觉一致。
            Texture2D appIcon = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/EYE/Editor/Brand/EYE-Realistic-AppIcon-V3.png");
            if (appIcon != null)
            {
                int[] iconSizes = PlayerSettings.GetIconSizes(NamedBuildTarget.Standalone, IconKind.Any);
                Texture2D[] icons = new Texture2D[iconSizes.Length];
                for (int i = 0; i < icons.Length; i++) icons[i] = appIcon;
                PlayerSettings.SetIcons(NamedBuildTarget.Standalone, icons, IconKind.Any);
            }
            EditorUserBuildSettings.development = false;
            AssetDatabase.SaveAssets();
        }
    }
}
