import { makeWebGPURenderer } from "@/lib/make-webgpu-renderer";
import { run } from "@/webgpu/sphere-wireframe";
import { WebGPUConfig } from "@/webgpu/types";
import React, { useEffect, useRef } from "react";
import { PixelRatio, View } from "react-native";
import { Canvas } from "react-native-wgpu";
import type { CanvasRef } from "react-native-wgpu";

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

  useEffect(() => {
    (async () => {
      const config = await configureWebGpu();
      run(config);
      
    })();
  }, []);

  return (
    <View style={{ backgroundColor: "black", flex: 1 }}>
      <Canvas ref={ref} style={{ backgroundColor: "red", flex: 1 }} />
    </View>
  );
};
