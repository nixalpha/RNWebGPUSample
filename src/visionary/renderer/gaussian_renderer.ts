// Static native adaptation of Visionary's GaussianRenderer. See ../UPSTREAM.md.
import type { PerspectiveCamera } from "../camera/perspective";
import { PointCloud } from "../point_cloud/point_cloud";
import { GaussianPreprocessor } from "../preprocess/gaussian_preprocessor";
import { GPURSSorter, type PointCloudSortStuff } from "../sort/radix_sort";
import { gaussianShader } from "../shaders/index";
import { BUFFER_CONFIG } from "../point_cloud/layouts";
import { estimateGpuBytes, MAX_GPU_BYTES, validateGpuAllocation } from "../memory";

export interface RendererConfig {
  device: GPUDevice;
  format: GPUTextureFormat;
  shDegree: number;
  initialCapacity?: number;
  maxGpuBytes?: number;
}

export interface RenderArgs {
  camera: PerspectiveCamera;
  viewport: [number, number];
  maxSHDegree?: number;
}

export class GaussianRenderer {
  private sorter?: GPURSSorter;
  private preprocessor = new GaussianPreprocessor();
  private pipeline?: GPURenderPipeline;
  private drawIndirect?: GPUBuffer;
  private global?: { capacity: number; output: GPUBuffer; sort: PointCloudSortStuff; bindGroup: GPUBindGroup };
  private disposed = false;
  private settings = new WeakMap<PointCloud, {
    gaussianScaling: number; maxSHDegree: number; showEnvMap: boolean;
    mipSplatting: boolean; kernelSize: number; walltime: number; sceneExtend: number;
    center: Float32Array; clippingBoxMin: Float32Array; clippingBoxMax: Float32Array;
  }>();

  constructor(private readonly config: RendererConfig) {}

  reserve(count: number): void { this.ensureCapacity(count); }

  async initialize(): Promise<void> {
    const { device, format, shDegree } = this.config;
    try {
      this.sorter = await GPURSSorter.create(device, device.queue);
      if (this.disposed) { this.sorter.dispose(); throw new Error("Renderer disposed during initialization."); }
      await this.preprocessor.initialize(device, shDegree);
      if (this.disposed) { this.preprocessor.dispose(); throw new Error("Renderer disposed during initialization."); }
      const module = device.createShaderModule({ label: "gaussian.wgsl", code: gaussianShader });
      this.pipeline = await device.createRenderPipelineAsync({
        label: "Gaussian blended splats",
        layout: device.createPipelineLayout({ bindGroupLayouts: [
          PointCloud.renderBindGroupLayout(device), GPURSSorter.createRenderBindGroupLayout(device),
        ] }),
        vertex: { module, entryPoint: "vs_main", buffers: [] },
        fragment: { module, entryPoint: "fs_main", targets: [{ format, blend: {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        } }] },
        primitive: { topology: "triangle-strip" },
      });
      if (this.disposed) throw new Error("Renderer disposed during initialization.");
      this.drawIndirect = device.createBuffer({ label: "splat draw indirect", size: 16,
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      device.queue.writeBuffer(this.drawIndirect, 0, new Uint32Array([4, 0, 0, 0]));
      if (this.config.initialCapacity) this.ensureCapacity(this.config.initialCapacity);
    } catch (error) { this.dispose(); throw error; }
  }

  private ensureCapacity(count: number): void {
    if (this.global && this.global.capacity >= count) return;
    if (!this.sorter || this.disposed) throw new Error("Renderer is not initialized.");
    const { device } = this.config;
    validateGpuAllocation(count, device.limits);
    if (estimateGpuBytes(count) > (this.config.maxGpuBytes ?? MAX_GPU_BYTES)) throw new Error("GPU buffer budget exceeded.");
    this.releaseScene();
    let output: GPUBuffer | undefined;
    let sort: PointCloudSortStuff | undefined;
    try {
      sort = this.sorter.createSortStuff(device, count);
      output = device.createBuffer({ label: `projected splats (${count})`, size: count * BUFFER_CONFIG.SPLAT_STRIDE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      const bindGroup = device.createBindGroup({ layout: PointCloud.renderBindGroupLayout(device),
        entries: [{ binding: 2, resource: { buffer: output } }] });
      this.global = { capacity: count, output, sort, bindGroup };
    } catch (error) {
      output?.destroy();
      if (sort) this.sorter.disposeSortStuff(sort);
      throw error;
    }
  }

  prepareMulti(encoder: GPUCommandEncoder, queue: GPUQueue, clouds: PointCloud[], args: RenderArgs): void {
    if (clouds.length !== 1) throw new Error("The native static viewer renders one scene at a time.");
    const cloud = clouds[0];
    this.ensureCapacity(cloud.numPoints);
    const global = this.global!;
    this.sorter!.recordResetIndirectBuffer(global.sort.sorter_dis, global.sort.sorter_uni, queue);
    let settings = this.settings.get(cloud);
    if (!settings) {
      settings = { gaussianScaling: 1, maxSHDegree: cloud.shDeg, showEnvMap: false,
        mipSplatting: cloud.mipSplatting ?? false, kernelSize: cloud.getKernelSize(), walltime: 0,
        sceneExtend: Math.max(...[0, 1, 2].map((axis) => cloud.bbox.max[axis] - cloud.bbox.min[axis])),
        center: new Float32Array(cloud.center), clippingBoxMin: new Float32Array(cloud.bbox.min),
        clippingBoxMax: new Float32Array(cloud.bbox.max) };
      this.settings.set(cloud, settings);
    }
    settings.maxSHDegree = Math.min(args.maxSHDegree ?? cloud.shDeg, this.config.shDegree);
    // The shader reads the per-model SH limit as well as the shared settings.
    if (cloud.getMaxShDeg() !== settings.maxSHDegree) cloud.setMaxShDeg(settings.maxSHDegree);
    this.preprocessor.dispatchModel({ camera: args.camera, viewport: args.viewport,
      pointCloud: cloud, sortStuff: global.sort, settings, modelMatrix: cloud.transform,
      baseOffset: 0, global: { splat2D: global.output } }, encoder);
    this.sorter!.recordSortIndirect(global.sort, global.sort.sorter_dis, encoder);
    encoder.copyBufferToBuffer(global.sort.sorter_uni, 0, this.drawIndirect!, 4, 4);
  }

  renderMulti(pass: GPURenderPassEncoder, _clouds: PointCloud[]): void {
    if (!this.global || !this.pipeline || !this.drawIndirect || this.disposed) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.global.bindGroup);
    pass.setBindGroup(1, this.global.sort.sorter_render_bg);
    pass.drawIndirect(this.drawIndirect, 0);
  }

  releaseScene(): void {
    if (this.global) {
      this.global.output.destroy();
      this.sorter?.disposeSortStuff(this.global.sort);
      this.global = undefined;
    }
    this.settings = new WeakMap();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseScene();
    this.drawIndirect?.destroy();
    this.preprocessor.dispose();
    this.sorter?.dispose();
    this.pipeline = undefined;
  }
}
