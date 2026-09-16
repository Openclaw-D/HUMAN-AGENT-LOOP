# Historical EYE source import manifest

Status: `COPIED / ARCHIVE PRESERVED`

Date: 2026-08-31

## Source and destination

- Source: `C:\Users\22673\Desktop\Archive\TAG-sources-20260821\Unity`
- Destination: `C:\Users\22673\Desktop\Anthropic\jianwei-v3\eye-unity`
- Operation: non-destructive source-only copy
- Archive deletion or mutation: none

The source was selected from five local EYE candidates because it contains the latest historical build script, `PROJECT_MAP.md`, the full 66-file `Assets/EYE` tree, and the same core source hashes as the full V3 handoff snapshot.

## Included

- `Assets/**`
- `Packages/**`
- `ProjectSettings/**`
- `.gitignore`
- `THIRD_PARTY_ASSETS.md`
- historical `README.md` as `LEGACY_README.md`
- historical `PROJECT_MAP.md` as `LEGACY_PROJECT_MAP.md`

Imported evidence at copy time:

- files: 132
- bytes: 15,160,515
- Unity editor version: `6000.5.4f1`

Key source SHA-256 prefixes:

- `EyeExperienceHub.cs`: `E74584812F4ED9B7`
- `EyeExperienceChapter.cs`: `726EB20333A14F49`
- `EyeDemoBuild.cs`: `896D8200A3C9EBED`
- `Packages/manifest.json`: `30F32A1468492E4F`

## Excluded

- `Library/**`: generated cache, approximately 1.99 GB
- `Builds/**`: historical Windows build, approximately 120 MB
- `Logs/**`: generated logs
- `UserSettings/**`: machine-local editor state
- `见微.html`, `天驱.html`, `星愿.html`: historical pages, not current V4 contracts

These exclusions remain recoverable from the Archive source.

## Verification boundary

This manifest proves only the source import and provenance. It does not prove that Unity package resolution, compilation, Play Mode, Windows build, Web build, mobile input, or backend integration currently passes.

