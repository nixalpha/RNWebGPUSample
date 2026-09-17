export type SceneSource =
  | { kind: "asset"; asset: number; name: string }
  | { kind: "file"; uri: string; name: string; size?: number };

export type ViewerStatus = {
  phase: "initializing" | "loading" | "ready" | "error" | "cancelled";
  message: string;
  progress?: number;
  pointCount?: number;
  estimatedGpuBytes?: number;
  loadMilliseconds?: number;
};

export interface FrameStats {
  fps: number;
  medianMs: number;
  p95Ms: number;
  width: number;
  height: number;
}

export type Quality = 1 | 0.75 | 0.5;
