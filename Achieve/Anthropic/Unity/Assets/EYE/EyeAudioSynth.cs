using System;
using System.Collections.Generic;
using UnityEngine;

namespace EYE
{
    /// <summary>
    /// 完全离线的原创电影级声场：低频引力层、宽立体声和声、星尘高频与长尾空间脉冲。
    /// 所有缓冲区在 Awake 预分配，音频线程不产生托管分配。
    /// </summary>
    [DisallowMultipleComponent]
    internal sealed class EyeAudioSynth : MonoBehaviour
    {
        private const int SineTableSize = 8192;
        private const double SoundscapeDuration = 96.0;
        private const double MasterGain = 1.50;

        private static readonly double[] HarmonyMultipliers = { 1.0, 1.122462, .890899, 1.33484 };
        private static readonly double[] VoiceRatios = { 1.0, 1.5, 2.0, 2.25, 3.0, 4.5 };
        private static readonly double[] LeftDetune = { -.0018, .0024, -.0032, .0011, -.0021, .0038 };
        private static readonly double[] RightDetune = { .0021, -.0016, .0035, -.0027, .0018, -.0031 };
        private static readonly float[] VoicePan = { -.62f, .48f, -.24f, .68f, .16f, -.78f };

        private readonly struct AudioProfile
        {
            internal readonly double Root;
            internal readonly float Density;
            internal readonly float Warmth;
            internal readonly double PulseRate;
            internal readonly double[] Motif;
            internal readonly double MotifInterval;
            internal readonly float Pan;

            internal AudioProfile(
                double root,
                float density,
                float warmth,
                double pulseRate,
                double[] motif,
                double motifInterval,
                float pan)
            {
                Root = root;
                Density = density;
                Warmth = warmth;
                PulseRate = pulseRate;
                Motif = motif;
                MotifInterval = motifInterval;
                Pan = pan;
            }
        }

        private readonly struct Sweep
        {
            internal readonly double From;
            internal readonly double To;
            internal readonly float Duration;
            internal readonly float Volume;
            internal readonly float Delay;
            internal readonly float Pan;
            internal readonly int Character;

            internal Sweep(double from, double to, float duration, float volume, float delay, float pan, int character = 0)
            {
                From = from;
                To = to;
                Duration = duration;
                Volume = volume;
                Delay = delay;
                Pan = pan;
                Character = character;
            }
        }

        private readonly Dictionary<string, AudioClip> clipCache = new();
        private AudioProfile[] profiles;
        private AudioSource ambientSource;
        private AudioSource oneShotSource;
        private volatile int requestedProfile;
        private volatile float requestedGain;
        private int sampleRate;
        private float[] sineTable;
        private double[] leftPhases;
        private double[] rightPhases;
        private float[] reverbLeft;
        private float[] reverbRight;
        private int reverbCursor;
        private double subPhase;
        private double gravityPhase;
        private double motifLeftPhase;
        private double motifRightPhase;
        private double soundscapeTime;
        private double smoothedRoot = 36.71;
        private float smoothedGain;
        private uint noiseState = 0x5EED1234;
        private float smoothNoiseLeft;
        private float smoothNoiseRight;
        private bool awakened;
        private float hoverCooldown;

        internal bool IsMuted => ambientSource != null && ambientSource.mute;

