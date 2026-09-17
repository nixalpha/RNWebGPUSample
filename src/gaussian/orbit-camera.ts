import { mat3, quat, vec3 } from "gl-matrix";
import { PerspectiveCamera, PerspectiveProjection } from "../visionary/camera/perspective";
import type { Aabb } from "../visionary/utils/aabb";

// Visionary uses a +Z-forward camera with a world-to-camera quaternion.
export class OrbitCamera {
  readonly camera = new PerspectiveCamera(vec3.fromValues(0, 0, -5), quat.create(),
    new PerspectiveProjection([1, 1], [Math.PI / 4, Math.PI / 4], 0.01, 100));
  private target = vec3.create();
  private homeTarget = vec3.create();
  private radius = 1;
  private distance = 5;
  private homeDistance = 5;
  private yaw = 0;
  private pitch = 0;
  private right = vec3.fromValues(1, 0, 0);
  private up = vec3.fromValues(0, 1, 0);

  fit(bounds: Aabb): void {
    vec3.copy(this.homeTarget, bounds.center());
    this.radius = Math.max(bounds.radius(), 0.01);
    this.homeDistance = this.radius / Math.sin(Math.min(this.camera.projection.fovx, this.camera.projection.fovy) / 2) * 1.15;
    this.reset();
  }

  reset(): void {
    vec3.copy(this.target, this.homeTarget);
    this.distance = this.homeDistance;
    this.yaw = 0;
    this.pitch = 0;
    this.update();
  }

  resize(width: number, height: number): void {
    this.camera.projection.resize([width, height]);
  }

  orbit(dx: number, dy: number, height: number): void {
    this.yaw -= dx * Math.PI * 2 / Math.max(1, height);
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * Math.PI / Math.max(1, height)));
    this.update();
  }

  pan(dx: number, dy: number, height: number): void {
    const scale = 2 * this.distance * Math.tan(this.camera.projection.fovy / 2) / Math.max(height, 1);
    vec3.scaleAndAdd(this.target, this.target, this.right, -dx * scale);
    vec3.scaleAndAdd(this.target, this.target, this.up, -dy * scale);
    this.update();
  }

  zoom(ratio: number): void {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    this.distance = Math.max(this.radius * 0.05, Math.min(this.radius * 30, this.distance / ratio));
    this.update();
  }

  private update(): void {
    const offset = vec3.fromValues(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    vec3.scaleAndAdd(this.camera.positionV, this.target, offset, this.distance);
    const forward = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), this.target, this.camera.positionV));
    vec3.normalize(this.right, vec3.cross(this.right, [0, 1, 0], forward));
    vec3.normalize(this.up, vec3.cross(this.up, forward, this.right));
    // Rows are camera basis vectors; mat3.fromValues takes columns.
    const rotation = mat3.fromValues(this.right[0], this.up[0], forward[0],
      this.right[1], this.up[1], forward[1], this.right[2], this.up[2], forward[2]);
    quat.normalize(this.camera.rotationQ, quat.fromMat3(this.camera.rotationQ, rotation));
    const toCenter = vec3.distance(this.camera.positionV, this.homeTarget);
    this.camera.projection.znear = Math.max(this.radius * 0.001, 0.0001);
    this.camera.projection.zfar = Math.max(toCenter + this.radius * 4, this.camera.projection.znear * 100);
  }
}
