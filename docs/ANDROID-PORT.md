# Android static Gaussian viewer

## Implementation and status

The home screen uses native WebGPU to project Gaussians, evaluate SH, sort depth
keys on the GPU, and draw alpha-blended splats. It uses the pinned
`react-native-wgpu` 0.4.2 API already present in this Expo 54 sample.

No tests, type checks, builds, emulator/device runs, screenshot comparisons, or
benchmarks were run during this implementation, at the user's request. The
performance numbers below are targets, not measured results.

## Running later

Use Node compatible with Expo 54 (Node 20.19+), npm, an Android SDK/JDK environment,
and a physical Vulkan-capable Android device with USB debugging enabled.

```sh
npm install
npm run android
```

This requires a native development build; Expo Go does not contain the GPU module.
The `preandroid` script generates WGSL string modules and procedural scenes.
`prestart`, `preios`, `preweb`, `predeploy`, and the EAS post-install hook do the same.
If invoking Expo directly, first run `npm run prepare:assets`.
Do not replace the pinned package with the renamed current package without a
separate migration of its native API and peer dependency requirements.

## Scene and interaction contract

- Startup loads the offline, bundled 50k-splat rings scene.
- Open File uses Android's document picker, copies into app cache, reads binary
  data through Expo FileSystem, then parses the buffer in yielding batches.
- Supports standard Gaussian PLY (ASCII, binary little/big endian; scalar vertex
  properties) and 32-byte SPLAT. PLY needs position, log-scale, quaternion,
  opacity logits, and DC SH properties. SH degrees 0–3 are supported.
- Mesh-only PLY, compressed PLY, KSPLAT, SPZ, SOG, ONNX, remote URLs, and mixed
  mesh scenes are outside this release. The native implementation intentionally
  does not import Visionary's universal loader or browser app.
- One finger orbits; pinch zooms; two fingers pan. Reset Camera refits the initial
  view. Resolution buttons select 100%, 75%, or 50% of the capped render size.
- Picker cancellation leaves the scene intact. An accepted replacement unloads
  the previous scene before parsing/upload. Cancel stops parsing at a batch
  boundary. Retry recreates the canvas/device; Reload Demo returns to the demo.

Defaults: 250k splats, 128 MiB input limit, 128 MiB estimated GPU buffer budget,
1280 physical pixels on the longest viewport side. Per-device buffer limits can
reduce what is supported. Memory estimates include actual renderer buffer padding
but exclude driver allocations, swapchain images, pipelines, and temporary CPU
file/decoded data. Packed attributes must fit finite binary16 values.

The session owns one GPU device, renderer, frame loop, and scene. Backgrounding or
losing route focus stops frame scheduling. Unmount cancels pending loads and
destroys resources. Device loss stops rendering until Retry. No scene bytes are
retained after successful upload; reload reads the asset/cache URI again.

The pinned native package has incomplete EventTarget support on GPUDevice.
Initialization and uploads use explicit WebGPU error scopes; the viewer subscribes
to uncaptured errors only when the binding exposes that API. Device loss uses the
native `device.lost` promise. Native driver errors may additionally appear in logs.

## Source map

- `src/visionary/`: vendored static renderer, kernels, packing, and loaders;
  `UPSTREAM.md` records provenance and deliberate changes.
- `src/gaussian/`: scene sources, Expo IO, native session, and orbit camera.
- `src/components/gaussian-viewer.tsx`: React UI, gestures, route/app lifecycle.
- `/sphere`: original raw-WebGPU diagnostic, with frame-loop cleanup.

`GaussianViewer` accepts an optional `SceneSource` and `onStatus` callback.
`NativeGaussianSession` exposes initialization, load/cancel, resize, active state,
camera operations, and disposal. `GaussianRenderer` preserves `prepareMulti` and
`renderMulti`, accepting exactly one cloud; it also exposes `reserve`,
`releaseScene`, and `dispose`.

## Future verification checklist — not executed

1. Build/install the sphere and viewer on a physical Android device. Record model,
   OS, GPU adapter, limits, native build type, and thermal/power conditions.
2. Confirm startup shader creation and the deterministic GPU sorter probe. The
   sorter uses 256-thread groups and 17,408 bytes of workgroup storage. The probe
   runs in the app when initialized; it was not executed during implementation.
3. Load ASCII/little-endian/big-endian PLY and SPLAT fixtures with known covariance,
   alpha, and SH degrees 0–3. Try empty/truncated/malformed/oversized files and
   cancellation during parsing. Confirm standard quaternion ordering.
4. Compare identical camera matrices, viewport, background, and packed scene with
   browser Visionary. Include overlapping colors, isotropic and anisotropic splats,
   view-dependent SH, clipped/all-hidden splats, and non-workgroup-aligned counts.
5. Extend sort probes around 256 and 3840 boundaries, duplicate keys, and indirect
   zero-visible frames; check payload-to-key correspondence and stable ordering.
6. Rotate portrait/landscape, change resolution, background/resume, navigate to
   the sphere and back, cancel initialization, rapidly switch scenes, and retry
   after device loss. Confirm a single frame loop and no retained scene resources.
7. Run an Android release build offline, including demo loading and file picking.

## Performance collection — pending

The overlay reports **JS frame intervals**, not GPU timestamps. Median/p95 and
FPS summarize the preceding reporting interval. GPU buffers are estimates based
on allocation sizes, not a claim about whole-process memory.

The generated fixtures are 64, 50k, 100k, and 250k splats. Development builds expose
quick selectors; for release profiling pass a fixture as the viewer's `source`.
Use identical orbit paths and viewport sizes for comparisons. Target 30 FPS for
50k splats over a 60-second orbit at the 1280-pixel cap; characterize 100k/250k
without promising the same frame rate. Record load time, median/p95 frame time,
resolution, process memory, and device temperature. No result is recorded yet.

If the target is missed, measure sorting versus fill cost first; tune resolution
and allocations before changing the sorting algorithm or moving work to another
JS runtime. iOS device validation is a separate follow-up.
