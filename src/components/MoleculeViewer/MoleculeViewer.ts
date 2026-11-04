import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { XRControllerManager } from "../../core/XRControllerManager";
import type { MoleculeRecord } from "../../domain/types/molecule";
import type { IMoleculeParser } from "../../domain/IMoleculeParser";
import { PDBParser } from "../../core/parsers/PDBParser";
import type { IMoleculeBuilder } from "../../domain/IMoleculeBuilder";
import { BallAndStickBuilder } from "../../core/builders/BallAndStickBuilder";
import { MoleculeStore, type TransformMode } from "../../state/MoleculeStore";
import { VRMenu } from "../../core/VRMenu";

export type { TransformMode } from "../../state/MoleculeStore";
export { MoleculeStore } from "../../state/MoleculeStore";

export class MoleculeViewer {
  // Repositório de estado reativo de moléculas;
  public readonly store: MoleculeStore;

  // Painel de interface 3D imersivo para sessões VR;
  public readonly vrMenu: VRMenu;

  // Espaço 3D;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  private readonly arScaleFactor = 0.08;
  private readonly arDistance = 1.5;

  // Controles de câmera e transformação;
  private readonly controls: OrbitControls;
  private readonly transformControls: TransformControls;

  // HTML;
  private readonly container: HTMLElement;
  private moleculeSequence = 0;

  // Controle do VR;
  private readonly xrControllerManager: XRControllerManager;
  private isApplyingPresentation = false;

  // Parser e construtor;
  private parser: IMoleculeParser = new PDBParser();
  private builder: IMoleculeBuilder = new BallAndStickBuilder();

  public constructor(container: HTMLElement) {
    this.container = container;
    this.store = new MoleculeStore();

    // Configuração da cena;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050816);

    // Luz;
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);

    this.scene.add(directionalLight);
    this.scene.add(ambientLight);

