import { getSphereData } from "./vertex-data";

import { SharedValue } from "react-native-reanimated";
import { MvpMatrixState } from "./MatrixState";
import { RenderPass } from "./RenderPass";
import { RenderPipeline } from "./RenderPipeline";
import type { WebGPUConfig } from "./types";

export const run = async (
  webGpuInfo: WebGPUConfig,
  ref: SharedValue<{ x: number; y: number; rotation: number }>,
) => {
  const data = getSphereData(2, 20, 32);

  const renderPipeline = new RenderPipeline(webGpuInfo, data);
  const pipelineData = await renderPipeline.getPipelineData();
  const matrixState = new MvpMatrixState(
    webGpuInfo.size.width,
    webGpuInfo.size.height,
  );

  const renderPass = new RenderPass(webGpuInfo, pipelineData, data);

  const frame = () => {
    matrixState.setRotation({
      x: ref.value.y / 500,
      y: ref.value.x / 500,
      z: 10,
    });

    renderPass.updateUniformBuffers(matrixState.getMvpMatrix());

    renderPass.draw();
    webGpuInfo.context.present();
    requestAnimationFrame(frame);
  };

  frame();
};