        private void Awake()
        {
            sampleRate = Math.Max(22050, AudioSettings.outputSampleRate);
            profiles = CreateProfiles();
            leftPhases = new double[VoiceRatios.Length];
            rightPhases = new double[VoiceRatios.Length];
            sineTable = new float[SineTableSize];
            for (int i = 0; i < sineTable.Length; i++)
                sineTable[i] = (float)Math.Sin(i * Math.PI * 2.0 / sineTable.Length);

            // 两秒循环空间缓冲，四个互质延迟抽头形成宽阔、不会轰鸣的长尾。
            reverbLeft = new float[sampleRate * 2];
            reverbRight = new float[sampleRate * 2];
            requestedProfile = 0;
            requestedGain = 0f;

            ambientSource = gameObject.AddComponent<AudioSource>();
            ambientSource.loop = true;
            ambientSource.playOnAwake = false;
            ambientSource.spatialBlend = 0f;
            ambientSource.volume = .82f;
            ambientSource.clip = AudioClip.Create(
                "EYE Original Cosmic Score",
                sampleRate * 4,
                2,
                sampleRate,
                true,
                FillAudio);

            oneShotSource = gameObject.AddComponent<AudioSource>();
            oneShotSource.playOnAwake = false;
            oneShotSource.spatialBlend = 0f;
            oneShotSource.volume = .88f;
        }

        private void Update()
        {
            hoverCooldown = Mathf.Max(0f, hoverCooldown - Time.unscaledDeltaTime);
        }

        internal void Wake()
        {
            if (awakened) return;
            awakened = true;
            requestedProfile = 0;
            requestedGain = .72f;
            ambientSource.Play();
            PlaySweeps("system-online", new[]
            {
                new Sweep(32.7, 25.9, 3.0f, .14f, 0f, 0f, 2),
                new Sweep(73.4, 98.0, 2.2f, .070f, .16f, -.28f),
                new Sweep(110.0, 82.4, 2.5f, .058f, .28f, .30f)
            });
        }

        internal void Activate(EyeChapter chapter)
        {
            if (!awakened) Wake();
            requestedProfile = ProfileIndex(chapter);
            requestedGain = .86f;
            PlaySweeps("enter-" + chapter, EnterSweeps(chapter, false));
        }

        internal void Return(EyeChapter chapter)
        {
            if (!awakened) return;
            requestedProfile = 0;
            requestedGain = .72f;
            PlaySweeps("return-" + chapter, EnterSweeps(chapter, true));
        }

        internal void Hover(EyeChapter chapter)
        {
            if (!awakened || hoverCooldown > 0f || chapter == EyeChapter.Hub) return;
            hoverCooldown = .20f;
            float pan = ChapterPan(chapter);
            double frequency = chapter switch
            {
                EyeChapter.Origin => 146.8,
                EyeChapter.Credit => 164.8,
                EyeChapter.Commerce => 130.8,
                EyeChapter.Policy => 123.5,
                EyeChapter.Asset => 110.0,
                EyeChapter.Collaboration => 98.0,
                EyeChapter.Ecosystem => 155.6,
                _ => 130.8
            };
            PlaySweeps("hover-" + chapter, new[]
            {
                new Sweep(frequency, frequency * 1.12, .28f, .036f, 0f, pan)
            });
        }

        internal void ToggleMute()
        {
            bool next = !ambientSource.mute;
            ambientSource.mute = next;
            oneShotSource.mute = next;
        }

