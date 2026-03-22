import { makeWebGPURenderer } from "@/lib/make-webgpu-renderer";
import { run } from "@/webgpu/sphere-wireframe";
import { WebGPUConfig } from "@/webgpu/types";
import React, { useEffect, useRef } from "react";
import { PixelRatio, View } from "react-native";
import { Canvas } from "react-native-wgpu";
import type { CanvasRef } from "react-native-wgpu";

import { useSharedValue } from "react-native-reanimated";

import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";

export const WireframeSphere = () => {
  const ref = useRef<CanvasRef>(null);

  const configureWebGpu = async (): Promise<WebGPUConfig> => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const context = ref.current!.getContext("webgpu")!;
    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
      device,
      format,
      alphaMode: "opaque",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const { width, height } = context.canvas;

    return {
      device,
      context,
      format,
      size: {
        height: height,
        width: width,
      },
      msaaCount: 4,
    };
  };

  const offsetsRef = useSharedValue({
    x: 0,
    y: 0,
    rotation: 0,
  });

  useEffect(() => {
    (async () => {
      const config = await configureWebGpu();
      run(config, offsetsRef);
    })();
  }, []);

  const pan = Gesture.Pan().onChange(({ absoluteX, absoluteY }) => {
    offsetsRef.value.x = absoluteX;
    offsetsRef.value.y = absoluteY;
  });

  const rotate = Gesture.Rotation().onChange((e) => {
    offsetsRef.value.rotation = e.rotation;
  });

  const gesture = Gesture.Race(rotate, pan);

  return (
    <GestureHandlerRootView>
      <GestureDetector gesture={gesture}>
        <View style={{ backgroundColor: "black", flex: 1 }}>
          <Canvas ref={ref} style={{ backgroundColor: "red", flex: 1 }} />
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
};
