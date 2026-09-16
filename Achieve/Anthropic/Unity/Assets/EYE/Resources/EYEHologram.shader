Shader "EYE/Hologram"
{
    Properties
    {
        [HDR] _BaseColor("Color", Color) = (0.1,0.8,1,0.7)
        _Energy("Energy", Range(0,8)) = 1
        _Pulse("Pulse", Range(0,1)) = 0.5
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Back
        Pass
        {
            Name "EYEHologram"
            Tags { "LightMode"="UniversalForward" }
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings { float4 positionHCS : SV_POSITION; float3 positionWS : TEXCOORD0; float3 normalWS : TEXCOORD1; };
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float _Energy;
                float _Pulse;
            CBUFFER_END
            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionHCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                float3 view = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                float facing = saturate(dot(SafeNormalize(input.normalWS), view));
                float fresnel = pow(1 - facing, 2.15);
                float scanPhase = input.positionWS.y * 27 - _Time.y * 3.1;
                float scanSignal = sin(scanPhase) * .5 + .5;
                float scanAA = min(.34, fwidth(scanPhase) * .30 + .018);
                float scan = smoothstep(.78 - scanAA, .78 + scanAA, scanSignal);
                float facet = sin(input.positionWS.x * 8.7 + input.positionWS.z * 6.1)
                    * sin(input.positionWS.y * 9.3 - input.positionWS.z * 4.8) * .5 + .5;
                float micro = smoothstep(.76, .94, facet) * .11;
                float pulse = .88 + .12 * sin(_Time.y * 1.55 + input.positionWS.x * 1.3 + input.positionWS.z * .8);
                float rimSpark = pow(1 - facing, 5.5) * (1.1 + .25 * sin(_Time.y * 3.2));
                float strength = (.10 + fresnel * 1.34 + rimSpark * .52 + scan * .25 + micro) * pulse * _Energy;
                float alpha = saturate(_BaseColor.a * (.30 + fresnel * .58 + scan * .12 + micro));
                half3 graphite = half3(.040, .065, .078);
                half3 ink = lerp(graphite, saturate(_BaseColor.rgb) * .92, .78);
                half3 color = ink * (.82 + strength * .22) + half3(.78, .86, .88) * rimSpark * .12;
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
