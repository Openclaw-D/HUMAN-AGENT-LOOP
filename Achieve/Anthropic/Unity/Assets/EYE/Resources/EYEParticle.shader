Shader "EYE/Particle"
{
    Properties
    {
        _BaseMap("Particle", 2D) = "white" {}
        [HDR] _BaseColor("Color", Color) = (1,1,1,1)
        _Energy("Energy", Range(0,8)) = 1
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+10" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off
        Pass
        {
            Name "EYEParticle"
            Tags { "LightMode"="UniversalForward" }
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; };
            struct Varyings { float4 positionHCS : SV_POSITION; float2 uv : TEXCOORD0; float4 color : COLOR; };
            TEXTURE2D(_BaseMap); SAMPLER(sampler_BaseMap);
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                float4 _BaseColor;
                float _Energy;
            CBUFFER_END
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionHCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                output.color = input.color;
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                float2 p = input.uv * 2 - 1;
                float falloff = saturate(1 - dot(p, p));
                falloff = falloff * falloff * falloff;
                half4 c = _BaseColor * input.color;
                half4 tex = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv);
                float sprite = max(tex.a, dot(tex.rgb, half3(.2126, .7152, .0722)));
                sprite *= falloff;
                half3 graphite = half3(.055, .085, .095);
                half3 ink = lerp(graphite, saturate(c.rgb) * .90, .78);
                return half4(ink, saturate(sprite * c.a * (.42 + _Energy * .18)));
            }
            ENDHLSL
        }
    }
}
