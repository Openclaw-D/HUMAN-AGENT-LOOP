# V4 super building / dark world tree architecture candidate

Status: `CONTROL CANDIDATE / NOT FROZEN FOR IMPLEMENTATION`

## 1. Product decision

The candidate direction is one connected product with two deliberately separated runtime surfaces:

1. Unity organization world: a game-like, spatial management and governance projection.
2. Web work system: Project, Case, Attempt, Evidence, Candidate, Human Gate, Event, Receipt, and handoff.

The spatial metaphor is a super building fused with a dark living tree:

- the crown and upper floors represent leasing leadership and enterprise scope;
- the trunk represents business, risk, and technology leadership spines;
- three major zones represent 小微、汽融、中大;
- the root network represents centrally managed risk deployment into each business zone;
- technical and intelligent capabilities form infrastructure roots rather than human authority nodes;
- Projects and Cases appear as aggregated living signals and open into the Web work system.

The visual direction may use deep blue-black space, giant organic silhouettes, layered parallax, bioluminescent veins, slow pulses, fog, and restrained particle flow. It must not copy characters, environments, assets, or distinctive compositions from an existing game.

## 2. Organization model

A tree-shaped presentation must be backed by a graph. One `parentId` cannot represent the real organization.

Required relationship kinds:

- `reports_to`: administrative reporting;
- `professional_parent`: professional line management;
- `host_unit`: deployed or embedded operating unit;
- `owns_scope`: accountable business scope;
- `governs_scope`: policy or risk constraint scope;
- `serves_scope`: system, data, or intelligent capability support;
- `observes_scope`: read-only management visibility.

A deployed risk role should therefore retain its central risk `professional_parent` while binding to the business division through `host_unit` and `governs_scope`.

## 3. Spatial world model

The world is logically unbounded, not physically infinite.

Minimum engine concepts:

- double-precision or rebased logical coordinates;
- camera position and zoom separated from domain coordinates;
- viewport culling and object pooling;
- spatial index for hit testing and visible-node queries;
- semantic zoom levels;
- stable world identity independent of screen position;
- separate personal, shared-layout, and business-semantic state.

Suggested semantic zoom:

1. Enterprise: leadership, three operating zones, central risk and technology spines.
2. Division: business units, deployed risk, system and intelligent capability roots.
3. Team and portfolio: accountable teams, Project groups, exception and delay signals.
4. Work entry: selected Project / Case identity and a link into the Web work surface.

The canvas must aggregate large Project and Case populations. It must never instantiate every Case at enterprise zoom.

## 4. Drag state machine

Visual layout drag and semantic business drag are different commands.

### Layout drag

- changes presentation coordinates only;
- can be personal or shared according to policy;
- supports undo and redo;
- never changes authority, ownership, or organization membership.

### Semantic drag

Formal state machine:

```text
idle
  -> dragging
  -> drop_candidate
  -> awaiting_confirmation
  -> submitting
  -> accepted | rejected | stale
```

The client may preview a target zone and run local validation. A semantic change is accepted only after the server validates actor, policy, expected version, and idempotency key and returns a canonical Receipt. Rejection or stale context must animate a rollback and retain the error evidence.

## 5. Runtime and backend boundary

Unity is a projection client, not a second source of truth.

Candidate read DTO:

```text
CanvasProjectionDto
  projectionVersion
  layoutVersion
  asOf
  scope
  nodes[]
  edges[]
  zones[]
  signals[]
  workLinks[]
  readOnly
```

Candidate command envelope:

```text
WorldCommand
  commandId
  idempotencyKey
  actorId
  targetId
  commandType
  expectedProjectionVersion
  expectedContextVersion?
  payload
```

The first backend integration should be read-only. Semantic moves, settings, and governance actions remain excluded until the server command and Receipt contract is independently frozen.

## 6. Historical EYE reuse assessment

Reusable:

- runtime bootstrap and code-generated world approach;
- URP setup and shader library;
- curved line, ribbon, crystal, glow, particle, trail, and root-like primitives;
- procedural audio foundation;
- existing dark spatial palette and organic root experiments;
- minimal Scene with generated runtime content.

Do not extend directly:

- the hard-coded `EyeChapter` enum and chapter definitions;
- fixed seven-entry hub and fixed five-node chapter layouts;
- fixed 1920x1080 IMGUI HUD;
- mouse-only raycast input;
- fixed perspective camera and pointer parallax;
- the monolithic partial `EyeExperience` state owner;
- historical competition build naming and Windows-only build script;
- local completion animation as a substitute for server state.

Current technical gaps:

- no V4 projection domain;
- no camera pan, zoom, touch, trackpad, or gesture state machine;
- no drag/drop state machine;
- no virtualization or spatial index;
- no backend adapter;
- no EditMode or PlayMode tests;
- no Web build script or acceptance;
- no accessibility and reduced-motion policy;
- no deterministic screenshot harness.

## 7. Proposed code boundary

Keep the historical source unchanged during the first candidate slice. Add V4 under an isolated namespace and directory:

```text
Assets/EYE/V4/
  Domain/
  Projection/
  World/
  Input/
  Interaction/
  Rendering/
  Editor/
  Tests/
```

The old `EyeExperience` remains a visual reference until the new V4 boot path proves it can replace the hub. V4 must not import V3 Case identities, old chapter semantics, or historical HTML routes.

## 8. Observable checkpoints

### CP0 - source import

- source-only import;
- archive preserved;
- provenance and exclusions recorded.

### CP1 - static super building candidate

- synthetic organization graph only;
- leadership crown, business/risk/technology spines;
- 小微、汽融、中大 zones;
- central risk deployment roots;
- dark-tree spatial composition;
- desktop 1920x1080 visual observation;
- no drag, backend, or Case work.

Stop after the first real visual preview for user correction.

### CP2 - world navigation and governed drag

- pan, wheel zoom, trackpad, and touch gesture abstraction;
- semantic zoom;
- one layout drag and one simulated semantic drag;
- confirmation, accepted, rejected, and stale rollback states;
- deterministic tests for the interaction state machine.

### CP3 - platform Gate

- Windows and Unity Web candidates;
- real laptop and real phone input checks;
- initial load, memory, frame-time, text clarity, and reduced-motion evidence;
- explicit technology decision: Unity Web, native, Web-native alternative, or hybrid.

### CP4 - canonical read integration

- one frozen server-owned `CanvasProjectionDto`;
- same identity and version visible in Unity and Web work entry;
- Unity cannot synthesize organization or Case truth.

### CP5 - command and Receipt integration

- only after authority and policy contracts are frozen;
- server-validated command, idempotency, stale failure, Receipt, and projection refresh;
- no optimistic formal success.

## 9. CP1 exclusions

- no real business data;
- no production configuration;
- no formal organization mutation;
- no complete Project / Case work surface inside Unity;
- no deployment;
- no package installation without authorization;
- no claim that Unity Web, mobile, or backend integration is complete.

