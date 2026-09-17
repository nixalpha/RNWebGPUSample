import { getSphereData } from "./vertex-data";

import { SharedValue } from "react-native-reanimated";
import { MvpMatrixState } from "./MatrixState";
import { RenderPass } from "./RenderPass";
import { RenderPipeline } from "./RenderPipeline";
import type { WebGPUConfig } from "./types";

export const run = async (
  webGpuInfo: WebGPUConfig,
  ref: SharedValue<{ x: number; y: number; rotation: number }>,
  signal?: AbortSignal,
) => {
  const data = getSphereData(2, 20, 32);

  const renderPipeline = new RenderPipeline(webGpuInfo, data);
  const pipelineData = await renderPipeline.getPipelineData();
  let frameId = 0;
  const dispose = () => {
    cancelAnimationFrame(frameId);
    pipelineData.vertexBufferData.vertexBuffer.destroy();
    pipelineData.vertexBufferData.indexBuffer.destroy();
    pipelineData.uniformBufferData.uniformBuffer.destroy();
    pipelineData.uniformBufferData.colorUniformBuffer.destroy();
    pipelineData.depthTexture.destroy();
    pipelineData.gpuTexture.destroy();
  };
  if (signal?.aborted) { dispose(); return dispose; }
  const matrixState = new MvpMatrixState(
    webGpuInfo.size.width,
    webGpuInfo.size.height,
  );

  const renderPass = new RenderPass(webGpuInfo, pipelineData, data);

  const frame = () => {
    if (signal?.aborted) return;
    matrixState.setRotation({
      x: ref.value.y / 500,
      y: ref.value.x / 500,
      z: ref.value.rotation,
    });

    renderPass.updateUniformBuffers(matrixState.getMvpMatrix());

    renderPass.draw();
    webGpuInfo.context.present();
    frameId = requestAnimationFrame(frame);
  };

  frame();
  return dispose;
};