        private void FillAudio(float[] data)
        {
            int profileIndex = Math.Max(0, Math.Min(profiles.Length - 1, requestedProfile));
            AudioProfile profile = profiles[profileIndex];
            float targetGain = requestedGain;
            double secondsPerSample = 1.0 / sampleRate;

            int tapA = Math.Max(1, (int)(sampleRate * .193));
            int tapB = Math.Max(1, (int)(sampleRate * .317));
            int tapC = Math.Max(1, (int)(sampleRate * .479));
            int tapD = Math.Max(1, (int)(sampleRate * .713));

            for (int sample = 0; sample < data.Length; sample += 2)
            {
                smoothedGain += (targetGain - smoothedGain) * .00032f;
                soundscapeTime += secondsPerSample;
                if (soundscapeTime >= SoundscapeDuration) soundscapeTime -= SoundscapeDuration;

                double sectionPosition = soundscapeTime / 24.0;
                int section = (int)sectionPosition & 3;
                double localSection = sectionPosition - Math.Floor(sectionPosition);
                double transition = Smooth01((localSection - .72) / .28);
                double currentHarmony = HarmonyMultipliers[section];
                double nextHarmony = HarmonyMultipliers[(section + 1) & 3];
                double harmony = currentHarmony + (nextHarmony - currentHarmony) * transition;
                double rootTarget = profile.Root * harmony;
                smoothedRoot += (rootTarget - smoothedRoot) * .000018;

                double macroSwell = .5 - .5 * Math.Cos(soundscapeTime * Math.PI * 2.0 / 16.0);
                double deepBreath = .72 + .28 * Math.Sin(soundscapeTime * Math.PI * 2.0 / 21.0);

                subPhase = WrapPhase(subPhase + smoothedRoot * .5 * secondsPerSample);
                double sub = Lookup(subPhase) * .105 + Lookup(subPhase * 2.0) * .034;
                double left = sub;
                double right = sub;

                for (int voice = 0; voice < VoiceRatios.Length; voice++)
                {
                    double frequency = smoothedRoot * VoiceRatios[voice];
                    leftPhases[voice] = WrapPhase(leftPhases[voice] + frequency * (1.0 + LeftDetune[voice]) * secondsPerSample);
                    rightPhases[voice] = WrapPhase(rightPhases[voice] + frequency * (1.0 + RightDetune[voice]) * secondsPerSample);
                    double shimmer = 1.0 + Math.Sin(soundscapeTime * (.071 + voice * .009) + voice * 1.7) * .12;
                    double amplitude = (.018 + profile.Density * .011) * (1.0 - voice * .075) * shimmer;
                    double toneLeft = SoftTone(leftPhases[voice], profile.Warmth);
                    double toneRight = SoftTone(rightPhases[voice], profile.Warmth);
                    double pan = VoicePan[voice];
                    left += toneLeft * amplitude * (pan > 0 ? .64 : 1.0);
                    right += toneRight * amplitude * (pan < 0 ? .64 : 1.0);
                }

                double gravityPosition = soundscapeTime * profile.PulseRate;
                double gravityEnvelope = Math.Exp(-(gravityPosition - Math.Floor(gravityPosition)) * 4.8);
                gravityPhase = WrapPhase(gravityPhase + smoothedRoot * .75 * secondsPerSample);
                double gravity = (Lookup(gravityPhase) * .058 + Lookup(gravityPhase * .5) * .032)
                    * gravityEnvelope * (.58 + macroSwell * .42);
                left += gravity;
                right += gravity;

                if (profile.Motif.Length > 0)
                {
                    double motifPosition = soundscapeTime % profile.MotifInterval;
                    double motifLength = 2.8;
                    if (motifPosition < motifLength)
                    {
                        int noteIndex = (int)(soundscapeTime / profile.MotifInterval) % profile.Motif.Length;
                        double envelope = Math.Sin(Math.PI * motifPosition / motifLength);
                        envelope *= envelope;
                        double motifFrequency = profile.Motif[noteIndex] * harmony;
                        motifLeftPhase = WrapPhase(motifLeftPhase + motifFrequency * .997 * secondsPerSample);
                        motifRightPhase = WrapPhase(motifRightPhase + motifFrequency * 1.003 * secondsPerSample);
                        double motifGain = .020 * envelope * (.62 + macroSwell * .38);
                        left += SoftTone(motifLeftPhase, .28f) * motifGain * (profile.Pan > 0 ? .62 : 1.0);
                        right += SoftTone(motifRightPhase, .28f) * motifGain * (profile.Pan < 0 ? .62 : 1.0);
                    }
                }

                noiseState = noiseState * 1664525u + 1013904223u;
                float whiteLeft = ((noiseState >> 8) / 8388607.5f) - 1f;
                noiseState = noiseState * 1664525u + 1013904223u;
                float whiteRight = ((noiseState >> 8) / 8388607.5f) - 1f;
                smoothNoiseLeft = smoothNoiseLeft * .982f + whiteLeft * .018f;
                smoothNoiseRight = smoothNoiseRight * .979f + whiteRight * .021f;
                double dustGain = .014 + macroSwell * .013;
                left += smoothNoiseLeft * dustGain;
                right += smoothNoiseRight * dustGain;

                left *= deepBreath;
                right *= deepBreath;

                int indexA = WrapIndex(reverbCursor - tapA, reverbLeft.Length);
                int indexB = WrapIndex(reverbCursor - tapB, reverbLeft.Length);
                int indexC = WrapIndex(reverbCursor - tapC, reverbLeft.Length);
                int indexD = WrapIndex(reverbCursor - tapD, reverbLeft.Length);
                double wetLeft = reverbLeft[indexA] * .33 + reverbRight[indexB] * .27
                    + reverbLeft[indexC] * .21 + reverbRight[indexD] * .15;
                double wetRight = reverbRight[indexA] * .33 + reverbLeft[indexB] * .27
                    + reverbRight[indexC] * .21 + reverbLeft[indexD] * .15;

                reverbLeft[reverbCursor] = (float)(left + wetRight * .19);
                reverbRight[reverbCursor] = (float)(right + wetLeft * .19);
                reverbCursor++;
                if (reverbCursor >= reverbLeft.Length) reverbCursor = 0;

                double outputLeft = (left + wetLeft * .22) * smoothedGain;
                double outputRight = (right + wetRight * .22) * smoothedGain;
                data[sample] = SoftLimit(outputLeft * MasterGain);
                if (sample + 1 < data.Length) data[sample + 1] = SoftLimit(outputRight * MasterGain);
            }
        }

