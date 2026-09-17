// Adapted from Visionary's PLY/SPLAT loaders. See ../UPSTREAM.md.
import { quat } from "gl-matrix";
import { buildCov, sigmoid } from "../utils/gaussian-math";
import { f32_to_f16 } from "../utils/half";
import { MAX_FILE_BYTES, validatePointCount } from "../memory";
import { PLYGaussianData } from "./GaussianData";
import { throwIfAborted, yieldToUI, type LoadingOptions, type Vec3Tuple } from "./types";

// PLY syntax and numeric payloads are ASCII. Decode bytes directly so header
// offsets stay byte-exact even with non-ASCII comments, without a DOM polyfill.
function ascii(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return text;
}

type Scalar = { bytes: number; read: (view: DataView, offset: number, little: boolean) => number };
const scalars: Record<string, Scalar> = {
  char: { bytes: 1, read: (v, o) => v.getInt8(o) },
  uchar: { bytes: 1, read: (v, o) => v.getUint8(o) },
  short: { bytes: 2, read: (v, o, le) => v.getInt16(o, le) },
  ushort: { bytes: 2, read: (v, o, le) => v.getUint16(o, le) },
  int: { bytes: 4, read: (v, o, le) => v.getInt32(o, le) },
  uint: { bytes: 4, read: (v, o, le) => v.getUint32(o, le) },
  float: { bytes: 4, read: (v, o, le) => v.getFloat32(o, le) },
  double: { bytes: 8, read: (v, o, le) => v.getFloat64(o, le) },
};
for (const [alias, original] of Object.entries({ int8: "char", uint8: "uchar", int16: "short", uint16: "ushort", int32: "int", uint32: "uint", float32: "float", float64: "double" })) {
  scalars[alias] = scalars[original];
}

function checkedHalf(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 65504) {
    throw new Error("A Gaussian attribute is non-finite or outside the renderer's half-float range.");
  }
  return f32_to_f16(value);
}

class PackedScene {
  readonly gaussians: Uint16Array;
  readonly sh: Uint16Array;
  readonly min: Vec3Tuple = [Infinity, Infinity, Infinity];
  readonly max: Vec3Tuple = [-Infinity, -Infinity, -Infinity];
  private sum: Vec3Tuple = [0, 0, 0];

  constructor(readonly count: number, readonly degree: number, options?: LoadingOptions) {
    validatePointCount(count, options?.maxPoints);
    this.gaussians = new Uint16Array(count * 10);
    this.sh = new Uint16Array(count * 48);
  }

  write(index: number, position: Vec3Tuple, scale: Vec3Tuple, rotation: quat, opacity: number): void {
    if (!position.every(Number.isFinite) || !scale.every((x) => Number.isFinite(x) && x > 0) ||
        !Array.from(rotation).every(Number.isFinite) || quat.length(rotation) < 1e-8 ||
        !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new Error(`Invalid Gaussian at index ${index}.`);
    }
    quat.normalize(rotation, rotation);
    const covariance = buildCov(rotation, scale);
    const base = index * 10;
    [...position, opacity, ...covariance].forEach((value, offset) => {
      this.gaussians[base + offset] = checkedHalf(value);
    });
    for (let axis = 0; axis < 3; axis++) {
      this.min[axis] = Math.min(this.min[axis], position[axis]);
      this.max[axis] = Math.max(this.max[axis], position[axis]);
      this.sum[axis] += position[axis];
    }
  }

  finish(): PLYGaussianData {
    return new PLYGaussianData({
      gaussianBuffer: this.gaussians.buffer as ArrayBuffer,
      shCoefsBuffer: this.sh.buffer as ArrayBuffer,
      numPoints: this.count,
      shDegree: this.degree,
      bbox: { min: this.min, max: this.max },
      center: this.sum.map((value) => value / this.count) as Vec3Tuple,
      up: [0, 1, 0],
    });
  }
}

function checkInput(buffer: ArrayBuffer, options?: LoadingOptions): void {
  throwIfAborted(options?.signal);
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error("Files must be at most 128 MiB.");
  if (buffer.byteLength === 0) throw new Error("The selected file is empty.");
}

export class SplatLoader {
  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    checkInput(buffer, options);
    if (buffer.byteLength % 32 !== 0) throw new Error("Truncated SPLAT file: each record must be 32 bytes.");
    const count = buffer.byteLength / 32;
    const packed = new PackedScene(count, 0, options);
    const view = new DataView(buffer);
    for (let i = 0; i < count; i++) {
      if (i % 2048 === 0) {
        options?.onProgress?.({ progress: i / count, stage: "Decoding SPLAT" });
        await yieldToUI(options);
      }
      const offset = i * 32;
      const position: Vec3Tuple = [0, 4, 8].map((o) => view.getFloat32(offset + o, true)) as Vec3Tuple;
      const scale: Vec3Tuple = [12, 16, 20].map((o) => view.getFloat32(offset + o, true)) as Vec3Tuple;
      // Standard SPLAT stores w,x,y,z; gl-matrix expects x,y,z,w.
      const rotation = quat.fromValues(
        (view.getUint8(offset + 29) - 128) / 128,
        (view.getUint8(offset + 30) - 128) / 128,
        (view.getUint8(offset + 31) - 128) / 128,
        (view.getUint8(offset + 28) - 128) / 128,
      );
      packed.write(i, position, scale, rotation, view.getUint8(offset + 27) / 255);
      for (let channel = 0; channel < 3; channel++) {
        packed.sh[i * 48 + channel] = checkedHalf((view.getUint8(offset + 24 + channel) / 255 - 0.5) / 0.28209479177387814);
      }
    }
    throwIfAborted(options?.signal);
    return packed.finish();
  }
}