    // Câmera;
    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      1000,
    );
    this.camera.position.z = 2;
    this.camera.position.y = 1;

    // Renderizador - Objeto do DOM para renderizar a cena;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // Controles de câmera;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // Controles de transformação;
    this.transformControls = new TransformControls(
      this.camera,
      this.renderer.domElement,
    );
    this.transformControls.setMode(this.store.getTransformMode());
    this.transformControls.setSpace("world");
    this.transformControls.setSize(0.9);
    this.transformControls.addEventListener("dragging-changed", (event) => {
      this.controls.enabled = !event.value;
    });
    this.transformControls.addEventListener(
      "objectChange",
      this.handleTransformObjectChange,
    );
    this.scene.add(this.transformControls.getHelper());

    // Reagir a eventos do repositório de moléculas;
    this.store.addEventListener("molecule-selected", () => {
      this.syncTransformControlsTarget();
      if (this.isARSession()) {
        this.applyARPresentation();
      }
    });

    this.store.addEventListener("molecule-removed", (event) => {
      const { record } = event.detail;
      this.scene.remove(record.object);
      this.disposeObject3D(record.object);
    });

    this.store.addEventListener("transform-mode-changed", (event) => {
      const { mode } = event.detail;
      this.transformControls.setMode(mode);
      this.transformControls.setSpace(mode === "rotate" ? "local" : "world");
    });

    this.store.addEventListener("global-scale-changed", (event) => {
      this.applyGlobalScale(event.detail.scale);
    });

    // Menu 3D e configurações para WebXR;
    this.vrMenu = new VRMenu(
      this.store,
      () => {
        void this.exitXR();
      },
      () => {
        this.centerSelectedMolecule();
      },
    );

    this.xrControllerManager = new XRControllerManager(
      this.renderer,
      this.scene,
      this.transformControls,
      this.store,
      this.vrMenu,
    );
    this.renderer.xr.addEventListener(
      "sessionstart",
      this.handleXRSessionStart,
    );
    this.renderer.xr.addEventListener("sessionend", this.handleXRSessionEnd);

    // Grid para facilitar a localização;
    const size = 10;
    const divisions = 10;
    const gridHelper = new THREE.GridHelper(size, divisions);
    this.scene.add(gridHelper);

    // Eventos e loop de renderização;
    window.addEventListener("resize", this.handleResize);
    this.renderer.setAnimationLoop(this.renderLoop);
  }

  public getContainer(): HTMLElement {
    return this.container;
  }

  public getMolecules() {
    return this.store.getMolecules();
  }

  public getSelectedMoleculeId() {
    return this.store.getSelectedMoleculeId();
  }

  public getSelectedMoleculeName() {
    return this.store.getSelectedMoleculeName();
  }

  public selectMolecule(id: string) {
    this.store.selectMolecule(id);
  }

  public removeMolecule(id: string): boolean {
    return this.store.removeMolecule(id) !== null;
  }

  public moveSelected(
    delta: THREE.Vector3 | { x: number; y: number; z: number },
  ) {
    const molecule = this.getCurrentMolecule();
    if (!molecule) return;

    molecule.object.position.x += delta.x;
    molecule.object.position.y += delta.y;
    molecule.object.position.z += delta.z;
    molecule.position.copy(molecule.object.position);
    molecule.quaternion.copy(molecule.object.quaternion);
  }

  public setTransformMode(mode: TransformMode) {
    this.store.setTransformMode(mode);
  }

  public getTransformMode() {
    return this.store.getTransformMode();
  }

  public getGlobalScale(): number {
    return this.store.getGlobalScale();
  }

  public setGlobalScale(scale: number): void {
    this.store.setGlobalScale(scale);
  }

  public adjustGlobalScale(delta: number): void {
    this.store.adjustGlobalScale(delta);
  }

  public resetGlobalScale(): void {
    this.store.resetGlobalScale();
  }

  private handleResize = () => {
    const width = this.container.clientWidth;
    const height = Math.max(this.container.clientHeight, 1);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };

  private renderLoop = () => {
    this.controls.update();
    this.xrControllerManager.update();
    this.renderer.render(this.scene, this.camera);
  };

  private handleTransformObjectChange = () => {
    if (this.isApplyingPresentation || this.isARSession()) return;

    const molecule = this.getCurrentMolecule();
    if (!molecule) return;

    molecule.position.copy(molecule.object.position);
    molecule.quaternion.copy(molecule.object.quaternion);
    molecule.scale.copy(molecule.object.scale);
  };

  private handleXRSessionStart = () => {
    this.transformControls.camera = this.renderer.xr.getCamera();
    this.controls.enabled = false;
    this.scene.add(this.vrMenu.group);
    this.vrMenu.repositionInFront(this.renderer.xr.getCamera());
    if (!this.isARSession()) return;
    this.applyARPresentation();
  };

  private handleXRSessionEnd = () => {
    this.transformControls.camera = this.camera;
    this.controls.enabled = true;
    this.scene.remove(this.vrMenu.group);
    this.resetMoleculePresentation();
  };

  public async exitXR(): Promise<void> {
    const session = this.renderer.xr.getSession();
    if (session) {
      await session.end();
    }
  }

  public centerSelectedMolecule(): void {
    const record = this.getCurrentMolecule();
    if (!record) return;

    if (this.renderer.xr.isPresenting) {
      const xrCamera = this.renderer.xr.getCamera();
      const forward = new THREE.Vector3(0, 0, -1.2);
      forward.applyQuaternion(xrCamera.quaternion);
      record.object.position.copy(xrCamera.position).add(forward);
      record.object.quaternion.identity();
    } else {
      record.object.position.set(0, 0, 0);
      record.object.quaternion.identity();
    }

    record.position.copy(record.object.position);
    record.quaternion.copy(record.object.quaternion);
  }

  // Habilita WebXR em modo VR e retorna o botão, se o navegador suportar;
  public async enableXR(): Promise<HTMLElement | null> {
    const supported = await navigator.xr?.isSessionSupported("immersive-vr");
    if (!supported) return null;

    this.renderer.xr.enabled = true;
    // VRButton.createButton retorna um HTMLElement
    const button = VRButton.createButton(this.renderer);
    button.classList.add("xr-button", "xr-button--vr");
    return button;
  }

  // Habilita WebXR em modo AR e retorna o botão, se o navegador suportar;
  public async enableAR(): Promise<HTMLElement | null> {
    const supported = await navigator.xr?.isSessionSupported("immersive-ar");
    if (!supported) return null;

    this.renderer.xr.enabled = true;
    const button = ARButton.createButton(this.renderer);
    button.classList.add("xr-button", "xr-button--ar");
    return button;
  }

  private addMoleculeObject(object: THREE.Object3D, name: string) {
    const id = `molecule-${++this.moleculeSequence}`;
    const outlineColor = this.getOutlineColorForMolecule(this.moleculeSequence);
    const outlineObject = this.createOutlineObject(object, outlineColor);
    const wrapper = new THREE.Group();

    wrapper.name = `molecule-wrapper-${name}`;
    wrapper.userData.defaultPosition = new THREE.Vector3(0, 0, 0);
    wrapper.userData.defaultQuaternion = new THREE.Vector3(1, 1, 1);

    outlineObject.renderOrder = 0;
    object.renderOrder = 1;
    wrapper.add(outlineObject);
    wrapper.add(object);

    const currentScale = this.store.getGlobalScale();
    if (this.isARSession()) {
      wrapper.scale.setScalar(currentScale * this.arScaleFactor);
    } else {
      wrapper.scale.setScalar(currentScale);
    }

    const molecule: MoleculeRecord = {
      id,
      name,
      object: wrapper,
      baseObject: object,
      outlineObject,
      position: wrapper.position.clone(),
      quaternion: wrapper.quaternion.clone(),
      scale: new THREE.Vector3(1, 1, 1),
      outlineColor,
    };

    this.scene.add(wrapper);
    this.store.addMolecule(molecule);

    return { id, name };
  }

  private createOutlineObject(object: THREE.Object3D, outlineColor: number) {
    const outline = object.clone(true);
    const outlineMaterial = this.createOutlineMaterial(outlineColor);

    outline.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      mesh.material = outlineMaterial;
    });

    outline.renderOrder = 0;
    return outline;
  }

  private createOutlineMaterial(outlineColor: number, thickness = 0.04) {
    const material = new THREE.MeshBasicMaterial({
      color: outlineColor,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.outlineThickness = { value: thickness };

      shader.vertexShader = `uniform float outlineThickness;\n${shader.vertexShader}`;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
          transformed += normalize(normal) * outlineThickness;`,
      );
    };

    material.customProgramCacheKey = () =>
      `outline-${outlineColor}-${thickness}`;
    return material;
  }

  private getOutlineColorForMolecule(index: number) {
    const hue = (index * 137.508) % 360;
    const color = new THREE.Color(`hsl(${hue}, 85%, 55%)`);
    return color.getHex();
  }

  private getCurrentMolecule() {
    return this.store.getSelectedRecord();
  }

  private isARSession() {
    const session = this.renderer.xr.getSession();
    return session?.environmentBlendMode !== "opaque";
  }

  public dispose() {
    window.removeEventListener("resize", this.handleResize);
    this.vrMenu.dispose();
    this.xrControllerManager.dispose();
    this.controls.dispose();
    this.transformControls.dispose();
    this.renderer.dispose();
  }

  private syncTransformControlsTarget() {
    const current = this.getCurrentMolecule();
    if (!current) {
      this.transformControls.detach();
      return;
    }

    this.transformControls.attach(current.object);
  }

  private applyGlobalScale(scale: number): void {
    if (this.store.size === 0) return;

    this.isApplyingPresentation = true;
    const isAR = this.isARSession();
    const effectiveScale = isAR ? scale * this.arScaleFactor : scale;

    for (const molecule of this.store.getAllRecords()) {
      molecule.object.scale
        .copy(molecule.scale)
        .multiplyScalar(effectiveScale);
    }

    this.isApplyingPresentation = false;
  }

  private applyARPresentation() {
    if (this.store.size === 0) return;

    this.isApplyingPresentation = true;
    const arCenterOffset = new THREE.Vector3(0, 0, -this.arDistance);
    const effectiveScale = this.store.getGlobalScale() * this.arScaleFactor;

    for (const molecule of this.store.getAllRecords()) {
      molecule.object.scale
        .copy(molecule.scale)
        .multiplyScalar(effectiveScale);

      molecule.object.position
        .copy(molecule.position)
        .multiplyScalar(this.arScaleFactor)
        .add(arCenterOffset);

      molecule.object.quaternion.copy(molecule.quaternion);
    }

    this.isApplyingPresentation = false;
  }

  private resetMoleculePresentation() {
    if (this.store.size === 0) return;

    this.isApplyingPresentation = true;
    const effectiveScale = this.store.getGlobalScale();

    for (const molecule of this.store.getAllRecords()) {
      molecule.object.scale
        .copy(molecule.scale)
        .multiplyScalar(effectiveScale);
      molecule.object.position
        .copy(molecule.position)
        .multiplyScalar(this.arScaleFactor)
        .add(new THREE.Vector3(0, 0, -this.arDistance));
      molecule.object.quaternion.copy(molecule.quaternion);
    }

    this.isApplyingPresentation = false;
  }

  private disposeObject3D(object: THREE.Object3D) {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }

      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else if (material) {
        material.dispose();
      }
    });
  }

  public async loadMoleculeFromUrl(
    url: string,
    name?: string,
  ): Promise<{ id: string; name: string }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Falha ao baixar arquivo: ${response.statusText}`);
    }
    const content = await response.text();
    const resolvedName = name ?? this.getNameFromSource(url);
    return this.addMoleculeFromContent(content, resolvedName);
  }

  public async loadMoleculeFromFile(
    file: File,
  ): Promise<{ id: string; name: string }> {
    const content = await file.text();
    return this.addMoleculeFromContent(content, file.name);
  }

  // Content é simplesmente uma String;
  public addMoleculeFromContent(
    content: string,
    name: string,
  ): { id: string; name: string } {
    const moleculeData = this.parser.parse(content, name);
    const moleculeGroup = this.builder.build(moleculeData);
    return this.addMoleculeObject(moleculeGroup, name);
  }

  private getNameFromSource(source: string) {
    try {
      const url = new URL(source, window.location.href);
      const fileName = url.pathname.split("/").filter(Boolean).at(-1);
      return fileName ?? `Molécula ${this.moleculeSequence + 1}`;
    } catch {
      return `Molécula ${this.moleculeSequence + 1}`;
    }
  }
}
