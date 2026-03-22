import { RNCanvasContext } from "react-native-wgpu";


export interface WebGPUConfig {
  device: GPUDevice;
  context: RNCanvasContext;
  format: GPUTextureFormat;
  size: {
    height: number;
    width: number;
  };
  msaaCount: 4;
}

export interface PipelineData {
  pipeline: GPURenderPipeline;
  vertexBufferData: {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
  };
  uniformBufferData: {
    uniformBuffer: GPUBuffer;
    colorUniformBuffer: GPUBuffer;
  };
  uniformBindGroup: GPUBindGroup;
  depthTexture: GPUTexture;
  gpuTexture: GPUTexture;
}

export type DataType = "float" | "int" | "uniform";