import type { RNCanvasContext } from "react-native-webgpu";
import { Platform } from "react-native";
import { GaussianRenderer } from "../visionary/renderer/gaussian_renderer";
import { PointCloud } from "../visionary/point_cloud/point_cloud";
import { allocationSizes, estimateGpuBytes, MAX_POINTS, SORT_WORKGROUP_STORAGE, validateGpuAllocation } from "../visionary/memory";
import { throwIfAborted } from "../visionary/io/types";
import { loadScene } from "./load-scene";
import { OrbitCamera } from "./orbit-camera";
import type { FrameStats, Quality, SceneSource, ViewerStatus } from "./types";

export class NativeGaussianSession {
  readonly orbit = new OrbitCamera();
  private device?: GPUDevice;
  private renderer?: GaussianRenderer;
  private clouds: PointCloud[] = [];
  private format?: GPUTextureFormat;
  private disposed = false;
  private failed = false;
  private active = false;
  private loading = false;
  private frameId: number | null = null;
  private abort?: AbortController;
  private loadTask: Promise<void> = Promise.resolve();
  private viewport: [number, number] = [1, 1];
  private hasLayout = false;
  private configured = false;
  private logicalHeight = 1;
  private frameTimes: number[] = [];
  private lastFrame = 0;
  private lastStats = 0;
  private initializing?: Promise<void>;

  constructor(private readonly context: RNCanvasContext,
    private readonly onStatus: (status: ViewerStatus) => void,
    private readonly onStats: (stats: FrameStats) => void) {}

  initialize(): Promise<void> {
    return this.initializing ??= this.initializeOnce();
  }

