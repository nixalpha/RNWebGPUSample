import { mat4, vec3 } from "gl-matrix";

export class MvpMatrixState {
  private modelMat: mat4;
  private viewMat: mat4;
  private projectionMat: mat4;

  constructor(windowWidth: number, windowHeight: number) {
    this.modelMat = mat4.create();
    this.viewMat = this.createViewTransform([0, 0, 5]);
    this.projectionMat = this.createProjectionMat(windowWidth / windowHeight);
  }

  private createViewTransform = (
    cameraPos: vec3 = [2, 2, 4],
    lookDir: vec3 = [0, 0, 0],
    upDir: vec3 = [0, 1, 0],
  ) => mat4.lookAt(mat4.create(), cameraPos, lookDir, upDir);

  private createProjectionMat = (aspectRatio: number) =>
    mat4.perspective(
      mat4.create(),
      (2 * Math.PI) / 5,
      aspectRatio,
      0.1,
      1000.0,
    );

  private createModelMat = (
    translation: vec3 = [0, 0, 0],
    rotation: vec3 = [0, 0, 0],
    scale: vec3 = [1, 1, 1],
  ) => {
    const modelMat = mat4.create();
    mat4.translate(modelMat, modelMat, translation);
    mat4.rotateX(modelMat, modelMat, rotation[0]);
    mat4.rotateY(modelMat, modelMat, rotation[1]);
    mat4.rotateZ(modelMat, modelMat, rotation[2]);
    mat4.scale(modelMat, modelMat, scale);
    return modelMat;
  };

  setRotation = ({
    x = 0,
    y = 0,
    z = 0,
  }) => {
    const rotation = vec3.fromValues(x, y, z);
    this.modelMat = this.createModelMat([0, 0, 0], rotation);
  };

  getMvpMatrix = () => {
    const mvpMat = mat4.create();
    mat4.multiply(mvpMat, this.viewMat, this.modelMat);
    mat4.multiply(mvpMat, this.projectionMat, mvpMat);
    return mvpMat;
  };
}