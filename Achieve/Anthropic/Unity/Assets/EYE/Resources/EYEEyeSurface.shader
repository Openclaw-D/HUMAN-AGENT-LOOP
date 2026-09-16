Shader "EYE/Eye Surface"
{
    Properties
    {
        _BaseMap("Eye", 2D) = "white" {}
        _HalfBlinkMap("Half Closed Eye", 2D) = "black" {}
        _BlinkMap("Closed Eye", 2D) = "black" {}
        _BaseColor("Tint", Color) = (1,1,1,1)
        _Awake("Awake", Range(0,1)) = 1
        _Focus("Focus", Range(0,1)) = 0
        _Opacity("Opacity", Range(0,1)) = 1
        _Exposure("Exposure", Range(0.5,2)) = 1
        _Inspection("Inspection", Range(0,1)) = 0
        _Blink("Blink", Range(0,1)) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-20" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off
        Pass
        {
            Name "EYEEyeSurface"
            Tags { "LightMode"="UniversalForward" }
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionHCS : SV_POSITION; float2 uv : TEXCOORD0; float3 positionWS : TEXCOORD1; };
            TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
            TEXTURE2D(_HalfBlinkMap); SAMPLER(sampler_HalfBlinkMap);
            TEXTURE2D(_BlinkMap); SAMPLER(sampler_BlinkMap);
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                float4 _BaseColor;
                float _Awake;
                float _Focus;
                float _Opacity;
                float _Exposure;
                float _Inspection;
                float _Blink;
            CBUFFER_END
            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionHCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                // 原图只在中央 72% x 85% 区域等比呈现（正好保持 3:2），绝不拉伸边缘像素。
                // 遮罩只作用于照片最外圈的皮肤区域；眼睑和睫毛所在区域始终保持 100% 不透明。
                float2 photoUvRaw = (input.uv - .5) / float2(.72, .85) + .5;
                float2 uv = saturate(photoUvRaw);
                half3 openEye = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, uv).rgb;
                half3 halfEye = SAMPLE_TEXTURE2D(_HalfBlinkMap, sampler_HalfBlinkMap, uv).rgb;
                half3 closedEye = SAMPLE_TEXTURE2D(_BlinkMap, sampler_BlinkMap, uv).rgb;
                float blinkValue = saturate(_Blink);
                half3 openingPhase = lerp(openEye, halfEye, smoothstep(.04, .54, blinkValue));
                half3 closingPhase = lerp(halfEye, closedEye * 1.22, smoothstep(.48, .98, blinkValue));
                half3 color = lerp(openingPhase, closingPhase, step(.5, blinkValue));
                color *= _BaseColor.rgb * _Exposure;

                // 外围过渡改为一整圈横向眼形：先沿上下眼睑弧线退场，再自然收进四角。
                // 眼睫毛区域仍在椭圆内侧安全区，绝不会被黑色背景硬切。
                float2 outer = abs((photoUvRaw - .5) * 2.0);
                float2 eyeArc = float2(outer.x * .86, outer.y * 1.12);
                float eyeEnvelope = dot(eyeArc, eyeArc);
                float arcMask = 1.0 - smoothstep(.76, 1.30, eyeEnvelope);

                // 边界保护防止采样到图像外缘后被拉成长条；与眼形过渡相乘后无矩形硬边。
                float boundsMask = 1.0 - smoothstep(.88, 1.0, max(outer.x, outer.y));
                float photoMask = arcMask * boundsMask;
                return half4(color, photoMask * _BaseColor.a * _Opacity);
            }
            ENDHLSL
        }
    }
}
