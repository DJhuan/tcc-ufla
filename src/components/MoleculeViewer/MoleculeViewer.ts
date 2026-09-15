import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { PDBLoader } from "three/addons/loaders/PDBLoader.js";
import { ELEMENT_COLORS, ELEMENT_RADII } from "./Constants";
import { XRControllerManager } from "../../core/XRControllerManager";
import type { PDBStructure } from "../../types/pdb";

export type TransformMode = "translate" | "rotate";

type AtomPosition = {
  pos: THREE.Vector3;
  element?: string | null;
};

type MoleculeRecord = {
  id: string;
  name: string;
  object: THREE.Group;
  baseObject: THREE.Object3D;
  outlineObject: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  outlineColor: number;
};

export class MoleculeViewer {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;

  private readonly controls: OrbitControls;
  private readonly transformControls: TransformControls;
  private readonly container: HTMLElement;
  private readonly molecules = new Map<string, MoleculeRecord>();
  private currentMoleculeId: string | null = null;
  private moleculeSequence = 0;
  private readonly loader = new PDBLoader();
  private readonly arScaleFactor = 0.08;
  private readonly arDistance = 1.5;
  private transformMode: TransformMode = "translate";
  private isApplyingPresentation = false;

  private readonly xrControllerManager: XRControllerManager;

