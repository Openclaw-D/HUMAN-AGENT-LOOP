Shader "EYE/Diamond"
{
    Properties
    {
        [HDR] _BaseColor("Diamond Tint", Color) = (0.72,0.94,1.0,0.86)
        _Energy("Optical Energy", Range(0,4)) = 1.5
        _Clarity("Clarity", Range(0,1)) = 0.86
        _CrystalSeed("Crystal Variation", Range(0,100)) = 0
        _Sparkle("Specular Sparkle", Range(0,3)) = 1
        _Refraction("Background Refraction", Range(0,0.08)) = 0.018
        _TintStrength("Business Tint Strength", Range(0,0.50)) = 0.24
        _Dispersion("Spectral Dispersion", Range(0,1.5)) = 0.9
        _InternalReflection("Internal Reflection", Range(0,1.5)) = 0.9
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+20" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Back

        Pass
        {
            Name "EYEDiamond"
            Tags { "LightMode"="UniversalForward" }

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareOpaqueTexture.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
            };

            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 positionOS : TEXCOORD2;
                float4 screenPos : TEXCOORD3;
            };

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float _Energy;
                float _Clarity;
                float _CrystalSeed;
                float _Sparkle;
                float _Refraction;
                float _TintStrength;
                float _Dispersion;
                float _InternalReflection;
            CBUFFER_END
            float4 _EyeLightPositionWS;

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionHCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.positionOS = input.positionOS.xyz;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.screenPos = ComputeScreenPos(positions.positionCS);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float3 viewDirection = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                float3 normalDirection = SafeNormalize(input.normalWS);
                if (dot(normalDirection, viewDirection) < 0.0) normalDirection *= -1.0;

                float facing = saturate(dot(normalDirection, viewDirection));
                float fresnel = pow(1.0 - facing, 4.15);

                // 真人眼是所有晶体的主光源；摄影棚方向仅保留为低强度补光和轮廓光。
                float3 keyDirection = SafeNormalize(_EyeLightPositionWS.xyz - input.positionWS);
                float3 fillDirection = SafeNormalize(float3(0.72, 0.24, 0.65));
                float3 rimDirection = SafeNormalize(float3(-0.22, -0.56, 0.80));
                float key = pow(saturate(dot(reflect(-keyDirection, normalDirection), viewDirection)), 78.0);
                float fill = pow(saturate(dot(reflect(-fillDirection, normalDirection), viewDirection)), 42.0);
                float rim = pow(saturate(dot(reflect(-rimDirection, normalDirection), viewDirection)), 110.0);

                float seedA = frac(sin(_CrystalSeed * 91.17) * 43758.53);
                float seedB = frac(sin((_CrystalSeed + 17.0) * 37.31) * 12515.71);
                float facetBand = abs(frac(dot(input.positionOS, float3(1.37 + seedA, 2.11 + seedB, 1.73 + seedA * .6)) * (1.35 + seedB)) - .5);
                float inclusion = sin(dot(input.positionOS, float3(14.7, 23.2, 18.1)) + _CrystalSeed * 6.1) * .5 + .5;
                float internalCaustic = pow(saturate(1.0 - facetBand * 2.0), 7.0) * (1.0 - facing) * (.32 + seedA * .26);
                float pathLength = saturate(.28 + (1.0 - facing) * .72 + abs(input.positionOS.y) * .10);
                float body = lerp(.095, .018, _Clarity) + pathLength * lerp(.075, .022, _Clarity);

                float3 coldWhite = float3(0.94, 0.975, 1.0);
                float3 graphite = float3(0.025, 0.050, 0.066);
                float3 businessTint = lerp(coldWhite, saturate(_BaseColor.rgb), _TintStrength);
                float faceShade = .34 + .66 * saturate(dot(normalDirection, keyDirection) * .5 + .5);
                // 对 RGB 使用不同折射距离，形成真正可见但克制的光谱色散。
                float2 screenUV = input.screenPos.xy / input.screenPos.w;
                float2 refractOffset = normalDirection.xy * (.008 + (1.0 - facing) * .020) * (_Refraction / .018) * (1.0 + seedA * .45);
                float spectralShift = .16 * _Dispersion;
                float3 transmitted;
                transmitted.r = SampleSceneColor(screenUV + refractOffset * (1.0 + spectralShift)).r;
                transmitted.g = SampleSceneColor(screenUV + refractOffset).g;
                transmitted.b = SampleSceneColor(screenUV + refractOffset * (1.0 - spectralShift)).b;
                transmitted *= businessTint * (.64 + _Clarity * .25) * (1.0 - fresnel * .68);

                // 反向采样近似钻石内部全反射；暗面与亮面同时存在，避免均匀发光的塑料感。
                float3 internalSample = SampleSceneColor(screenUV - refractOffset * (.52 + seedB * .26));
                float totalInternalReflection = pow(1.0 - facing, 2.15) * _InternalReflection;
                float3 optical = transmitted;
                optical += internalSample * totalInternalReflection * (.18 + pathLength * .22);
                optical += graphite * body * (1.0 - faceShade) * .74;
                // 黑色场景缺少可折射环境时，补入克制的珠宝棚拍白色环境响应；
                // 它只塑造透明体积和切面明暗，不使用业务色把整颗晶体点亮。
                float studioFill = .032 + faceShade * .052 + body * .26 + fresnel * .055;
                optical += coldWhite * studioFill;
                optical += businessTint * body * (.10 + pathLength * .08);
                // 内部焦散直接携带业务原色，外表面与镜面高光仍保持无色白光。
                optical += saturate(_BaseColor.rgb) * internalCaustic * (.48 + _TintStrength * 1.7);

                // 真实珠宝高光以白色为主，业务色只轻微进入内部焦散。
                float sparklePulse = .93 + .07 * sin(_Time.y * (1.35 + seedB) + _CrystalSeed * 9.7);
                optical += coldWhite * (key * (1.28 + _Sparkle * .50) + fill * .34 + rim * (1.16 + _Sparkle * .30)) * sparklePulse;
                optical += coldWhite * pow(inclusion, 22.0) * internalCaustic * .20;
                float edgeFire = pow(1.0 - facing, 5.0) * _Dispersion;
                optical += float3(.13, .06, .20) * edgeFire * (.24 + seedA * .12);
                optical *= lerp(.82, 1.0, saturate(_Energy * .42));
                optical *= 1.82 * (1.0 + _Energy * .15);

                float alpha = saturate(_BaseColor.a * (.32 + (1.0 - _Clarity) * .08
                    + fresnel * .42 + key * .16 + fill * .035 + internalCaustic * .075));
                return half4(optical, alpha);
            }
            ENDHLSL
        }
    }
}
