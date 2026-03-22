import { DataType, PipelineData, WebGPUConfig } from "./types";

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

export class RenderPipeline {
  config: WebGPUConfig;
  data: any;

  constructor(config: WebGPUConfig, data: any) {
    this.config = config
    this.data = data
  }

  private getFlags = (dataType: DataType) => {
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

  private createVertexBuffer = (data: any, dataType: DataType): GPUBuffer => {
    const flags = this.getFlags(dataType);

    const buffer = this.config.device.createBuffer({
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

  private createRenderPipelineDescriptor = (
    buffers: Iterable<GPUVertexBufferLayout>,
  ): GPURenderPipelineDescriptor => {
    return {
      layout: "auto",
      vertex: {
        module: this.config.device.createShaderModule({
          code: SHADER,
        }),
        entryPoint: "vs_main",
        buffers: [...buffers],
      },
      fragment: {
        module: this.config.device.createShaderModule({
          code: SHADER,
        }),
        entryPoint: "fs_main",
        targets: [
          {
            format: this.config.format,
          },
        ],
      },
      multisample: {
        count: this.config.msaaCount,
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

  getPipelineData = async (): Promise<PipelineData> => {
    const descriptor = this.createRenderPipelineDescriptor([
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

    const pipeline = await this.config.device.createRenderPipelineAsync(descriptor);
    const vertexBuffer = this.createVertexBuffer(this.data.positions, "float");
    const indexBuffer = this.createVertexBuffer(this.data.indices, "int");

    const uniformBuffer = this.config.device.createBuffer({
      size: 64,
      usage: this.getFlags("uniform"),
    });

    const colorUniformBuffer = this.config.device.createBuffer({
      size: 16,
      usage: this.getFlags("uniform"),
    });

    const uniformBindGroup = this.config.device.createBindGroup({
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

    const depthTexture = this.config.device.createTexture({
      size: this.config.size,
      format: "depth24plus",
      sampleCount: this.config.msaaCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const gpuTexture = this.config.device.createTexture({
      size: this.config.size,
      format: this.config.format,
      sampleCount: this.config.msaaCount,
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
}
