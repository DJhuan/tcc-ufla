import * as THREE from "three";
import { MoleculeStore } from "../state/MoleculeStore";

export type VRMenuButtonId =
  | "prev"
  | "next"
  | "mode"
  | "center"
  | "scale-down"
  | "scale-reset"
  | "scale-up"
  | "exit";

type ButtonBounds = {
  id: VRMenuButtonId;
  x: number;
  y: number;
  w: number;
  h: number;
};

export class VRMenu {
  public readonly group: THREE.Group;
  public readonly mesh: THREE.Mesh;

  private readonly store: MoleculeStore;
  private readonly onExitVR: () => void;
  private readonly onCenterMolecule: () => void;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;

  private hoveredButtonId: VRMenuButtonId | null = null;
  private clickedButtonId: VRMenuButtonId | null = null;
  private clickTimeoutId: number | null = null;

  private static readonly BUTTONS: ButtonBounds[] = [
    { id: "prev", x: 20, y: 95, w: 75, h: 58 },
    { id: "next", x: 417, y: 95, w: 75, h: 58 },
    { id: "mode", x: 20, y: 175, w: 230, h: 62 },
    { id: "center", x: 262, y: 175, w: 230, h: 62 },
    { id: "scale-down", x: 20, y: 255, w: 85, h: 58 },
    { id: "scale-reset", x: 115, y: 255, w: 282, h: 58 },
    { id: "scale-up", x: 407, y: 255, w: 85, h: 58 },
    { id: "exit", x: 20, y: 335, w: 472, h: 64 },
  ];

  public constructor(
    store: MoleculeStore,
    onExitVR: () => void,
    onCenterMolecule: () => void,
  ) {
    this.store = store;
    this.onExitVR = onExitVR;
    this.onCenterMolecule = onCenterMolecule;

    this.canvas = document.createElement("canvas");
    this.canvas.width = 512;
    this.canvas.height = 420;
    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("Não foi possível inicializar Canvas2D para o VRMenu.");
    }
    this.ctx = context;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const geometry = new THREE.PlaneGeometry(0.55, 0.45);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = "VRMenuPanel";

    this.group = new THREE.Group();
    this.group.name = "VRMenuGroup";
    this.group.add(this.mesh);

    // Posicionamento inicial padrão (à esquerda do usuário, angulado)
    this.group.position.set(-0.6, 1.25, -1.1);
    this.group.rotation.set(0, 0.35, 0);

    // Ouvir mudanças no repositório de moléculas para se auto-redesenhar
    this.store.addEventListener("molecule-selected", this.handleStoreChange);
    this.store.addEventListener("molecule-added", this.handleStoreChange);
    this.store.addEventListener("molecule-removed", this.handleStoreChange);
    this.store.addEventListener("transform-mode-changed", this.handleStoreChange);
    this.store.addEventListener("global-scale-changed", this.handleStoreChange);