  private async initializeOnce(): Promise<void> {
    this.onStatus({ phase: "initializing", message: "Preparing WebGPU" });
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (this.disposed) return;
      if (!adapter) throw new Error(Platform.OS === "ios"
        ? "No WebGPU adapter is available. Use a Metal-capable iOS device or supported simulator with Metal API Validation disabled."
        : "No WebGPU adapter is available. Use a physical Vulkan-capable Android device.");
      const required = { maxComputeInvocationsPerWorkgroup: 256, maxComputeWorkgroupSizeX: 256,
        maxComputeWorkgroupStorageSize: SORT_WORKGROUP_STORAGE, maxBindGroups: 4, maxStorageBuffersPerShaderStage: 7 };
      for (const [name, value] of Object.entries(required)) {
        if ((adapter.limits as unknown as Record<string, number>)[name] < value) {
          throw new Error(`Unsupported GPU: ${name} must be at least ${value}.`);
        }
      }
      const largest = Math.max(...allocationSizes(MAX_POINTS));
      const device = await adapter.requestDevice({ label: "Visionary native", requiredLimits: {
        ...required,
        maxBufferSize: Math.min(largest, adapter.limits.maxBufferSize),
        maxStorageBufferBindingSize: Math.min(largest, adapter.limits.maxStorageBufferBindingSize),
      } });
      if (this.disposed) { device.destroy(); return; }
      this.device = device;
      device.lost.then((info) => {
        if (!this.disposed) this.fail(`GPU device lost: ${info.message || info.reason}. Tap Retry to recreate it.`);
      });
      // 0.4.2's native GPUDevice does not expose EventTarget on every platform.
      // Error scopes below remain the primary initialization/upload diagnostics.
      device.addEventListener?.("uncapturederror", this.onGpuError);
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.configure();
      this.onStatus({ phase: "initializing", message: "Compiling shaders and selecting GPU sorter" });
      device.pushErrorScope("validation");
      try {
        this.renderer = new GaussianRenderer({ device, format: this.format, shDegree: 3 });
        await this.renderer.initialize();
      } finally {
        const error = await device.popErrorScope();
        if (error) throw new Error(`GPU pipeline initialization: ${error.message}`);
      }
      if (this.disposed) return;
      console.info("Visionary GPU", { limits: {
        maxBufferSize: device.limits.maxBufferSize,
        maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupStorageSize: device.limits.maxComputeWorkgroupStorageSize,
      } });
    } catch (error) {
      if (!this.disposed) this.fail(error instanceof Error ? error.message : String(error));
      this.destroyResources();
      throw error;
    }
  }

  private readonly onGpuError = (event: GPUUncapturedErrorEvent): void => {
    this.fail(`WebGPU: ${event.error.message}. Tap Retry to recreate the renderer.`);
  };

  private configure(): void {
    if (this.device && this.format && this.active && this.hasLayout && !this.configured && !this.disposed && !this.failed) {
      this.context.canvas.width = this.viewport[0];
      this.context.canvas.height = this.viewport[1];
      this.orbit.resize(...this.viewport);
      this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      this.configured = true;
    }
  }

  resize(width: number, height: number, pixelRatio: number, quality: Quality): void {
    if (this.disposed) return;
    if (width <= 0 || height <= 0) {
      this.hasLayout = false;
      this.configured = false;
      this.stopFrames();
      return;
    }
    const hadLayout = this.hasLayout;
    this.hasLayout = true;
    const scale = Math.min(pixelRatio, 1280 / Math.max(width, height)) * quality;
    const next: [number, number] = [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
    this.logicalHeight = height;
    if (hadLayout && next[0] === this.viewport[0] && next[1] === this.viewport[1]) return;
    this.viewport = next;
    this.configured = false;
    try {
      this.configure();
      this.startFrames();
    } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
  }

  setActive(active: boolean): void {
    if (this.disposed || this.failed) return;
    this.active = active;
    if (!active) { this.stopFrames(); this.configured = false; }
    else {
      try { this.configure(); this.startFrames(); }
      catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
    }
  }

  orbitBy(dx: number, dy: number): void { this.orbit.orbit(dx, dy, this.logicalHeight); }
  panBy(dx: number, dy: number): void { this.orbit.pan(dx, dy, this.logicalHeight); }
  zoomBy(ratio: number): void { this.orbit.zoom(ratio); }
  resetCamera(): void { this.orbit.reset(); }

  load(source: SceneSource): Promise<void> {
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.loading = true;
    this.stopFrames();
    // Serialize scene mutations; cancelled parsing exits at its next yield.
    this.loadTask = this.loadTask.catch(() => {}).then(async () => {
      if (this.disposed || this.failed || abort.signal.aborted) {
        if (this.abort === abort) this.loading = false;
        return;
      }
      const started = performance.now();
      this.releaseScene();
      this.onStatus({ phase: "loading", message: "Opening scene", progress: 0 });
      let cloud: PointCloud | undefined;
      try {
        this.clear();
        const data = await loadScene(source, { signal: abort.signal, onProgress: ({ stage, progress }) => {
          if (!this.disposed && !abort.signal.aborted) this.onStatus({ phase: "loading", message: stage, progress });
        } });
        throwIfAborted(abort.signal);
        if (!this.device || !this.renderer || this.disposed || this.failed) return;
        validateGpuAllocation(data.numPoints(), this.device.limits);
        this.onStatus({ phase: "loading", message: "Uploading Gaussians", progress: 1 });
        const device = this.device;
        device.pushErrorScope("out-of-memory");
        device.pushErrorScope("validation");
        try {
          cloud = new PointCloud(this.device, data);
          // Allocate the scene's buffers and encode once inside the error scopes.
          this.clouds = [cloud];
          this.renderer.reserve(cloud.numPoints);
          this.orbit.fit(cloud.bbox);
          if (this.active) this.draw();
        } finally {
          const validation = await device.popErrorScope();
          const memory = await device.popErrorScope();
          if (validation || memory) throw new Error((validation ?? memory)!.message);
        }
        throwIfAborted(abort.signal);
        if (this.disposed || this.failed) return;
        this.onStatus({ phase: "ready", message: source.name, pointCount: data.numPoints(),
          estimatedGpuBytes: estimateGpuBytes(data.numPoints()), loadMilliseconds: performance.now() - started });
      } catch (error) {
        this.cleanup(() => cloud?.dispose());
        this.releaseScene();
        if (!this.disposed && !this.failed && !abort.signal.aborted) this.onStatus({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        if (this.abort === abort) {
          if (abort.signal.aborted) this.releaseScene();
          this.loading = false;
          if (!this.disposed && !this.failed) this.startFrames();
        }
      }
    });
    return this.loadTask;
  }

  cancelLoading(): void {
    this.abort?.abort();
    if (!this.disposed && !this.failed) this.onStatus({ phase: "cancelled", message: "Loading cancelled. Open a file or load the demo." });
  }

  private draw(): void {
    if (!this.device || !this.renderer || !this.clouds.length || !this.active || !this.configured || this.disposed || this.failed) return;
    const encoder = this.device.createCommandEncoder({ label: "Gaussian frame" });
    this.renderer.prepareMulti(encoder, this.device.queue, this.clouds, { camera: this.orbit.camera, viewport: this.viewport });
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: this.context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store",
    }] });
    this.renderer.renderMulti(pass, this.clouds);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.context.present();
  }

  private clear(): void {
    if (!this.device || !this.active || !this.configured || this.disposed || this.failed) return;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(),
      loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }] });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.context.present();
  }

  private startFrames(): void {
    if (this.frameId !== null || !this.active || !this.configured || this.loading || !this.clouds.length || this.disposed || this.failed) return;
    this.lastFrame = 0;
    this.frameTimes = [];
    this.lastStats = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (time: number): void => {
    this.frameId = null;
    if (this.disposed || this.failed || !this.active || !this.configured || this.loading || !this.clouds.length) return;
    try {
      this.draw();
      if (this.lastFrame) this.frameTimes.push(time - this.lastFrame);
      this.lastFrame = time;
      if (time - this.lastStats >= 1000 && this.frameTimes.length) {
        const samples = this.frameTimes.sort((a, b) => a - b);
        const total = samples.reduce((a, b) => a + b, 0);
        this.onStats({ fps: samples.length * 1000 / total, medianMs: samples[Math.floor(samples.length / 2)],
          p95Ms: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))], width: this.viewport[0], height: this.viewport[1] });
        this.frameTimes = [];
        this.lastStats = time;
      }
      this.frameId = requestAnimationFrame(this.frame);
    } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
  };

  private stopFrames(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.lastFrame = 0;
  }

  private releaseScene(): void {
    for (const cloud of this.clouds) this.cleanup(() => cloud.dispose());
    this.clouds = [];
    this.cleanup(() => this.renderer?.releaseScene());
  }

  private cleanup(action: () => void): void {
    try { action(); } catch (error) { console.warn("WebGPU cleanup failed", error); }
  }

  private destroyResources(): void {
    this.releaseScene();
    this.cleanup(() => this.renderer?.dispose());
    this.renderer = undefined;
    const device = this.device;
    this.device = undefined;
    this.configured = false;
    if (device) {
      this.cleanup(() => device.removeEventListener?.("uncapturederror", this.onGpuError));
      // A detached Metal surface must not prevent the device from being freed.
      this.cleanup(() => this.context.unconfigure());
      this.cleanup(() => device.destroy());
    }
  }

  private fail(message: string): void {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.stopFrames();
    this.abort?.abort();
    this.onStatus({ phase: "error", message });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort?.abort();
    this.stopFrames();
    this.destroyResources();
  }
}
