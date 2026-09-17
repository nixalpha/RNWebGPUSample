export type Vec3Tuple = [number, number, number];

export interface GaussianDataSource {
  gaussianBuffer(): ArrayBuffer;
  shCoefsBuffer(): ArrayBuffer;
  numPoints(): number;
  shDegree(): number;
  bbox(): { min: Vec3Tuple; max: Vec3Tuple };
  center?: Vec3Tuple;
  up?: Vec3Tuple | null;
  mipSplatting?: boolean;
  kernelSize?: number;
  backgroundColor?: Vec3Tuple;
}

export interface LoadingProgress {
  progress: number;
  stage: string;
}

export interface LoadingOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LoadingProgress) => void;
  maxPoints?: number;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Loading cancelled");
    error.name = "AbortError";
    throw error;
  }
}

export async function yieldToUI(options?: LoadingOptions): Promise<void> {
  throwIfAborted(options?.signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(options?.signal);
}
