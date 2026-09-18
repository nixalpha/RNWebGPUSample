export const MAX_POINTS = 500_000;
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_GPU_BYTES = 256 * 1024 * 1024;
// The direct scatter path only uses the 256-entry shared histogram.
export const SORT_WORKGROUP_STORAGE = 256 * 4;

// Mirrors radix_sort.ts, including its safety padding and both projected buffers.
export function allocationSizes(count: number): number[] {
  const partition = 256 * 15;
  const padded = (Math.floor((count + partition) / partition) + 1) * partition;
  const histogram = (4 + (Math.ceil(count / partition) + 1) * 2) * 256 * 4;
  return [count * 20, count * 96, count * 32, count * 32,
    padded * 4, padded * 4, padded * 4, padded * 4, histogram,
    16, 128, 20, 12, 16, 272, 80, 272, 80];
}

export function estimateGpuBytes(count: number): number {
  return allocationSizes(count).reduce((sum, value) => sum + value, 0);
}

export function validatePointCount(count: number, maximum = MAX_POINTS): void {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("The scene contains no valid Gaussians.");
  if (count > maximum) throw new Error(`This viewer supports up to ${maximum.toLocaleString()} splats; this file has ${count.toLocaleString()}.`);
  if (estimateGpuBytes(count) > MAX_GPU_BYTES) throw new Error("The scene exceeds the 128 MiB GPU buffer budget.");
}

export function validateGpuAllocation(count: number, limits: GPUSupportedLimits): void {
  validatePointCount(count);
  const largest = Math.max(...allocationSizes(count));
  if (largest > limits.maxBufferSize || largest > limits.maxStorageBufferBindingSize) {
    throw new Error("The scene exceeds this device's storage-buffer limit.");
  }
  if (Math.ceil(count / 256) > limits.maxComputeWorkgroupsPerDimension) {
    throw new Error("The scene exceeds this device's compute dispatch limit.");
  }
}