  public constructor(container: HTMLElement) {
    this.container = container;

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
    this.transformControls.setMode(this.transformMode);
    this.transformControls.setSpace("world");
    this.transformControls.setSize(0.9);
    this.transformControls.addEventListener(
      "dragging-changed",
      (event) => {
        this.controls.enabled = !event.value;
      },
    );
    this.transformControls.addEventListener(
      "objectChange",
      this.handleTransformObjectChange,
    );
    this.scene.add(this.transformControls.getHelper());

    // Configurações para WebXR;
    this.xrControllerManager = new XRControllerManager(
      this.renderer,
      this.scene,
      this.transformControls,
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

  public async loadFromUrl(
    url: string,
    name?: string,
  ): Promise<{ id: string; name: string }> {
    const molecule = await this.createMoleculeFromPdb(url);
    return this.addMoleculeObject(
      molecule,
      name ?? this.getNameFromSource(url),
    );
  }

  public async loadFromFile(file: File): Promise<{ id: string; name: string }> {
    const url = URL.createObjectURL(file);

    try {
      return await this.loadFromUrl(url, file.name);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  public getContainer(): HTMLElement {
    return this.container;
  }

  public getMolecules() {
    return Array.from(this.molecules.values()).map((molecule) => ({
      id: molecule.id,
      name: molecule.name,
      selected: molecule.id === this.currentMoleculeId,
    }));
  }

  public getSelectedMoleculeId() {
    return this.currentMoleculeId;
  }

  public getSelectedMoleculeName() {
    const selected = this.currentMoleculeId
      ? this.molecules.get(this.currentMoleculeId)
      : null;
    return selected?.name ?? null;
  }

  public selectMolecule(id: string) {
    const molecule = this.molecules.get(id);
    if (!molecule) return;

    if (this.currentMoleculeId === id) return;

    this.currentMoleculeId = id;
    this.syncTransformControlsTarget();
  }

  public removeMolecule(id: string) {
    const molecule = this.molecules.get(id);
    if (!molecule) return false;

    this.scene.remove(molecule.object);
    this.disposeObject3D(molecule.object);
    this.molecules.delete(id);

    if (this.currentMoleculeId === id) {
      const next = Array.from(this.molecules.keys()).at(-1) ?? null;
      this.currentMoleculeId = next;
      this.syncTransformControlsTarget();
      if (this.isARSession()) {
        this.applyARPresentation();
      }
    }

    return true;
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
    this.transformMode = mode;
    this.transformControls.setMode(mode);
    this.transformControls.setSpace(mode === "rotate" ? "local" : "world");
  }

  public getTransformMode() {
    return this.transformMode;
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
    if (!this.isARSession()) return;
    this.applyARPresentation();
  };

  private handleXRSessionEnd = () => {
    this.resetMoleculePresentation();
  };

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

    wrapper.name = `MoleculeWrapper-${id}`;
    wrapper.userData.defaultPosition = new THREE.Vector3(0, 0, 0);
    wrapper.userData.defaultScale = new THREE.Vector3(1, 1, 1);

    outlineObject.renderOrder = 0;
    object.renderOrder = 1;
    wrapper.add(outlineObject);
    wrapper.add(object);

    this.molecules.set(id, {
      id,
      name,
      object: wrapper,
      baseObject: object,
      outlineObject,
      position: wrapper.position.clone(),
      quaternion: wrapper.quaternion.clone(),
      scale: wrapper.scale.clone(),
      outlineColor,
    });

    this.scene.add(wrapper);
    this.currentMoleculeId = id;
    this.syncTransformControlsTarget();
    if (this.isARSession()) {
      this.applyARPresentation();
    }

    return { id, name };
  }

  private getCurrentMolecule() {
    if (!this.currentMoleculeId) return null;
    return this.molecules.get(this.currentMoleculeId) ?? null;
  }

  private isARSession() {
    const session = this.renderer.xr.getSession();
    return session?.environmentBlendMode !== "opaque";
  }

  public dispose() {
    window.removeEventListener("resize", this.handleResize);
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

  private applyARPresentation() {
    if (this.molecules.size === 0) return;

    this.isApplyingPresentation = true;
    const arCenterOffset = new THREE.Vector3(0, 0, -this.arDistance);

    for (const molecule of this.molecules.values()) {
      molecule.object.scale
        .copy(molecule.scale)
        .multiplyScalar(this.arScaleFactor);

      molecule.object.position
        .copy(molecule.position)
        .multiplyScalar(this.arScaleFactor)
        .add(arCenterOffset);

      molecule.object.quaternion.copy(molecule.quaternion);
    }

    this.isApplyingPresentation = false;
  }

  private resetMoleculePresentation() {
    if (this.molecules.size === 0) return;

    this.isApplyingPresentation = true;

    for (const molecule of this.molecules.values()) {
      molecule.object.scale.copy(molecule.scale);
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

  private createOutlineObject(object: THREE.Object3D, outlineColor: number) {
    const outline = object.clone(true);
    const outlineMaterial = this.createOutlineMaterial(outlineColor);

    outline.traverse((child) => {
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

  private async createMoleculeFromPdb(filepath: string) {
    const pdb = (await this.loader.loadAsync(filepath)) as unknown as PDBStructure;
    const geometryAtoms = pdb.geometryAtoms;
    const geometryBonds = pdb.geometryBonds;
    const positions = geometryAtoms.attributes.position.array as Float32Array;
    const atomsData = pdb.json?.atoms ?? null;

    const atoms: AtomPosition[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const idx = i / 3;
      const pos = new THREE.Vector3(
        positions[i],
        positions[i + 1],
        positions[i + 2],
      );
      const atom = atomsData?.[idx];
      const element = atom?.[4] ?? null;

      atoms.push({ pos, element });
    }

    const center = new THREE.Vector3();
    atoms.forEach((atom) => center.add(atom.pos));
    center.divideScalar(atoms.length || 1);
    atoms.forEach((atom) => atom.pos.sub(center));

    const group = new THREE.Group();
    group.name = "Molecule";

    const atomsByElement = new Map<
      string,
      { color: number; radius: number; positions: THREE.Vector3[] }
    >();

    atoms.forEach((atom) => {
      const key = (atom.element || "X").toUpperCase();
      if (!atomsByElement.has(key)) {
        atomsByElement.set(key, {
          color: this.getElementColor(atom.element),
          radius: this.getElementRadius(atom.element),
          positions: [],
        });
      }

      atomsByElement.get(key)!.positions.push(atom.pos);
    });

    atomsByElement.forEach((bucket) => {
      const count = bucket.positions.length;
      if (count === 0) return;

      const sphereGeometry = new THREE.SphereGeometry(1, 16, 12);
      const material = new THREE.MeshStandardMaterial({
        color: bucket.color,
        metalness: 0.1,
        roughness: 0.8,
      });
      const mesh = new THREE.InstancedMesh(sphereGeometry, material, count);
      const dummy = new THREE.Object3D();

      for (let i = 0; i < count; i++) {
        dummy.position.copy(bucket.positions[i]);
        dummy.scale.setScalar(bucket.radius);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    });

    const bonds = this.collectBonds(pdb, atoms, geometryBonds, center);
    if (bonds.length > 0) {
      const bondGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
      const bondMaterial = new THREE.MeshStandardMaterial({
        color: 0x999999,
        metalness: 0.1,
        roughness: 0.8,
      });
      const bondMesh = new THREE.InstancedMesh(
        bondGeometry,
        bondMaterial,
        bonds.length,
      );
      const dummy = new THREE.Object3D();

      for (let i = 0; i < bonds.length; i++) {
        const [start, end] = bonds[i];
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        const midpoint = new THREE.Vector3()
          .addVectors(start, end)
          .multiplyScalar(0.5);

        dummy.position.copy(midpoint);
        dummy.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.clone().normalize(),
        );
        dummy.scale.set(0.12, length, 0.12);
        dummy.updateMatrix();
        bondMesh.setMatrixAt(i, dummy.matrix);
      }

      bondMesh.instanceMatrix.needsUpdate = true;
      group.add(bondMesh);
    }

    return group;
  }

  private collectBonds(
    pdb: PDBStructure,
    atoms: AtomPosition[],
    geometryBonds: THREE.BufferGeometry,
    center: THREE.Vector3,
  ) {
    const bonds: Array<[THREE.Vector3, THREE.Vector3]> = [];
    const bondsData = pdb.json?.bonds ?? null;

    if (bondsData && Array.isArray(bondsData)) {
      for (let bi=0; bi < bondsData.length; bi++) {
        const [i, j] = [bondsData[bi][0], bondsData[bi][1]];
        if (i == null || j == null) continue;

        const start = atoms[i]?.pos;
        const end = atoms[j]?.pos;
        if (!start || !end) continue;
        bonds.push([start.clone(), end.clone()]);
      }

      return bonds;
    }

    if (geometryBonds.attributes?.position) {
      const bondPositions = geometryBonds.attributes.position
        .array as Float32Array;
      for (let i = 0; i < bondPositions.length; i += 6) {
        const start = new THREE.Vector3(
          bondPositions[i],
          bondPositions[i + 1],
          bondPositions[i + 2],
        ).sub(center);
        const end = new THREE.Vector3(
          bondPositions[i + 3],
          bondPositions[i + 4],
          bondPositions[i + 5],
        ).sub(center);
        bonds.push([start, end]);
      }
    }

    return bonds;
  }

  private getElementColor(element: string | null | undefined) {
    if (!element) return 0xffffff;
    const key = element.toUpperCase();
    return ELEMENT_COLORS[key] ?? 0xffffff;
  }

  private getElementRadius(element: string | null | undefined) {
    if (!element) return 0.45;
    const key = element.toUpperCase();
    return ELEMENT_RADII[key] ?? 0.45;
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
