import { mat4 } from "gl-matrix";
import { PipelineData, WebGPUConfig } from "./types";

export class RenderPass {
  private limeGreen = new Float32Array([0.196, 0.804, 0.196, 1.0]);

  config: WebGPUConfig;
  pipelineData: PipelineData;
  data: any;

  constructor(config: WebGPUConfig, pipelineData: PipelineData, data: any) {
    this.config = config;
    this.pipelineData = pipelineData;
    this.data = data;
  }

  private createRenderPassDescriptor = (
    depthView: GPUTextureView,
    textureView: GPUTextureView,
  ): GPURenderPassDescriptor => {
    const colorAttachmentView = textureView;

    const colorAttachmentResolveTarget = this.config.context
      .getCurrentTexture()
      .createView();

    const descriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: colorAttachmentView,
          resolveTarget: colorAttachmentResolveTarget,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    };

    return descriptor;
  };

  draw = () => {
    const commandEncoder = this.config.device.createCommandEncoder();
    const descriptor = this.createRenderPassDescriptor(
      this.pipelineData.depthTexture.createView(),
      this.pipelineData.gpuTexture.createView(),
    );

    const renderPass = commandEncoder.beginRenderPass(descriptor);

    renderPass.setPipeline(this.pipelineData.pipeline);
    renderPass.setVertexBuffer(
      0,
      this.pipelineData.vertexBufferData.vertexBuffer,
    );
    renderPass.setBindGroup(0, this.pipelineData.uniformBindGroup);
    renderPass.setIndexBuffer(
      this.pipelineData.vertexBufferData.indexBuffer,
      "uint32",
    );
    renderPass.drawIndexed(this.data.indices.length);

    renderPass.end();
    this.config.device.queue.submit([commandEncoder.finish()]);
  };

  updateUniformBuffers = (mvpMat: mat4) => {
    this.config.device.queue.writeBuffer(
      this.pipelineData.uniformBufferData.uniformBuffer,
      0,
      mvpMat as unknown as ArrayBuffer,
    );
    this.config.device.queue.writeBuffer(
      this.pipelineData.uniformBufferData.colorUniformBuffer,
      0,
      this.limeGreen,
    );
  };
}

