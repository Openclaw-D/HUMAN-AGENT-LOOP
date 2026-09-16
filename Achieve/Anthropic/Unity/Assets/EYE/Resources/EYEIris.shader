Shader "EYE/Iris Field"
{
    Properties
    {
        [HDR] _CreditColor("Credit", Color) = (0.05,0.45,2,1)
        [HDR] _CommerceColor("Commerce", Color) = (0.05,1.4,1.1,1)
        [HDR] _PolicyColor("Policy", Color) = (1.0,0.45,2,1)
        [HDR] _AssetColor("Asset", Color) = (2.2,0.8,0.08,1)
        _Energy("Energy", Range(0,3)) = 0
        _FocusAngle("Focus angle", Range(-3.15,3.15)) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+20" "RenderPipeline"="UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off
        Pass
        {
            Name "EYEIris"
            Tags { "LightMode"="UniversalForward" }
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionHCS : SV_POSITION; float2 uv : TEXCOORD0; };
            CBUFFER_START(UnityPerMaterial)
                float4 _CreditColor;
                float4 _CommerceColor;
                float4 _PolicyColor;
                float4 _AssetColor;
                float _Energy;
                float _FocusAngle;
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
                float2 p = input.uv * 2 - 1;
                float radius = length(p);
                float angle = atan2(p.y, p.x);
                float radialAA = max(fwidth(radius) * 1.35, .0015);
                float outer = 1 - smoothstep(1.0 - radialAA, 1.0 + radialAA, radius);
                float inner = smoothstep(.31 - radialAA, .39 + radialAA, radius);
                float mask = outer * inner;
                float top = smoothstep(-.12, .12, p.y);
                float right = smoothstep(-.12, .12, p.x);
                half3 upper = lerp(_CreditColor.rgb, _CommerceColor.rgb, right);
                half3 lower = lerp(_PolicyColor.rgb, _AssetColor.rgb, right);
                half3 domain = lerp(lower, upper, top);
                // 由高频“虹膜纤维”改为低频、宽幅的柔和光束，避免产生惊悚的血丝/线网感。
                float broadRayA = pow(saturate(sin(angle * 4.0 + radius * 1.8 - _Time.y * .10) * .5 + .5), 3.2);
                float broadRayB = pow(saturate(cos(angle * 2.0 - radius * 2.4 + _Time.y * .07) * .5 + .5), 4.6);
                float radialGlow = smoothstep(.34, .62, radius) * (1.0 - smoothstep(.78, .98, radius));
                float focus = pow(saturate(cos(angle - _FocusAngle) * .5 + .5), 4.0) * .28;
                float pulse = .90 + .10 * sin(_Time.y * .72 + radius * 3.0);
                float strength = mask * (.16 + broadRayA * .46 + broadRayB * .20 + focus) * radialGlow * pulse * _Energy;
                half3 graphite = half3(.030, .055, .072);
                half3 fiberInk = lerp(graphite, saturate(domain) * .90, .78);
                return half4(fiberInk, saturate(strength * .74));
            }
            ENDHLSL
        }
    }
}
