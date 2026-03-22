

import { mat4 } from "gl-matrix";
import type { DataType, PipelineData, WebGPUConfig } from "./types";

const SHADER  = `
@binding(0) @group(0) var<uniform> mvpMatrix: mat4x4f;

@vertex
fn vs_main(@location(0) pos: vec4f) -> @builtin(position) vec4f {
  return mvpMatrix * pos;
}

@binding(1) @group(0) var<uniform> color: vec4f;

@fragment
fn fs_main() -> @location(0) vec4f {
  return color;
}
`

export const getFlags = (dataType: DataType) => {
  let leadingValue = GPUBufferUsage.VERTEX;

  switch (dataType) {
    case "float":
      leadingValue = GPUBufferUsage.VERTEX;
      break;
    case "int":
      leadingValue = GPUBufferUsage.INDEX;
      break;
    case "uniform":
      leadingValue = GPUBufferUsage.UNIFORM;
      break;
  }

  return leadingValue | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
};

export const createVertexBuffer = (
  device: GPUDevice,
  data: any,
  dataType: DataType,
): GPUBuffer => {
  const flags = getFlags(dataType);

  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: flags,
    mappedAtCreation: true,
  });

  const gpuBuffer = buffer.getMappedRange();

  const gpuView =
    dataType === "int"
      ? new Uint32Array(gpuBuffer)
      : new Float32Array(gpuBuffer);

  gpuView.set(data);

  buffer.unmap();
  return buffer;
};

const createRenderPipelineDescriptor = (
  init: WebGPUConfig,
  buffers: Iterable<GPUVertexBufferLayout>,
): GPURenderPipelineDescriptor => {
  return {
    layout: "auto",
    vertex: {
      module: init.device.createShaderModule({
        code: SHADER,
      }),
      entryPoint: "vs_main",
      buffers: buffers,
    },
    fragment: {
      module: init.device.createShaderModule({
        code: SHADER,
      }),
      entryPoint: "fs_main",
      targets: [
        {
          format: init.format,
        },
      ],
    },
    multisample: {
      count: init.msaaCount,
    },
    primitive: {
      topology: "line-list",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  };
};

export const createBindGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  buffers: GPUBuffer[] = [],
): GPUBindGroup => {
  const entries = buffers.map((buffer, i) => {
    return {
      binding: i,
      resource: {
        buffer: buffer,
      },
    };
  });

  return device.createBindGroup({
    layout: layout,
    entries: entries,
  });
};

export const createPipeline = async (
  init: WebGPUConfig,
  data: any,
): Promise<PipelineData> => {
  const descriptor = createRenderPipelineDescriptor(init, [
    {
      arrayStride: 4 * 3,
      attributes: [
        {
          shaderLocation: 0,
          format: "float32x3",
          offset: 0,
        },
      ],
    },
  ]);

  const pipeline = await init.device.createRenderPipelineAsync(descriptor);
  const vertexBuffer = createVertexBuffer(init.device, data.positions, "float");
  const indexBuffer = createVertexBuffer(init.device, data.indices, "int");

  const uniformBuffer = init.device.createBuffer({
    size: 64,
    usage: getFlags("uniform"),
  });

  const colorUniformBuffer = init.device.createBuffer({
    size: 16,
    usage: getFlags("uniform"),
  });

  const uniformBindGroup = init.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [uniformBuffer, colorUniformBuffer].map((buffer, i) => {
      return {
        binding: i,
        resource: {
          buffer: buffer,
        },
      };
    }),
  });

  const depthTexture = init.device.createTexture({
    size: init.size,
    format: "depth24plus",
    sampleCount: init.msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const gpuTexture = init.device.createTexture({
    size: init.size,
    format: init.format,
    sampleCount: init.msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  return {
    pipeline: pipeline,
    vertexBufferData: {
      vertexBuffer,
      indexBuffer,
    },
    uniformBufferData: {
      uniformBuffer,
      colorUniformBuffer: colorUniformBuffer,
    },
    uniformBindGroup,
    depthTexture,
    gpuTexture,
  };
};

export const createRenderPassDescriptor = (input: {
  init: WebGPUConfig;
  depthView: GPUTextureView;
  textureView: GPUTextureView;
}): GPURenderPassDescriptor => {
  const colorAttachmentView = input.textureView;

  const colorAttachmentResolveTarget = input.init.context
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
      view: input.depthView,
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  };

  return descriptor;
};

export const draw = (
  init: WebGPUConfig,
  pipelineData: PipelineData,
  plotType: string,
  data: any,
) => {
  const commandEncoder = init.device.createCommandEncoder();
  const descriptor = createRenderPassDescriptor({
    init,
    depthView: pipelineData.depthTexture.createView(),
    textureView: pipelineData.gpuTexture.createView(),
  });

  const renderPass = commandEncoder.beginRenderPass(descriptor);

  renderPass.setPipeline(pipelineData.pipeline);
  renderPass.setVertexBuffer(0, pipelineData.vertexBufferData.vertexBuffer);
  renderPass.setBindGroup(0, pipelineData.uniformBindGroup);
  renderPass.setIndexBuffer(
    pipelineData.vertexBufferData.indexBuffer,
    "uint32",
  );
  renderPass.drawIndexed(data.indices.length);

  renderPass.end();
  init.device.queue.submit([commandEncoder.finish()]);
  
};

export const updateUniformBuffers = (
  device: GPUDevice,
  p: PipelineData,
  mvpMat: mat4,
) => {
  device.queue.writeBuffer(
    p.uniformBufferData.uniformBuffer,
    0,
    mvpMat as unknown as ArrayBuffer,
  );
  device.queue.writeBuffer(
    p.uniformBufferData.colorUniformBuffer,
    0,
    limeGreen,
  );
};

export const limeGreen = new Float32Array([0.196, 0.804, 0.196, 1.0]);
