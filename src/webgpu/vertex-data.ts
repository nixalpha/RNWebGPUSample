import { vec3 } from "gl-matrix";

export const getSpherePosition = (
  radius: number,
  theta: number,
  phi: number,
): vec3 => {
  let x = radius * Math.sin(theta) * Math.cos(phi);
  let y = radius * Math.cos(theta);
  let z = -radius * Math.sin(theta) * Math.sin(phi);
  return vec3.fromValues(x, y, z);
};

export const getSphereData = (radius: number, u: number, v: number) => {
  const pts: number[] = [];

  const indices: number[] = [];

  const row = v + 1;

  for (let i = 0; i <= u; i++) {
    const theta = (i * Math.PI) / u;

    for (let j = 0; j <= v; j++) {
      const phi = (j * 2 * Math.PI) / v;

      pts.push(...getSpherePosition(radius, theta, phi));

      if (i < u && j < v) {
        const idx = j + i * row;

        indices.push(
          idx,
          idx + 1,
          idx,
          idx + row,
        );
      }
    }
  }

  return {
    positions: new Float32Array(pts),
    indices: new Uint32Array(indices),
  };
};