export class PLYLoader {
  async loadBuffer(buffer: ArrayBuffer, options?: LoadingOptions): Promise<PLYGaussianData> {
    checkInput(buffer, options);
    const bytes = new Uint8Array(buffer);
    const headerText = ascii(bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)));
    const match = /(?:^|\n)end_header\r?\n/.exec(headerText);
    if (!match || !/^ply\r?\n/.test(headerText)) throw new Error("Missing or invalid PLY header (maximum 1 MiB).");
    const bodyOffset = match.index + match[0].length;
    const lines = headerText.slice(0, match.index).split(/\r?\n/);
    let format = "", count = 0, inVertex = false, sawVertex = false;
    let stride = 0;
    const properties: { name: string; offset: number; scalar: Scalar }[] = [];
    for (const line of lines) {
      const tokens = line.trim().split(/\s+/);
      if (tokens[0] === "format") format = tokens[1];
      if (tokens[0] === "element") {
        inVertex = tokens[1] === "vertex";
        if (inVertex) {
          if (sawVertex) throw new Error("Duplicate PLY vertex element.");
          sawVertex = true;
          count = Number(tokens[2]);
        } else if (!sawVertex && Number(tokens[2]) !== 0) {
          throw new Error("Compressed PLY and elements preceding vertices are not supported.");
        }
      }
      if (tokens[0] === "property" && inVertex) {
        const scalar = scalars[tokens[1]];
        if (!scalar || !tokens[2] || properties.some((p) => p.name === tokens[2])) throw new Error("Unsupported or duplicate PLY vertex property.");
        properties.push({ name: tokens[2], offset: stride, scalar });
        stride += scalar.bytes;
      }
    }
    if (!["ascii", "binary_little_endian", "binary_big_endian"].includes(format)) throw new Error("Unsupported PLY encoding.");
    validatePointCount(count, options?.maxPoints);
    const names = properties.map((p) => p.name);
    const required = ["x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3", "f_dc_0", "f_dc_1", "f_dc_2"];
    const indices = required.map((name) => {
      const index = names.indexOf(name);
      if (index < 0) throw new Error(`Gaussian PLY requires ${name}; mesh/compressed PLY is not supported.`);
      return index;
    });
    const restCount = names.filter((name) => name.startsWith("f_rest_")).length;
    const degree = Math.sqrt(restCount / 3 + 1) - 1;
    if (!Number.isInteger(degree) || degree < 0 || degree > 3) throw new Error("PLY spherical harmonics must have degree 0–3.");
    const restIndices = Array.from({ length: restCount }, (_, i) => {
      const index = names.indexOf(`f_rest_${i}`);
      if (index < 0) throw new Error("PLY spherical harmonic coefficients must be contiguous.");
      return index;
    });
    if (format !== "ascii" && bodyOffset + count * stride > bytes.length) throw new Error("Truncated binary PLY payload.");
    const packed = new PackedScene(count, degree, options);
    const view = new DataView(buffer);
    const row = new Array<number>(properties.length);
    let cursor = bodyOffset;
    for (let i = 0; i < count; i++) {
      if (i % 2048 === 0) {
        options?.onProgress?.({ progress: i / count, stage: "Decoding PLY" });
        await yieldToUI(options);
      }
      if (format === "ascii") {
        let values: string[] = [];
        while (cursor < bytes.length && values.length === 0) {
          const start = cursor;
          while (cursor < bytes.length && bytes[cursor] !== 10) cursor++;
          const line = ascii(bytes.subarray(start, cursor)).trim();
          cursor++;
          if (line) values = line.split(/\s+/);
        }
        if (values.length !== properties.length) throw new Error(`Malformed PLY row ${i}.`);
        for (let p = 0; p < row.length; p++) row[p] = Number(values[p]);
      } else {
        const base = bodyOffset + i * stride;
        properties.forEach((p, j) => { row[j] = p.scalar.read(view, base + p.offset, format === "binary_little_endian"); });
      }
      if (!row.every(Number.isFinite)) throw new Error(`Non-finite PLY value at row ${i}.`);
      const v = indices.map((index) => row[index]);
      packed.write(i, [v[0], v[1], v[2]], [Math.exp(v[4]), Math.exp(v[5]), Math.exp(v[6])],
        quat.fromValues(v[8], v[9], v[10], v[7]), sigmoid(v[3]));
      for (let channel = 0; channel < 3; channel++) packed.sh[i * 48 + channel] = checkedHalf(v[11 + channel]);
      const perChannel = restCount / 3;
      for (let coefficient = 0; coefficient < perChannel; coefficient++) {
        for (let channel = 0; channel < 3; channel++) {
          packed.sh[i * 48 + 3 + coefficient * 3 + channel] = checkedHalf(row[restIndices[channel * perChannel + coefficient]]);
        }
      }
    }
    throwIfAborted(options?.signal);
    return packed.finish();
  }
}
