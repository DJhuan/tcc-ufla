import * as THREE from "three";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import type { MoleculeStore } from "../state/MoleculeStore";
import type { VRMenu } from "./VRMenu";

export type LaserState = "idle" | "hover" | "active";

export type XRControllerData = {
  index: number;
  targetRay: THREE.XRTargetRaySpace;
  handedness: XRHandedness;
  rayLine: THREE.Line;
  laserState: LaserState;
  /**
   * Flag de debounce para o thumbstick: true enquanto o eixo X
   * estiver além da deadzone; resetado quando axis retorna ao neutro.
   */
  thumbstickFired: boolean;
};

/**
 * Gerenciador modular de controladores WebXR.
 * - Trata o ciclo de vida dinâmico de múltiplos controles (connected / disconnected)
 * - Cria feedback visual (mira laser dinâmica: idle, hover, active) para cada controle
 * - Executa leitura contínua de mira e hover do TransformControls frame a frame no renderLoop
 * - Integra VRMenu: hover de botões via raycaster e clique via selectstart
 * - Lê Gamepad / Thumbstick para navegar entre moléculas e reposicionar o menu
 */
export class XRControllerManager {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly transformControls: TransformControls;
  private readonly store?: MoleculeStore;
  private readonly vrMenu?: VRMenu;
  private readonly moleculeRaycaster = new THREE.Raycaster();

  private readonly controllers = new Map<THREE.XRTargetRaySpace, XRControllerData>();
  private interactingController: THREE.XRTargetRaySpace | null = null;
  private readonly targetRaySlots: THREE.XRTargetRaySpace[] = [];

  /** Deadzone para leitura de thumbstick (0–1). */
  private static readonly THUMBSTICK_DEADZONE = 0.6;

  /** Índice do eixo horizontal do thumbstick esquerdo (Meta Quest / padrão WebXR). */
  private static readonly THUMBSTICK_AXIS_X = 2;

  /** Índice do botão B (mão direita) / Y (mão esquerda) que reposiciona o menu. */
  private static readonly MENU_BUTTON_INDEX = 5;

  public constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    transformControls: TransformControls,
    store?: MoleculeStore,
    vrMenu?: VRMenu,
    slotCount = 2,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.transformControls = transformControls;
    this.store = store;
    this.vrMenu = vrMenu;

