Shader "EYE/Leaf Hologram"
{
    Properties
    {
        _BaseMap("Leaf Color", 2D) = "white" {}
        _OpacityMap("Leaf Opacity", 2D) = "white" {}
        [HDR] _BaseColor("Tint", Color) = (0.4,1,0.55,0.65)
    }
    SubShader
    {
        Tags { "RenderType"="TransparentCutout" "Queue"="Transparent-10" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off
        Pass
        {
            Name "EYELeaf"
            Tags { "LightMode"="UniversalForward" }
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionHCS : SV_POSITION; float2 uv : TEXCOORD0; float3 positionWS : TEXCOORD1; };
            TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
            TEXTURE2D(_OpacityMap); SAMPLER(sampler_OpacityMap);
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                float4 _OpacityMap_ST;
                float4 _BaseColor;
            CBUFFER_END
            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs position = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionHCS = position.positionCS;
                output.positionWS = position.positionWS;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                half3 leaf = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv).rgb;
                float opacity = SAMPLE_TEXTURE2D(_OpacityMap, sampler_OpacityMap, input.uv).r;
                clip(opacity - .08);
                // 保留 CC0 实拍叶片自身的脉络与综合色，不再用扫描光把它处理成全息卡片。
                float veinLight = .72 + saturate(sin(input.positionWS.y * 7.0 + input.positionWS.x * 4.0) * .5 + .5) * .28;
                half3 color = leaf * lerp(half3(.78, .88, .72), _BaseColor.rgb, .18) * veinLight;
                return half4(color * opacity, opacity * .96);
            }
            ENDHLSL
        }
    }
}