        private double SoftTone(double phase, float warmth)
        {
            return Lookup(phase)
                + Lookup(phase * 2.0) * (.16 + warmth * .16)
                + Lookup(phase * 3.0) * (.045 + warmth * .065)
                + Lookup(phase * 5.0) * (.018 + warmth * .022);
        }

        private float Lookup(double phase)
        {
            double wrapped = WrapPhase(phase) * SineTableSize;
            int index = (int)wrapped;
            int next = (index + 1) & (SineTableSize - 1);
            float fraction = (float)(wrapped - index);
            return sineTable[index] + (sineTable[next] - sineTable[index]) * fraction;
        }

        private static double WrapPhase(double phase)
        {
            return phase - Math.Floor(phase);
        }

        private static int WrapIndex(int index, int length)
        {
            while (index < 0) index += length;
            return index >= length ? index % length : index;
        }

        private static double Smooth01(double value)
        {
            value = Math.Max(0.0, Math.Min(1.0, value));
            return value * value * (3.0 - 2.0 * value);
        }

        private static float SoftLimit(double value)
        {
            return (float)(Math.Tanh(value * 1.42) * .82);
        }

        private void PlaySweeps(string key, Sweep[] sweeps)
        {
            // 保留同一次冲击的多层结构，但切换页面时先清掉旧转场，避免快速操作造成峰值叠加。
            oneShotSource.Stop();
            for (int i = 0; i < sweeps.Length; i++)
            {
                string clipKey = key + "-" + i;
                if (!clipCache.TryGetValue(clipKey, out AudioClip clip))
                {
                    clip = BuildSweepClip(clipKey, sweeps[i]);
                    clipCache.Add(clipKey, clip);
                }
                oneShotSource.PlayOneShot(clip);
            }
        }