    for (let i = 0; i < slotCount; i += 1) {
      const targetRay = this.renderer.xr.getController(i);

      targetRay.addEventListener("connected", this.handleConnected);
      targetRay.addEventListener("disconnected", this.handleDisconnected);
      targetRay.addEventListener("selectstart", this.handleSelectStart);
      targetRay.addEventListener("selectend", this.handleSelectEnd);
      targetRay.addEventListener("squeezestart", this.handleSqueezeStart);

      this.scene.add(targetRay);
      this.targetRaySlots.push(targetRay);
    }
  }

  public update(): void {
    if (!this.renderer.xr.isPresenting || this.controllers.size === 0) {
      return;
    }

    // --- Gamepad / Thumbstick ---
    this.updateGamepad();

    // --- Controlador em interação ativa com TransformControls ---
    if (this.interactingController) {
      const interactingData = this.controllers.get(this.interactingController);
      if (interactingData) {
        this.setLaserState(interactingData, "active");
      }

      for (const [targetRay, data] of this.controllers) {
        if (targetRay !== this.interactingController) {
          this.setLaserState(data, "idle");
        }
      }

      this.interactingController.updateMatrixWorld();
      this.transformControls
        .getRaycaster()
        .setFromXRController(this.interactingController);
      this.transformControls.pointerMove(null);
      return;
    }

    // --- Hover: VRMenu + TransformControls gizmo ---
    let hoveredController: THREE.XRTargetRaySpace | null = null;

    for (const [targetRay, data] of this.controllers) {
      targetRay.updateMatrixWorld();

      // 1. Testar hover sobre o VRMenu
      if (this.vrMenu) {
        this.moleculeRaycaster.setFromXRController(targetRay);
        const hits = this.moleculeRaycaster.intersectObject(this.vrMenu.mesh);
        if (hits.length > 0 && hits[0].uv) {
          this.vrMenu.handlePointerHover(hits[0].uv);
          hoveredController = targetRay;
          this.setLaserState(data, "hover");
          break;
        } else {
          this.vrMenu.handlePointerHover(null);
        }
      }

      // 2. Testar hover sobre o gizmo do TransformControls
      this.transformControls.getRaycaster().setFromXRController(targetRay);
      this.transformControls.pointerHover(null);

      if (this.transformControls.axis !== null) {
        hoveredController = targetRay;
        this.setLaserState(data, "hover");
        break;
      } else {
        this.setLaserState(data, "idle");
      }
    }

    if (!hoveredController) {
      this.transformControls.axis = null;
    }
  }

  /**
   * Lê os gamepads de todos os inputSources ativos na sessão XR.
   * - Thumbstick eixo X: navegar entre moléculas (com debounce por flick)
   * - Botão B/Y (índice 5): reposicionar o VRMenu em frente ao usuário
   */
  private updateGamepad(): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    const xrCamera = this.renderer.xr.getCamera();

    for (const inputSource of session.inputSources) {
      const gamepad = inputSource.gamepad;
      if (!gamepad) continue;

      const targetRay = this.targetRaySlots[
        inputSource.handedness === "right" ? 1 : 0
      ];
      const data = this.controllers.get(targetRay);

      // Thumbstick eixo X — navegar entre moléculas
      const axisX = gamepad.axes[XRControllerManager.THUMBSTICK_AXIS_X] ?? 0;
      const deadzone = XRControllerManager.THUMBSTICK_DEADZONE;

      if (data) {
        if (Math.abs(axisX) > deadzone && !data.thumbstickFired) {
          data.thumbstickFired = true;
          if (axisX > 0) {
            this.store?.selectNextMolecule();
          } else {
            this.store?.selectPreviousMolecule();
          }
        } else if (Math.abs(axisX) <= deadzone) {
          data.thumbstickFired = false;
        }
      }

      // Botão B/Y — reposicionar o VRMenu em frente ao headset
      const menuButton = gamepad.buttons[XRControllerManager.MENU_BUTTON_INDEX];
      if (menuButton?.pressed) {
        this.vrMenu?.repositionInFront(xrCamera);
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
      laserState: "idle",
      thumbstickFired: false,
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
    const controllerData = this.controllers.get(targetRay);
    if (!controllerData) return;

    if (this.interactingController) return;

    targetRay.updateMatrixWorld();

    // 1. Testar clique no VRMenu (prioridade máxima)
    if (this.vrMenu) {
      this.moleculeRaycaster.setFromXRController(targetRay);
      const hits = this.moleculeRaycaster.intersectObject(this.vrMenu.mesh);
      if (hits.length > 0 && hits[0].uv) {
        const consumed = this.vrMenu.handlePointerClick(hits[0].uv);
        if (consumed) return;
      }
    }

    // 2. Testar clique no gizmo do TransformControls
    this.transformControls.getRaycaster().setFromXRController(targetRay);
    this.transformControls.pointerHover(null);

    if (this.transformControls.axis !== null) {
      this.interactingController = targetRay;
      this.transformControls.pointerDown(null);
      this.setLaserState(controllerData, "active");
      return;
    }

    // 3. Testar clique em molécula
    if (this.store) {
      this.raycastAndSelectMolecule(targetRay);
    }
  };

  private handleSelectEnd = (event: THREE.Event) => {
    const targetRay = event.target as THREE.XRTargetRaySpace;

    if (this.interactingController === targetRay) {
      this.transformControls.pointerUp(null);
      this.interactingController = null;

      const data = this.controllers.get(targetRay);
      if (data) {
        this.setLaserState(data, "idle");
      }
    }
  };

  private handleSqueezeStart = () => {
    this.store?.toggleTransformMode();
  };

  private raycastAndSelectMolecule(targetRay: THREE.XRTargetRaySpace): void {
    if (!this.store) return;

    targetRay.updateMatrixWorld();
    this.moleculeRaycaster.setFromXRController(targetRay);
    const records = this.store.getAllRecords();

    let closestRecord: { id: string; distance: number } | null = null;

    for (const record of records) {
      const intersects = this.moleculeRaycaster.intersectObject(
        record.baseObject,
        true,
      );
      if (intersects.length > 0) {
        const dist = intersects[0].distance;
        if (!closestRecord || dist < closestRecord.distance) {
          closestRecord = { id: record.id, distance: dist };
        }
      }
    }

    if (closestRecord) {
      this.store.selectMolecule(closestRecord.id);
    }
  }

  private static readonly LASER_COLORS: Record<
    LaserState,
    readonly number[]
  > = {
    idle: [0.2, 0.6, 1.0, 0.05, 0.2, 0.8],
    hover: [1.0, 0.7, 0.2, 0.9, 0.4, 0.05],
    active: [0.2, 1.0, 0.4, 0.1, 0.8, 0.2],
  };

  private setLaserState(data: XRControllerData, state: LaserState): void {
    if (data.laserState === state) return;
    data.laserState = state;

    const colorAttr = data.rayLine.geometry.getAttribute(
      "color",
    ) as THREE.BufferAttribute;
    if (!colorAttr) return;

    colorAttr.set(XRControllerManager.LASER_COLORS[state]);
    colorAttr.needsUpdate = true;
  }

  private createRayLine(): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -3], 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(
        XRControllerManager.LASER_COLORS.idle,
        3,
      ),
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
      targetRay.removeEventListener("squeezestart", this.handleSqueezeStart);

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
