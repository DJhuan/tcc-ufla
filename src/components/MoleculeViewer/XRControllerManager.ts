import * as THREE from "three";
import type { TransformControls } from "three/addons/controls/TransformControls.js";

export type XRControllerData = {
  index: number;
  targetRay: THREE.XRTargetRaySpace;
  handedness: XRHandedness;
  rayLine: THREE.Line;
};

/**
 * Gerenciador modular de controladores WebXR.
 * - Trata o ciclo de vida dinâmico de múltiplos controles (connected / disconnected)
 * - Cria feedback visual (mira laser) para cada controle ativo no espaço 3D
 * - Arbitra o foco e as operações de manipulação com o TransformControls
 * - Atualiza o raycaster e eventos de transformação frame a frame no renderLoop
 */
export class XRControllerManager {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly transformControls: TransformControls;

  private readonly controllers = new Map<THREE.XRTargetRaySpace, XRControllerData>();
  private interactingController: THREE.XRTargetRaySpace | null = null;
  private readonly targetRaySlots: THREE.XRTargetRaySpace[] = [];

  public constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    transformControls: TransformControls,
    slotCount = 2,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.transformControls = transformControls;

    for (let i = 0; i < slotCount; i += 1) {
      const targetRay = this.renderer.xr.getController(i);

      targetRay.addEventListener("connected", this.handleConnected);
      targetRay.addEventListener("disconnected", this.handleDisconnected);
      targetRay.addEventListener("selectstart", this.handleSelectStart);
      targetRay.addEventListener("selectend", this.handleSelectEnd);

      this.scene.add(targetRay);
      this.targetRaySlots.push(targetRay);
    }
  }

  /**
   * Chamado continuamente no loop de renderização (renderLoop).
   * Atualiza a mira ou o arrasto do TransformControls no espaço 3D.
   */
  public update(): void {
    if (!this.renderer.xr.isPresenting || this.controllers.size === 0) {
      return;
    }

    if (this.interactingController) {
      this.transformControls
        .getRaycaster()
        .setFromXRController(this.interactingController);
      this.transformControls.pointerMove(null);
      return;
    }

    for (const [targetRay] of this.controllers) {
      this.transformControls
        .getRaycaster()
        .setFromXRController(targetRay);
      this.transformControls.pointerHover(null);

      if ((this.transformControls as any).axis !== null) {
        break;
      }
    }
  }

  private handleConnected = (event: THREE.Event & { data?: XRInputSource }) => {
    const targetRay = event.target as THREE.XRTargetRaySpace;
    const inputSource = event.data;
    const handedness: XRHandedness = inputSource?.handedness ?? "none";

    let rayLine = this.controllers.get(targetRay)?.rayLine;
    if (!rayLine) {
      rayLine = this.createRayLine();
      targetRay.add(rayLine);
    }

    const index = this.targetRaySlots.indexOf(targetRay);

    this.controllers.set(targetRay, {
      index: index >= 0 ? index : this.controllers.size,
      targetRay,
      handedness,
      rayLine,
    });
  };

  private handleDisconnected = (event: THREE.Event) => {
    const targetRay = event.target as THREE.XRTargetRaySpace;
    const controllerData = this.controllers.get(targetRay);

    if (controllerData) {
      if (controllerData.rayLine) {
        targetRay.remove(controllerData.rayLine);
        controllerData.rayLine.geometry.dispose();
        if (Array.isArray(controllerData.rayLine.material)) {
          controllerData.rayLine.material.forEach((mat) => mat.dispose());
        } else {
          controllerData.rayLine.material.dispose();
        }
      }

      if (this.interactingController === targetRay) {
        this.transformControls.pointerUp(null);
        this.interactingController = null;
      }

      this.controllers.delete(targetRay);
    }
  };

  private handleSelectStart = (event: THREE.Event) => {
    const targetRay = event.target as THREE.XRTargetRaySpace;
    if (!this.controllers.has(targetRay)) return;

    // Se nenhum controle estiver manipulando no momento, este assume o foco
    if (!this.interactingController) {
      this.interactingController = targetRay;
      this.transformControls
        .getRaycaster()
        .setFromXRController(targetRay);
      this.transformControls.pointerDown(null);
    }
  };

  private handleSelectEnd = (event: THREE.Event) => {
    const targetRay = event.target as THREE.XRTargetRaySpace;

    if (this.interactingController === targetRay) {
      this.transformControls.pointerUp(null);
      this.interactingController = null;
    }
  };

  private createRayLine(): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -3], 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute([0.2, 0.6, 1, 0.05, 0.2, 0.8], 3),
    );

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    const line = new THREE.Line(geometry, material);
    line.name = "XRControllerRay";
    return line;
  }

  public getControllers(): ReadonlyMap<THREE.XRTargetRaySpace, XRControllerData> {
    return this.controllers;
  }

  public getInteractingController(): THREE.XRTargetRaySpace | null {
    return this.interactingController;
  }

  public dispose(): void {
    if (this.interactingController) {
      this.transformControls.pointerUp(null);
      this.interactingController = null;
    }

    for (const targetRay of this.targetRaySlots) {
      targetRay.removeEventListener("connected", this.handleConnected);
      targetRay.removeEventListener("disconnected", this.handleDisconnected);
      targetRay.removeEventListener("selectstart", this.handleSelectStart);
      targetRay.removeEventListener("selectend", this.handleSelectEnd);

      const controllerData = this.controllers.get(targetRay);
      if (controllerData?.rayLine) {
        targetRay.remove(controllerData.rayLine);
        controllerData.rayLine.geometry.dispose();
        if (Array.isArray(controllerData.rayLine.material)) {
          controllerData.rayLine.material.forEach((mat) => mat.dispose());
        } else {
          controllerData.rayLine.material.dispose();
        }
      }

      this.scene.remove(targetRay);
    }

    this.controllers.clear();
    this.targetRaySlots.length = 0;
  }
}