        private AudioClip BuildSweepClip(string name, Sweep sweep)
        {
            int delaySamples = Mathf.RoundToInt(sweep.Delay * sampleRate);
            int durationSamples = Mathf.Max(1, Mathf.RoundToInt(sweep.Duration * sampleRate));
            int tailSamples = Mathf.RoundToInt(1.35f * sampleRate);
            int totalSamples = delaySamples + durationSamples + tailSamples;
            float[] mono = new float[durationSamples];
            float[] samples = new float[totalSamples * 2];
            double phase = 0;
            uint localNoise = (uint)name.GetHashCode() ^ 0xA51CE55u;

            for (int frame = 0; frame < durationSamples; frame++)
            {
                float t = frame / (float)Math.Max(1, durationSamples - 1);
                double frequency = sweep.From * Math.Pow(Math.Max(.001, sweep.To / sweep.From), Smooth01(Math.Min(1.0, t / .88)));
                phase = WrapPhase(phase + frequency / sampleRate);
                double tone = Lookup(phase) + Lookup(phase * 2.0) * .22 + Lookup(phase * 3.0) * .07;
                localNoise = localNoise * 1664525u + 1013904223u;
                float noise = ((localNoise >> 8) / 8388607.5f) - 1f;
                float attack = Mathf.Clamp(.065f / Mathf.Max(.1f, sweep.Duration), .015f, .20f);
                float envelope = t < attack
                    ? Mathf.SmoothStep(0, 1, t / attack)
                    : Mathf.Pow(1f - Mathf.InverseLerp(attack, 1f, t), sweep.Character == 2 ? 2.2f : 1.25f);
                float air = sweep.Character == 1 ? noise * (.08f + t * .11f) : noise * .018f;
                float impact = sweep.Character == 2 ? (float)Lookup(phase * .5) * Mathf.Exp(-t * 8f) * .55f : 0f;
                mono[frame] = ((float)tone + air + impact) * sweep.Volume * envelope;
            }

            MixMonoIntoStereo(samples, mono, delaySamples, sweep.Pan, 1f);
            MixMonoIntoStereo(samples, mono, delaySamples + Mathf.RoundToInt(sampleRate * .211f), -sweep.Pan * .45f, .30f);
            MixMonoIntoStereo(samples, mono, delaySamples + Mathf.RoundToInt(sampleRate * .407f), sweep.Pan * .32f, .20f);
            MixMonoIntoStereo(samples, mono, delaySamples + Mathf.RoundToInt(sampleRate * .683f), -sweep.Pan * .24f, .12f);

            for (int i = 0; i < samples.Length; i++) samples[i] = SoftLimit(samples[i] * MasterGain);
            AudioClip clip = AudioClip.Create(name, totalSamples, 2, sampleRate, false);
            clip.SetData(samples, 0);
            return clip;
        }

        private static void MixMonoIntoStereo(float[] target, float[] source, int offsetFrames, float pan, float gain)
        {
            double leftPan = Math.Cos((Mathf.Clamp(pan, -1f, 1f) + 1f) * Math.PI * .25);
            double rightPan = Math.Sin((Mathf.Clamp(pan, -1f, 1f) + 1f) * Math.PI * .25);
            int availableFrames = target.Length / 2 - offsetFrames;
            int frames = Math.Min(source.Length, Math.Max(0, availableFrames));
            for (int frame = 0; frame < frames; frame++)
            {
                int sample = (offsetFrames + frame) * 2;
                float value = source[frame] * gain;
                target[sample] += value * (float)leftPan;
                target[sample + 1] += value * (float)rightPan;
            }
        }

        private static int ProfileIndex(EyeChapter chapter)
        {
            return chapter switch
            {
                EyeChapter.Origin => 1,
                EyeChapter.Credit => 2,
                EyeChapter.Commerce => 3,
                EyeChapter.Policy => 4,
                EyeChapter.Asset => 5,
                EyeChapter.Collaboration => 6,
                EyeChapter.Ecosystem => 7,
                _ => 0
            };
        }

        private static float ChapterPan(EyeChapter chapter)
        {
            return chapter switch
            {
                EyeChapter.Origin => -.72f,
                EyeChapter.Credit => -.52f,
                EyeChapter.Commerce => .54f,
                EyeChapter.Policy => -.38f,
                EyeChapter.Asset => .42f,
                EyeChapter.Ecosystem => .72f,
                _ => 0f
            };
        }

