import type { WebXRManager } from "three";
import type { MoleculeStore } from "../state/MoleculeStore";
import type { FrameSampler } from "./FrameSampler";
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

export type EventLoggerOptions = {
  /** Ativa o ciclo de fases do botão A/X (somente com ?perf=1). */
  phaseMarking?: boolean;
};

/** Fases marcadas pelo botão A/X: 1º toque, 2º toque, 3º toque. */
const PHASE_STEPS = ["static", "interaction", "end"] as const;

export const LOG_FORMAT = "protvr-log";
/**
 * v1: só `entries`.
 * v2: + `frames` (amostras por quadro, ?perf=1), fases do A/X,
 *     frameRate na sessão e `frameIndex`/`frameT` nos eventos de sessão,
 *     fase e taxa de atualização.
 */
export const LOG_FORMAT_VERSION = 2;

export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

/**
 * Registro de eventos de interação (camada core, sem dependência de UI).
 *
 * Registra apenas mudanças: estado do laser por controle, arraste,
 * modo de transformação, seleção/adição de moléculas, botões do VRMenu,
 * início/fim da sessão XR, "sync" (borda de subida do botão B/Y), fases
 * do experimento (A/X, com ?perf=1) e o estado derivado E1–E5.
 */
export class EventLogger implements InteractionObserver {
  private readonly store: MoleculeStore;
  private readonly xr: WebXRManager;
  private readonly entries: LogEntry[] = [];
  private readonly startedAt: number;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly phaseMarking: boolean;

  // Um slot por handedness, pré-alocado (sem alocação ao derivar o estado).
  private readonly lasers: Record<XRHandedness, LaserSlot> = {
    none: { state: "idle", target: null },
    left: { state: "idle", target: null },
    right: { state: "idle", target: null },
  };
  private currentState: InteractionState = "E1";

  private frameSampler: FrameSampler | null = null;
  private activeSession: XRSession | null = null;
  private phaseStep = 0;
  private phaseCycle = 0;

  /** Chamado após o registro do fim da sessão XR (exportação automática). */
  public onSessionEnd: (() => void) | null = null;

  public constructor(
    store: MoleculeStore,
    xr: WebXRManager,
    meta: Record<string, unknown> = {},
    options: EventLoggerOptions = {},
  ) {
    this.store = store;
    this.xr = xr;
    this.phaseMarking = options.phaseMarking ?? false;
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

  /**
   * Liga as amostras por quadro: elas entram no JSON exportado (`frames`) e
   * servem de relógio para as marcas de fase.
   */
  public attachFrameSampler(sampler: FrameSampler): void {
    this.frameSampler = sampler;
    sampler.onBufferFull = () => {
      this.log("perf-buffer-full", {
        capacity: sampler.capacity,
        ...this.frameRef(),
      });
    };
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

  /**
   * Serializa o registro. `includeFrames: false` gera uma versão só com
   * `entries` (usada como cópia reduzida no localStorage).
   */
  public toJSON(options: { includeFrames?: boolean } = {}): string {
    const includeFrames = options.includeFrames ?? true;
    return JSON.stringify({
      format: LOG_FORMAT,
      version: LOG_FORMAT_VERSION,
      startedAt: this.startedAt,
      exportedAt: epochNow(),
      entries: this.entries,
      frames:
        includeFrames && this.frameSampler
          ? this.frameSampler.toJSONObject()
          : null,
    });
  }

  /**
   * Referência ao relógio das amostras por quadro: `frameIndex` é o índice
   * da primeira amostra gravada a partir deste evento (-1 com o buffer
   * cheio) e `frameT` o `time` do quadro em andamento ou do último iniciado.
   */
  private frameRef(): { frameIndex: number | null; frameT: number | null } {
    const sampler = this.frameSampler;
    if (!sampler) return { frameIndex: null, frameT: null };
    const frameT = sampler.currentFrameTime;
    return {
      frameIndex: sampler.frameIndex,
      frameT: Number.isNaN(frameT) ? null : frameT,
    };
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

  /**
   * Ciclo do A/X: 1º toque → phase-start {static}, 2º → phase-start
   * {interaction}, 3º → phase-end; o 4º recomeça. Ignorado sem ?perf=1.
   */
  public phaseButtonPressed(handedness: XRHandedness): void {
    if (!this.phaseMarking) return;

    const step = PHASE_STEPS[this.phaseStep];
    if (step === "static") this.phaseCycle += 1;

    const data = { cycle: this.phaseCycle, handedness, ...this.frameRef() };
    if (step === "end") {
      this.log("phase-end", data);
    } else {
      this.log("phase-start", { phase: step, ...data });
    }
    this.phaseStep = (this.phaseStep + 1) % PHASE_STEPS.length;
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

  // --- Sessão XR ---

  private handleSessionStart = () => {
    const session = this.xr.getSession();
    this.activeSession = session;
    session?.addEventListener("frameratechange", this.handleFrameRateChange);

    const rates = session?.supportedFrameRates;
    this.log("session-start", {
      environmentBlendMode: session?.environmentBlendMode ?? null,
      frameRate: session?.frameRate ?? null,
      supportedFrameRates: rates ? Array.from(rates) : null,
      ...this.frameRef(),
    });
  };

  private handleFrameRateChange = () => {
    this.log("framerate-change", {
      frameRate: this.activeSession?.frameRate ?? null,
      ...this.frameRef(),
    });
  };

  private handleSessionEnd = () => {
    // Fecha um ciclo de fases interrompido pelo fim da sessão;
    if (this.phaseMarking && this.phaseStep !== 0) {
      this.log("phase-end", {
        cycle: this.phaseCycle,
        handedness: null,
        reason: "session-end",
        ...this.frameRef(),
      });
      this.phaseStep = 0;
    }

    this.activeSession?.removeEventListener(
      "frameratechange",
      this.handleFrameRateChange,
    );
    this.activeSession = null;

    this.log("session-end", { ...this.frameRef() });
    this.resetLasers();
    this.updateState();
    this.onSessionEnd?.();
  };

  public dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.activeSession?.removeEventListener(
      "frameratechange",
      this.handleFrameRateChange,
    );
    this.xr.removeEventListener("sessionstart", this.handleSessionStart);
    this.xr.removeEventListener("sessionend", this.handleSessionEnd);
  }
}
