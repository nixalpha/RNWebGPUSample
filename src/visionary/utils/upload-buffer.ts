const UPLOAD_CHUNK_BYTES = 1024 * 1024;

/** Upload without entering the bundled Dawn's faulty >4 MiB staging path. */
export function uploadBuffer(
  queue: GPUQueue,
  destination: GPUBuffer,
  source: ArrayBuffer,
): void {
  if (source.byteLength % 4 !== 0) {
    throw new Error("GPU buffer uploads must have a byte length divisible by four.");
  }

  // Large writes that are four-byte but not eight-byte aligned can abort in
  // Dawn when its padded staging range differs from the source length.
  // ArrayBuffer offsets and sizes are in bytes; no source copies or padding.
  for (let offset = 0; offset < source.byteLength; offset += UPLOAD_CHUNK_BYTES) {
    const size = Math.min(UPLOAD_CHUNK_BYTES, source.byteLength - offset);
    queue.writeBuffer(destination, offset, source, offset, size);
  }
}
