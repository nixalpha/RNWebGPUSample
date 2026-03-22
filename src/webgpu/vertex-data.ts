export const getSphereData = (
  radius: number,
  latSegments: number,
  lonSegments: number,
) => {
  const pts: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const lineIndices: number[] = [];

  const rowSize = lonSegments + 1;

  for (let i = 0; i <= latSegments; i++) {
    const v = i / latSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let j = 0; j <= lonSegments; j++) {
      const u = j / lonSegments;
      const phi = u * 2 * Math.PI;

      // 1. Calculate Unit Vector (Normal)
      const x = sinTheta * Math.cos(phi);
      const y = cosTheta;
      const z = -sinTheta * Math.sin(phi);

      // 2. Push Vertex Attributes
      normals.push(x, y, z);
      pts.push(x * radius, y * radius, z * radius);
      uvs.push(u, v);

      // 3. Generate Indices (Skip the last row and last column)
      if (i < latSegments && j < lonSegments) {
        const curr = j + i * rowSize;
        const next = curr + rowSize;

        // Triangles (Two per quad)
        indices.push(curr, curr + 1, next + 1, next + 1, next, curr);

        // Lines (Grid/Wireframe)
        lineIndices.push(curr, curr + 1, curr, next);
      }
    }
  }

  return {
    positions: new Float32Array(pts),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    lineIndices: new Uint32Array(lineIndices),
  };
};