        private static Sweep[] EnterSweeps(EyeChapter chapter, bool returning)
        {
            float pan = ChapterPan(chapter) * (returning ? -1f : 1f);
            Sweep[] source = chapter switch
            {
                EyeChapter.Origin => new[]
                {
                    new Sweep(41.2, 30.9, 2.35f, .145f, 0f, pan, 2),
                    new Sweep(98.0, 146.8, 1.85f, .070f, .10f, -pan)
                },
                EyeChapter.Credit => new[]
                {
                    new Sweep(46.25, 34.65, 2.20f, .155f, 0f, pan, 2),
                    new Sweep(110.0, 82.4, 1.95f, .072f, .10f, -pan)
                },
                EyeChapter.Commerce => new[]
                {
                    new Sweep(43.65, 32.7, 2.15f, .150f, 0f, pan, 2),
                    new Sweep(87.3, 130.8, 1.90f, .074f, .12f, -pan)
                },
                EyeChapter.Policy => new[]
                {
                    new Sweep(38.89, 29.14, 2.45f, .150f, 0f, pan, 2),
                    new Sweep(73.4, 110.0, 2.05f, .068f, .14f, -pan)
                },
                EyeChapter.Asset => new[]
                {
                    new Sweep(36.71, 27.5, 2.10f, .165f, 0f, pan, 2),
                    new Sweep(98.0, 65.4, 1.85f, .080f, .09f, -pan)
                },
                EyeChapter.Collaboration => new[]
                {
                    new Sweep(32.7, 24.5, 2.75f, .155f, 0f, -.28f, 2),
                    new Sweep(49.0, 73.4, 2.45f, .105f, .06f, .28f, 2),
                    new Sweep(82.4, 61.7, 2.10f, .070f, .16f, 0f)
                },
                EyeChapter.Ecosystem => new[]
                {
                    new Sweep(41.2, 30.9, 2.35f, .155f, 0f, pan, 2),
                    new Sweep(82.4, 123.5, 1.95f, .074f, .12f, -pan)
                },
                _ => Array.Empty<Sweep>()
            };

            if (!returning) return source;
            Sweep[] reversed = new Sweep[source.Length];
            for (int i = 0; i < source.Length; i++)
            {
                Sweep value = source[i];
                reversed[i] = new Sweep(
                    value.To,
                    value.From,
                    value.Duration * .88f,
                    value.Volume * .76f,
                    value.Delay,
                    value.Pan,
                    value.Character);
            }
            return reversed;
        }

        private static AudioProfile[] CreateProfiles()
        {
            return new[]
            {
                new AudioProfile(36.71, .72f, .62f, .80, new[] { 220.0, 293.7, 392.0, 329.6 }, 10.5, 0f),
                new AudioProfile(41.20, .66f, .72f, .68, new[] { 246.9, 329.6, 493.9, 370.0 }, 11.7, -.62f),
                new AudioProfile(46.25, .74f, .42f, .92, new[] { 277.2, 415.3, 554.4, 466.2 }, 9.4, -.52f),
                new AudioProfile(43.65, .78f, .58f, 1.08, new[] { 261.6, 349.2, 523.3, 392.0 }, 8.8, .54f),
                new AudioProfile(38.89, .64f, .48f, .72, new[] { 233.1, 311.1, 466.2, 349.2 }, 12.4, -.38f),
                new AudioProfile(36.71, .82f, .76f, 1.20, new[] { 220.0, 329.6, 440.0, 659.3 }, 9.8, .42f),
                new AudioProfile(32.70, .92f, .68f, .88, new[] { 196.0, 293.7, 493.9, 392.0 }, 10.2, 0f),
                new AudioProfile(41.20, .88f, .52f, 1.12, new[] { 246.9, 370.0, 587.3, 493.9 }, 8.6, .72f)
            };
        }
    }
}
