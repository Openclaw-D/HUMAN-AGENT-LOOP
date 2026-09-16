Shader "EYE/Transmission Ribbon"
{
    Properties
    {
        [HDR] _BaseColor("Transmission Color", Color) = (0.2,0.9,1,0.4)
        _Energy("Energy", Range(0,8)) = 2
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent-5" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off
        Pass
        {
            Name "TransmissionRibbon"
            Tags { "LightMode"="UniversalForward" }
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionHCS : SV_POSITION; float2 uv : TEXCOORD0; };
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float _Energy;
            CBUFFER_END
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.positionHCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                float edge = pow(saturate(1.0 - abs(input.uv.y * 2.0 - 1.0)), 1.45);
                float along = smoothstep(.02, .16, input.uv.x) * (1.0 - smoothstep(.78, .99, input.uv.x));
                float softPulse = .78 + .22 * sin(_Time.y * .75 + input.uv.x * 7.0);
                float3 radiance = _BaseColor.rgb * (.38 + edge * .62) * _Energy * softPulse;
                float alpha = _BaseColor.a * edge * along * .52;
                return half4(radiance, alpha);
            }
            ENDHLSL
        }
    }
}