    this.renderCanvas();
  }

  private handleStoreChange = () => {
    this.renderCanvas();
  };

  /**
   * Avalia a posição UV do raio laser sobre a face do painel
   * e atualiza o destaque de hover dos botões.
   */
  public handlePointerHover(uv: THREE.Vector2 | null): VRMenuButtonId | null {
    if (!uv) {
      if (this.hoveredButtonId !== null) {
        this.hoveredButtonId = null;
        this.renderCanvas();
      }
      return null;
    }

    const canvasX = uv.x * this.canvas.width;
    const canvasY = (1 - uv.y) * this.canvas.height;

    const hitButton = VRMenu.BUTTONS.find(
      (b) =>
        canvasX >= b.x &&
        canvasX <= b.x + b.w &&
        canvasY >= b.y &&
        canvasY <= b.y + b.h,
    );

    const newHover = hitButton ? hitButton.id : null;
    if (newHover !== this.hoveredButtonId) {
      this.hoveredButtonId = newHover;
      this.renderCanvas();
    }

    return this.hoveredButtonId;
  }

  /**
   * Dispara a ação associada ao botão clicado via raio laser.
   */
  public handlePointerClick(uv: THREE.Vector2): boolean {
    const canvasX = uv.x * this.canvas.width;
    const canvasY = (1 - uv.y) * this.canvas.height;

    const hitButton = VRMenu.BUTTONS.find(
      (b) =>
        canvasX >= b.x &&
        canvasX <= b.x + b.w &&
        canvasY >= b.y &&
        canvasY <= b.y + b.h,
    );

    if (!hitButton) {
      return false;
    }

    // Feedback visual imediato de clique
    this.clickedButtonId = hitButton.id;
    this.renderCanvas();
    if (this.clickTimeoutId) window.clearTimeout(this.clickTimeoutId);
    this.clickTimeoutId = window.setTimeout(() => {
      this.clickedButtonId = null;
      this.renderCanvas();
    }, 180);

    // Executa a ação
    switch (hitButton.id) {
      case "prev":
        this.store.selectPreviousMolecule();
        break;
      case "next":
        this.store.selectNextMolecule();
        break;
      case "mode":
        this.store.toggleTransformMode();
        break;
      case "center":
        this.onCenterMolecule();
        break;
      case "scale-down":
        this.store.adjustGlobalScale(-0.1);
        break;
      case "scale-reset":
        this.store.resetGlobalScale();
        break;
      case "scale-up":
        this.store.adjustGlobalScale(0.1);
        break;
      case "exit":
        this.onExitVR();
        break;
    }

    return true;
  }

  /**
   * Reposiciona o painel flutuante a 1.1m diretamente em frente
   * à orientação atual da cabeça do usuário.
   */
  public repositionInFront(camera: THREE.Camera): void {
    const forward = new THREE.Vector3(0, 0, -1.1);
    forward.applyQuaternion(camera.quaternion);

    this.group.position.copy(camera.position).add(forward);
    this.group.quaternion.copy(camera.quaternion);
  }

  private renderCanvas(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Fundo de vidro translúcido escuro
    this.drawRoundedRect(ctx, 4, 4, w - 8, h - 8, 20);
    ctx.fillStyle = "rgba(10, 16, 36, 0.92)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(77, 166, 255, 0.4)";
    ctx.stroke();

    // 2. Cabeçalho
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillStyle = "#4da6ff";
    ctx.fillText("PROTVR", 24, 38);

    ctx.font = "14px system-ui, sans-serif";
    ctx.fillStyle = "#8ba3c7";
    ctx.fillText("PAINEL IMERSIVO", 130, 39);

    // Linha divisória
    ctx.strokeStyle = "rgba(77, 166, 255, 0.18)";
    ctx.beginPath();
    ctx.moveTo(20, 68);
    ctx.lineTo(w - 20, 68);
    ctx.stroke();

    // 3. Seletor de Molécula
    const molecules = this.store.getMolecules();
    const currentName = this.store.getSelectedMoleculeName() ?? "Nenhuma";
    const currentIndex = molecules.findIndex((m) => m.selected);
    const countText =
      molecules.length > 0
        ? `${currentName} (${currentIndex >= 0 ? currentIndex + 1 : 0}/${molecules.length})`
        : "Nenhuma molécula";

    // Botão Anterior
    this.drawButton(
      ctx,
      20,
      95,
      75,
      58,
      "◀",
      this.hoveredButtonId === "prev",
      this.clickedButtonId === "prev",
      molecules.length <= 1,
    );

    // Caixa de Nome Central
    this.drawRoundedRect(ctx, 105, 95, 302, 58, 10);
    ctx.fillStyle = "rgba(18, 28, 58, 0.85)";
    ctx.fill();
    ctx.strokeStyle = "rgba(77, 166, 255, 0.25)";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    const truncatedName =
      countText.length > 28 ? countText.slice(0, 26) + "..." : countText;
    ctx.fillText(truncatedName, 256, 124);

    // Botão Próxima
    this.drawButton(
      ctx,
      417,
      95,
      75,
      58,
      "▶",
      this.hoveredButtonId === "next",
      this.clickedButtonId === "next",
      molecules.length <= 1,
    );

    // 4. Controles de Transformação
    const mode = this.store.getTransformMode();
    const modeLabel =
      mode === "translate" ? "✥ Modo: Mover" : "⟳ Modo: Girar";

    this.drawButton(
      ctx,
      20,
      175,
      230,
      62,
      modeLabel,
      this.hoveredButtonId === "mode",
      this.clickedButtonId === "mode",
      false,
      "#264d8a",
    );

    this.drawButton(
      ctx,
      262,
      175,
      230,
      62,
      "⌖ Centralizar",
      this.hoveredButtonId === "center",
      this.clickedButtonId === "center",
      false,
    );

    // 5. Controles de Escala Global
    const currentScale = this.store.getGlobalScale();
    const scalePercent = Math.round(currentScale * 100);

    this.drawButton(
      ctx,
      20,
      255,
      85,
      58,
      "➖",
      this.hoveredButtonId === "scale-down",
      this.clickedButtonId === "scale-down",
      currentScale <= MoleculeStore.MIN_SCALE,
    );

    this.drawButton(
      ctx,
      115,
      255,
      282,
      58,
      `Escala: ${currentScale.toFixed(1)}x (${scalePercent}%)`,
      this.hoveredButtonId === "scale-reset",
      this.clickedButtonId === "scale-reset",
      false,
      "#1e3a5f",
    );

    this.drawButton(
      ctx,
      407,
      255,
      85,
      58,
      "➕",
      this.hoveredButtonId === "scale-up",
      this.clickedButtonId === "scale-up",
      currentScale >= MoleculeStore.MAX_SCALE,
    );

    // 6. Botão de Saída VR
    this.drawButton(
      ctx,
      20,
      335,
      472,
      64,
      "🚪 Sair da Sessão VR",
      this.hoveredButtonId === "exit",
      this.clickedButtonId === "exit",
      false,
      "#b82e3b",
    );

    this.texture.needsUpdate = true;
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    isHovered: boolean,
    isClicked: boolean,
    isDisabled = false,
    accentColor?: string,
  ): void {
    this.drawRoundedRect(ctx, x, y, w, h, 10);

    if (isDisabled) {
      ctx.fillStyle = "rgba(25, 35, 60, 0.4)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.stroke();

      ctx.fillStyle = "#5c6d88";
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + w / 2, y + h / 2);
      return;
    }

    if (isClicked) {
      ctx.fillStyle = accentColor ?? "rgba(77, 166, 255, 0.7)";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    } else if (isHovered) {
      ctx.fillStyle = accentColor
        ? accentColor
        : "rgba(77, 166, 255, 0.4)";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    } else {
      ctx.fillStyle = accentColor
        ? accentColor + "aa"
        : "rgba(24, 40, 80, 0.75)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = accentColor ?? "rgba(77, 166, 255, 0.35)";
      ctx.stroke();
    }

    ctx.fillStyle = isHovered ? "#ffffff" : "#e6f0ff";
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  public dispose(): void {
    this.store.removeEventListener("molecule-selected", this.handleStoreChange);
    this.store.removeEventListener("molecule-added", this.handleStoreChange);
    this.store.removeEventListener("molecule-removed", this.handleStoreChange);
    this.store.removeEventListener(
      "transform-mode-changed",
      this.handleStoreChange,
    );
    this.store.removeEventListener(
      "global-scale-changed",
      this.handleStoreChange,
    );

    this.mesh.geometry.dispose();
    if (Array.isArray(this.mesh.material)) {
      this.mesh.material.forEach((m) => m.dispose());
    } else {
      this.mesh.material.dispose();
    }
    this.texture.dispose();
  }
}
