# Visionary static core for React Native

Derived from https://github.com/Visionary-Laboratory/visionary at commit
`e50f3f6c7200be0516567f0830e5240dfa26d27d` (visionary-core 1.0.1).
The upstream Apache-2.0 license is reproduced in `LICENSE` in this directory.
Original authors: the Visionary contributors, Shanghai AI Laboratory, Sichuan
University, The University of Tokyo, Northwestern Polytechnical University,
and Shanghai Jiao Tong University. Upstream acknowledges web-splat and Three.js.

This is a vendored static subset, not a new distribution of the browser editor.
Changes made for this app:

- Explicit native-safe imports; no DOM, ONNX, Three.js, or Vite runtime dependency.
- WGSL sources compiled into JavaScript string modules at asset-generation time.
- Static single-scene renderer retaining upstream preprocess, radix-sort, and
  premultiplied-alpha splat draw operations. Scene-sized allocations replace the
  fixed million-point allocation; all buffers have explicit ownership/teardown.
- Bind groups cached by point cloud and buffer identity. Camera projection resize
  keeps vertical FOV fixed. Explicit buffer/device limits and mobile budgets.
- PLY/SPLAT loading rewritten around the original covariance/half-float packing
  for cancellable batches, scalar-aware PLY decoding, no DOM text decoder, and
  bounded memory. Standard SPLAT quaternion bytes are w,x,y,z; the original
  loader read them as x,y,z,w. SH degree 1/2 uses the source channel stride rather
  than treating every source as degree 3.
- Preprocessing returns for padded invocations beyond the point count. Degenerate
  projected eigenvectors use a finite axis instead of normalizing a zero vector.
- GPU sorter selection uses a deterministic permutation, releases probe resources,
  and retains the upstream three-phase scatter algorithm.

`io/static-loaders.ts`, `renderer/gaussian_renderer.ts`, and `memory.ts` are native
adaptations. `gaussian/` outside this directory owns the Expo/native integration.
Generated ring scenes are original procedural fixtures and contain no downloaded
third-party assets.

When updating upstream, reconcile the three WGSL kernels with buffer layouts,
workgroup constants, storage requirements, and `memory.ts` together. Do not restore
browser barrel imports or ONNX initialization into the native import graph.
