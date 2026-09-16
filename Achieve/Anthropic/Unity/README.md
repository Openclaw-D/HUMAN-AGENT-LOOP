# EYE Unity V4 organization world

Status: `SOURCE IMPORTED / V4 ARCHITECTURE CANDIDATE / NOT RUNTIME-ACCEPTED`

This project is the source-only import of the historical EYE Unity experience. It is being evaluated as the spatial organization, management, and governance client for 见微 V4.

The V4 direction is a hybrid:

- Unity renders the “super building / dark world tree” organization world, scope navigation, management signals, and governed interaction previews.
- The Web application remains the Project / Case work system and the server-owned source of truth.
- Unity must not create Authority, Context, organizational assignments, configuration state, or Receipt locally.

## Current evidence

- Source imported from `C:\Users\22673\Desktop\Archive\TAG-sources-20260821\Unity`.
- Archive source remains unchanged.
- Imported: `Assets`, `Packages`, `ProjectSettings`, `.gitignore`, and third-party attribution.
- Excluded: `Library`, `Builds`, `Logs`, `UserSettings`, and three legacy HTML files.
- Unity version recorded by the project: `6000.5.4f1`.
- Current code is the historical procedural seven-scene presentation. It has not been converted to the V4 organization world.
- No backend integration, mobile gesture acceptance, Unity Web acceptance, or V4 runtime acceptance has been performed.

## Open locally

The project entry is `Assets/Scenes/SampleScene.unity`. Opening it in Unity may resolve packages and regenerate `Library`; that has not been run as part of the source import.

Read first:

- `Docs/IMPORT_MANIFEST.md`
- `Docs/V4_SUPERBUILDING_ARCHITECTURE.md`
- `LEGACY_PROJECT_MAP.md`
- `LEGACY_README.md`

## Source layout

- `Assets/EYE`: historical procedural EYE experience and visual primitives.
- `Assets/EYE/Resources`: shaders, eye imagery, particles, and licensed external textures.
- `Assets/EYE/Editor`: historical Windows demo build tool.
- `Assets/Scenes/SampleScene.unity`: minimal boot scene; `EyeExperience` is created at runtime.
- `Docs`: V4 import and architecture control documents.

## Hard boundaries

- Do not restore the historical V3 HTML pages as active V4 surfaces.
- Do not extend the historical `EyeChapter` enum into the V4 domain model.
- Do not render Project / Case work forms inside Unity in the first wave.
- Do not treat visual drag, animation completion, or local layout state as a formal business action.
- Do not install packages, build, deploy, or connect real APIs without current authorization.

