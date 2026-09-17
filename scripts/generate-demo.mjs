import { mkdir, writeFile } from "node:fs/promises";

// Original procedural data, no downloaded or third-party scene assets.
// Three interlocking rings of rotated, anisotropic Gaussians.
const directory = new URL("../assets/gaussians/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const count of [64, 50000, 100000, 250000]) {
  const bytes = Buffer.alloc(count * 32);
  for (let i = 0; i < count; i++) {
    const ring = i % 3;
    const t = i * 2.399963229728653;
    const v = i * 1.618033988749895;
    const radius = 1.4 + 0.25 * Math.cos(v);
    let x = radius * Math.cos(t), y = radius * Math.sin(t), z = 0.25 * Math.sin(v);
    if (ring === 1) [y, z] = [z, y];
    if (ring === 2) [x, z] = [z, x];
    const offset = i * 32;
    [x, y, z, 0.018, 0.007, 0.012].forEach((value, field) => bytes.writeFloatLE(value, offset + field * 4));
    const colors = [[245, 105, 65], [65, 195, 235], [180, 115, 245]];
    colors[ring].forEach((value, channel) => { bytes[offset + 24 + channel] = value; });
    bytes[offset + 27] = 190;
    // Standard .splat quaternion order is w, x, y, z, mapped by (value * 128 + 128).
    [Math.cos(t / 2), 0, 0, Math.sin(t / 2)].forEach((value, component) => {
      bytes[offset + 28 + component] = Math.max(0, Math.min(255, Math.round(value * 128 + 128)));
    });
  }
  await writeFile(new URL(`rings-${count}.splat`, directory), bytes);
}
