# iOS setup

The static Visionary viewer uses the same renderer and WGSL on Android and iOS.
On iOS, react-native-wgpu 0.4.2 exposes WebGPU through JSI and Dawn's Metal backend,
presenting to a CAMetalLayer. This is a native app, not Safari or Expo Go.

## Prerequisites

- macOS, Xcode 16.1 or newer (including an iOS SDK), CocoaPods, and Node/npm.
- iOS 15.1 or newer, as required by the installed React Native 0.81.4.
- A Metal-capable device. Simulator support depends on the host/runtime; use a
  physical iPhone or iPad for graphics correctness and performance work.
- An Apple development team and device provisioning for physical-device signing.

Keep the committed package-lock.json and pinned react-native-wgpu version. Its
podspec links the bundled Dawn XCFramework, including iOS device and simulator
slices; a separate Dawn build or custom native renderer bridge is not required.

## Generate and install (no build)

From RNWebGPUSample:

```sh
npm ci
npm run ios:prebuild
npm run ios:pods
```

The prebuild script regenerates shader strings and bundled scenes, then generates
the iOS project without changing React/React Native versions or installing Pods.
The ios directory is generated and ignored by Git. Keep native configuration in
app.json and plugins/with-ios-webgpu.js; do not rely on hand-edited generated files.
New Architecture remains enabled. CocoaPods autolinks WebGPU and the Expo modules.

The local plugin disables Metal API Validation only on shared Debug Run actions.
react-native-wgpu 0.4.2 explicitly rejects the validation wrapper on Simulator.
Xcode encodes this opt-out as `enableGPUValidationMode = "1"`. The plugin is
idempotent and leaves Profile/Archive actions unchanged. WebGPU error scopes remain
enabled. See [Expo's native-mod documentation](https://docs.expo.dev/config-plugins/dangerous-mods/)
and [the Xcode scheme encoding in CMake](https://github.com/Kitware/CMake/blob/v3.31.0/Source/cmXCodeScheme.cxx).

## Launch later, when verification is authorized

Open ios/WebGPUSample.xcworkspace (not the xcodeproj) in Xcode. Select the
WebGPUSample target and your team under Signing & Capabilities. The default bundle
identifier is com.wa2goose.WebGPUSample; change app.json and prebuild again if your
team requires a different identifier. No signing team or credentials are stored
in this implementation.

```sh
npm run ios          # Build and launch the simulator
npm run ios:device   # Select, build and launch a physical device
```

These commands generate assets automatically and **do build and launch**. They are
not part of the no-verification implementation workflow. For Xcode launches, start
Metro separately with `npm start`. After native dependency changes, prebuild and
install Pods again. Do not use `--clean` without preserving any intentional native
changes and local signing configuration.

## Runtime behavior

- Rendering pauses on inactive/background states, navigation away, and while the
  file picker is open. Surface dimensions/configuration are deferred until active
  with a nonzero layout; resuming applies the latest size and resolution.
- Each submitted drawable is explicitly presented. Teardown attempts every cleanup
  step even if the native surface has already detached.
- Files/iCloud Drive selections are copied to the app cache before use. Provider
  errors and cancellation leave the current scene selected. Selected copies are
  retained for Retry; replaced/unmounted copies are removed after pending readers
  finish. The OS can still evict cached files, requiring selection again.
- No broad storage permission, iCloud container, or extra entitlement is needed
  for document-picker access. This app does not manage its own iCloud documents.
- Existing limits remain: 250k splats, 128 MiB input/GPU budget, and a 1280-pixel
  render long edge. Unsupported GPU limits produce an explicit error.

## Pending device validation — not executed

Build Debug on Simulator and a physical device; launch the bundled scene; exercise
PLY/SPLAT import from local Files and iCloud, cancellation, provider failures,
Retry, repeated scene replacement, and memory pressure. Check rotation, resolution
changes, navigation to/from Sphere, Control Center, lock/unlock, background/resume,
and teardown during loading. Compare rendering with the upstream viewer and assess
the 64/50k/100k/250k scenes on target devices before claiming iOS support is verified.
Release/archive signing and performance validation are also still pending.
