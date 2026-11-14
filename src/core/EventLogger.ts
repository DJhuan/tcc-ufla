import type { WebXRManager } from "three";
import type { MoleculeStore } from "../state/MoleculeStore";
import type {
  InteractionObserver,
  LaserState,
  PointerTarget,
} from "./InteractionObserver";
import type { VRMenuButtonId } from "./VRMenu";

/**
 * Estados de interação usados para rotular os quadros do vídeo:
 * E1 ocioso, E2 apontando (gizmo), E3 transladando, E4 rotacionando,
 * E5 usando menu. Prioridade: E5 > E3/E4 > E2 > E1.
 */
export type InteractionState = "E1" | "E2" | "E3" | "E4" | "E5";

export type LogEntry = {
  /** Milissegundos de época (performance.timeOrigin + performance.now()). */
  t: number;
  type: string;
  data: Record<string, unknown>;
};

type LaserSlot = { state: LaserState; target: PointerTarget };

export const LOG_FORMAT = "protvr-log";
export const LOG_FORMAT_VERSION = 1;

export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

/**
 * Registro de eventos de interação (camada core, sem dependência de UI).
 *
 * Registra apenas mudanças: estado do laser por controle, arraste,
 * modo de transformação, seleção/adição de moléculas, botões do VRMenu,
 * início/fim da sessão XR, "sync" (borda de subida do botão B/Y) e o
 * estado derivado E1–E5.
 */
export class EventLogger implements InteractionObserver {
  private readonly store: MoleculeStore;
  private readonly xr: WebXRManager;
  private readonly entries: LogEntry[] = [];
  private readonly startedAt: number;
  private readonly unsubscribers: Array<() => void> = [];

  // Um slot por handedness, pré-alocado (sem alocação ao derivar o estado).
  private readonly lasers: Record<XRHandedness, LaserSlot> = {
    none: { state: "idle", target: null },
    left: { state: "idle", target: null },
    right: { state: "idle", target: null },
  };
  private currentState: InteractionState = "E1";

  /** Chamado após o registro do fim da sessão XR (exportação automática). */
  public onSessionEnd: (() => void) | null = null;

  public constructor(
    store: MoleculeStore,
    xr: WebXRManager,
    meta: Record<string, unknown> = {},
  ) {
    this.store = store;
    this.xr = xr;
    this.startedAt = epochNow();

    this.log("config", {
      ...meta,
      timeOrigin: performance.timeOrigin,
      userAgent: navigator.userAgent,
      url: window.location.href,
    });
    this.log("state", { state: this.currentState });

    this.unsubscribers.push(
      store.on("molecule-added", (event) => {
        this.log("molecule-added", { ...event.detail });
      }),
      store.on("molecule-selected", (event) => {
        this.log("molecule-selected", { ...event.detail });
      }),
      store.on("transform-mode-changed", (event) => {
        this.log("transform-mode-changed", { mode: event.detail.mode });
        this.updateState();
      }),
    );

    xr.addEventListener("sessionstart", this.handleSessionStart);
    xr.addEventListener("sessionend", this.handleSessionEnd);
  }

  public log(type: string, data: Record<string, unknown> = {}): void {
    this.entries.push({ t: epochNow(), type, data });
  }

  public getStartedAt(): number {
    return this.startedAt;
  }

  public getEntryCount(): number {
    return this.entries.length;
  }

  public toJSON(): string {
    return JSON.stringify({
      format: LOG_FORMAT,
      version: LOG_FORMAT_VERSION,
      startedAt: this.startedAt,
      exportedAt: epochNow(),
      entries: this.entries,
    });
  }

  // --- InteractionObserver ---

  public laserChanged(
    handedness: XRHandedness,
    state: LaserState,
    target: PointerTarget,
  ): void {
    const slot = this.lasers[handedness];
    slot.state = state;
    slot.target = target;
    this.log("laser", { handedness, state, target });
    this.updateState();
  }

  public dragStarted(handedness: XRHandedness, mode: string): void {
    this.log("drag-start", { handedness, mode });
  }

  public dragEnded(handedness: XRHandedness, mode: string): void {
    this.log("drag-end", { handedness, mode });
  }

  public syncPressed(handedness: XRHandedness): void {
    this.log("sync", { handedness });
  }

  public menuButtonHovered(
    id: VRMenuButtonId | null,
    label: string | null,
  ): void {
    this.log("menu-hover", { id, label });
  }

  public menuButtonClicked(id: VRMenuButtonId, label: string): void {
    this.log("menu-click", { id, label });
  }

  // --- Estado derivado ---

  private deriveState(): InteractionState {
    let menu = false;
    let active = false;
    let hover = false;

    for (const key of ["none", "left", "right"] as const) {
      const slot = this.lasers[key];
      if (slot.state === "idle") continue;
      if (slot.target === "menu") menu = true;
      else if (slot.state === "active") active = true;
      else if (slot.target === "gizmo") hover = true;
    }

    if (menu) return "E5";
    if (active) {
      return this.store.getTransformMode() === "rotate" ? "E4" : "E3";
    }
    if (hover) return "E2";
    return "E1";
  }

  private updateState(): void {
    const next = this.deriveState();
    if (next === this.currentState) return;
    this.currentState = next;
    this.log("state", { state: next });
  }

  private resetLasers(): void {
    for (const key of ["none", "left", "right"] as const) {
      this.lasers[key].state = "idle";
      this.lasers[key].target = null;
    }
  }

  private handleSessionStart = () => {
    const session = this.xr.getSession();
    this.log("session-start", {
      environmentBlendMode: session?.environmentBlendMode ?? null,
    });
  };

  private handleSessionEnd = () => {
    this.log("session-end");
    this.resetLasers();
    this.updateState();
    this.onSessionEnd?.();
  };

  public dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.xr.removeEventListener("sessionstart", this.handleSessionStart);
    this.xr.removeEventListener("sessionend", this.handleSessionEnd);
  }
}
