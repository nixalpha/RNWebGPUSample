# Visionary Gaussian viewer for React Native

Android-first static 3D Gaussian Splatting viewer built on the Expo WebGPU sample.
Includes an offline 50k-splat scene, local Gaussian PLY/SPLAT import, touch camera
controls, resolution settings, and JS frame-time reporting.

Use npm in this app. Start a native development build with `npm run android`;
asset generation runs automatically. Expo Go is not supported.

See [the native port guide](docs/ANDROID-PORT.md) for setup, supported formats,
resource limits, lifecycle behavior, and the unexecuted device-validation checklist.
See [Visionary provenance](src/visionary/UPSTREAM.md) for the copied source/license.

Implementation has not been verified with tests, type checks, builds, or devices.

## Original sample

Use [Expo Router](https://docs.expo.dev/router/introduction/) with [react-native-webgpu](https://github.com/wcandillon/react-native-webgpu) and Three.js to build cross-platform 3D and GPU-powered applications.

## Launch your own

[![Launch with Expo](https://github.com/expo/examples/blob/master/.gh-assets/launch.svg?raw=true)](https://launch.expo.dev/?github=https://github.com/expo/examples/tree/master/with-webgpu)

## 🚀 How to use

Bootstrap the project:

```sh
npx create-expo-app -e with-webgpu
```

Finally you can start the app with `npx expo run` — this project requires a custom client.

Deploy on all platforms with Expo Application Services (EAS).

- Deploy the website: `npx eas-cli deploy` — [Learn more](https://docs.expo.dev/eas/hosting/get-started/)
- Deploy on iOS and Android using: `npx eas-cli build` — [Learn more](https://expo.dev/eas)
