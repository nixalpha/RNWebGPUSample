import { mat3, type quat, type vec3 } from 'gl-matrix';
/** Number of SH coefficients for degree `l` */
export function shNumCoefficients(l: number): number { return (l + 1) * (l + 1); }

/** Inverse of `shNumCoefficients`; returns degree if `n` is a perfect square minus 1 */
export function shDegreeFromNumCoeffs(n: number): number | undefined {
  const sqrt = Math.sqrt(n);
  return Number.isInteger(sqrt) ? (sqrt | 0) - 1 : undefined;
}

/**
 * Build symmetric 3×3 covariance (upper triangular order) from rotation `rot` and diagonal scale `scale`.
 * Matches 3D Gaussian Splatting formulation.
 */
export function buildCov(rot: quat, scale: vec3): [number, number, number, number, number, number] {
  const R = mat3.create();
  mat3.fromQuat(R, rot);
  const S = mat3.fromValues(
    scale[0], 0, 0,
    0, scale[1], 0,
    0, 0, scale[2]
  );
  const L = mat3.create();
  mat3.multiply(L, R, S);
  const Lt = mat3.create();
  mat3.transpose(Lt, L);
  const M = mat3.create();
  mat3.multiply(M, L, Lt);
  // Return upper-triangular elements in the same order as Rust: [m00, m01, m02, m11, m12, m22]
  return [M[0], M[1], M[2], M[4], M[5], M[8]];
}

/** Numerically stable sigmoid */
export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const ex = Math.exp(x);
  return ex / (1 + ex);
}
