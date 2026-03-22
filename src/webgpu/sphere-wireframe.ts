import { getSphereData } from "./vertex-data";

import { vec3, mat4 } from "gl-matrix";
import { createPipeline, draw, updateUniformBuffers } from "./draw-utilities";
import type { WebGPUConfig } from "./types";

// const configureWebGpu = async (
//   canvasElement: HTMLCanvasElement,
// ): Promise<WebGPUConfig> => {
//   const adapter = await navigator.gpu.requestAdapter();
//   const device = await adapter!.requestDevice();
//   const context = canvasElement.getContext("webgpu")!;
//   const format = navigator.gpu.getPreferredCanvasFormat();

//   context.configure({
//     device,
//     format,
//     alphaMode: "opaque",
//     usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
//   });

//   canvasElement.width = canvasElement.clientWidth * window.devicePixelRatio;
//   canvasElement.height = canvasElement.clientHeight * window.devicePixelRatio;

//   return {
//     device,
//     context,
//     format,
//     size: {
//       height: canvasElement.height,
//       width: canvasElement.width,
//     },
//     msaaCount: 4,
//   };
// };

// ==== NOT Ready
export const createViewTransform = (
  cameraPos: vec3 = [2, 2, 4],
  lookDir: vec3 = [0, 0, 0],
  upDir: vec3 = [0, 1, 0],
) => {
  const viewMat = mat4.create();
  mat4.lookAt(viewMat, cameraPos, lookDir, upDir);
  return {
    viewMat,
    cameraOptions: {
      eye: cameraPos,
      center: lookDir,
    },
  };
};

// ==== NOT Ready
export const createProjectionMat = (aspectRatio: number): mat4 => {
  const projectionMat = mat4.create();
  mat4.perspective(projectionMat, (2 * Math.PI) / 5, aspectRatio, 0.1, 1000.0);
  return projectionMat;
};

// ==== NOT Ready
export const createModelMat = (
  translation: vec3 = [0, 0, 0],
  rotation: vec3 = [0, 0, 0],
  scale: vec3 = [1, 1, 1],
): mat4 => {
  const modelMat = mat4.create();
  mat4.translate(modelMat, modelMat, translation);
  mat4.rotateX(modelMat, modelMat, rotation[0]);
  mat4.rotateY(modelMat, modelMat, rotation[1]);
  mat4.rotateZ(modelMat, modelMat, rotation[2]);
  mat4.scale(modelMat, modelMat, scale);
  return modelMat;
};

// ==== NOT Ready
export const combineMvpMat = (
  modelMat: mat4,
  viewMat: mat4,
  projectionMat: mat4,
): mat4 => {
  const mvpMat = mat4.create();
  mat4.multiply(mvpMat, viewMat, modelMat);
  mat4.multiply(mvpMat, projectionMat, mvpMat);
  return mvpMat;
};

export const run = async (webGpuInfo: WebGPUConfig) => {

  const data = getSphereData(2, 20, 32);
  const pipelineData = await createPipeline(webGpuInfo, data);

  let modelMat = mat4.create();
  let projectMat = mat4.create();
  let mvpMat = mat4.create();
  const vt = createViewTransform([0, 0, 5]);
  let viewMat = vt.viewMat;

  const aspect = webGpuInfo.size.width / webGpuInfo.size.height;
  const rotation = vec3.fromValues(0, 0, 0);
  const params = {
    rotationSpeed: 0.9,
    plotType: "wireframeOnly",
    uSegments: 20,
    vSegments: 32,
    radius: 2,
  };

  const start = performance.now();
  const frame = () => {
    projectMat = createProjectionMat(aspect);

    const camera = createViewTransform([0, 0, 5]);
    viewMat = camera.viewMat;

    const dt = (performance.now() - start) / 1000;
    

    rotation[2] = dt * -params.rotationSpeed

    // Horizontal Rotation
    rotation[1] = dt * params.rotationSpeed;

    // Vertical Rotation
    rotation[0] = dt * params.rotationSpeed;

    modelMat = createModelMat([0, 0, 0], rotation);

    mvpMat = combineMvpMat(modelMat, viewMat, projectMat);

    updateUniformBuffers(webGpuInfo.device, pipelineData, mvpMat);

    draw(webGpuInfo, pipelineData, params.plotType, data);
    webGpuInfo.context.present()
    requestAnimationFrame(frame);
    
  };

  frame();
};

// run();
