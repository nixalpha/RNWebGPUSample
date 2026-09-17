import type { SceneSource } from "./types";

export const DEMO: SceneSource = { kind: "asset", asset: require("../../assets/gaussians/rings-50000.splat"), name: "Interlocking rings · 50k" };
export const BENCHMARK_SCENES: SceneSource[] = [
  { kind: "asset", asset: require("../../assets/gaussians/rings-64.splat"), name: "Fixture · 64" },
  DEMO,
  { kind: "asset", asset: require("../../assets/gaussians/rings-100000.splat"), name: "Interlocking rings · 100k" },
  { kind: "asset", asset: require("../../assets/gaussians/rings-250000.splat"), name: "Interlocking rings · 250k" },
];
