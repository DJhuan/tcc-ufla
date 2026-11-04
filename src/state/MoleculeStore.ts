import type { MoleculeRecord } from "../domain/types/molecule";

export type TransformMode = "translate" | "rotate";

export type MoleculeListItem = {
  id: string;
  name: string;
  selected: boolean;
};

export type MoleculeEventMap = {
  "molecule-added": CustomEvent<{ id: string; name: string }>;
  "molecule-removed": CustomEvent<{ id: string; record: MoleculeRecord }>;
  "molecule-selected": CustomEvent<{ id: string | null; name: string | null }>;
  "transform-mode-changed": CustomEvent<{ mode: TransformMode }>;
  "global-scale-changed": CustomEvent<{ scale: number }>;
};

/**
 * Repositório reativo de moléculas da aplicação;
 * Extende EventTarget nativo para emitir CustomEvents;
 * Nasce em substituição ao antigo syncPanels() RIP;
 */
export class MoleculeStore extends EventTarget {
  private readonly molecules = new Map<string, MoleculeRecord>();
  private currentMoleculeId: string | null = null;
  private transformMode: TransformMode = "translate";
  private globalScale: number = 1.0;

  public static readonly MIN_SCALE = 0.1;
  public static readonly MAX_SCALE = 5.0;

  public addMolecule(record: MoleculeRecord): void {
    this.molecules.set(record.id, record);
    this.dispatchEvent(
      new CustomEvent("molecule-added", {
        detail: { id: record.id, name: record.name },
      }),
    );
    this.selectMolecule(record.id);
  }

  public removeMolecule(id: string): MoleculeRecord | null {
    const record = this.molecules.get(id);
    if (!record) {
      return null;
    }

    this.molecules.delete(id);
    this.dispatchEvent(
      new CustomEvent("molecule-removed", {
        detail: { id, record },
      }),
    );

    if (this.currentMoleculeId === id) {
      const nextId = Array.from(this.molecules.keys()).at(-1) ?? null;
      this.selectMolecule(nextId);
    }

    return record;
  }

  public selectMolecule(id: string | null): void {
    if (id !== null && !this.molecules.has(id)) {
      return;
    }

    if (this.currentMoleculeId === id) {
      return;
    }

    this.currentMoleculeId = id;
    const name = id ? (this.molecules.get(id)?.name ?? null) : null;
    this.dispatchEvent(
      new CustomEvent("molecule-selected", {
        detail: { id, name },
      }),
    );
  }

  public setTransformMode(mode: TransformMode): void {
    if (this.transformMode === mode) {
      return;
    }

    this.transformMode = mode;
    this.dispatchEvent(
      new CustomEvent("transform-mode-changed", {
        detail: { mode },
      }),
    );
  }

  public toggleTransformMode(): TransformMode {
    const nextMode: TransformMode =
      this.transformMode === "translate" ? "rotate" : "translate";
    this.setTransformMode(nextMode);
    return nextMode;
  }

  public selectNextMolecule(): string | null {
    const keys = Array.from(this.molecules.keys());
    if (keys.length === 0) return null;
    if (keys.length === 1) {
      this.selectMolecule(keys[0]);
      return keys[0];
    }
    const currentIndex = this.currentMoleculeId
      ? keys.indexOf(this.currentMoleculeId)
      : -1;
    const nextIndex = (currentIndex + 1) % keys.length;
    const nextId = keys[nextIndex];
    this.selectMolecule(nextId);
    return nextId;
  }

  public selectPreviousMolecule(): string | null {
    const keys = Array.from(this.molecules.keys());
    if (keys.length === 0) return null;
    if (keys.length === 1) {
      this.selectMolecule(keys[0]);
      return keys[0];
    }
    const currentIndex = this.currentMoleculeId
      ? keys.indexOf(this.currentMoleculeId)
      : -1;
    const prevIndex = (currentIndex - 1 + keys.length) % keys.length;
    const prevId = keys[prevIndex];
    this.selectMolecule(prevId);
    return prevId;
  }

  public getMolecules(): MoleculeListItem[] {
    return Array.from(this.molecules.values()).map((molecule) => ({
      id: molecule.id,
      name: molecule.name,
      selected: molecule.id === this.currentMoleculeId,
    }));
  }

  public getSelectedMoleculeId(): string | null {
    return this.currentMoleculeId;
  }

  public getSelectedMoleculeName(): string | null {
    if (!this.currentMoleculeId) {
      return null;
    }
    return this.molecules.get(this.currentMoleculeId)?.name ?? null;
  }

  public getSelectedRecord(): MoleculeRecord | null {
    if (!this.currentMoleculeId) {
      return null;
    }
    return this.molecules.get(this.currentMoleculeId) ?? null;
  }

  public getRecord(id: string): MoleculeRecord | null {
    return this.molecules.get(id) ?? null;
  }

  public getAllRecords(): MoleculeRecord[] {
    return Array.from(this.molecules.values());
  }

  public getTransformMode(): TransformMode {
    return this.transformMode;
  }

  public getGlobalScale(): number {
    return this.globalScale;
  }

  public setGlobalScale(scale: number): void {
    const clamped = Math.min(
      MoleculeStore.MAX_SCALE,
      Math.max(MoleculeStore.MIN_SCALE, Number(scale.toFixed(2))),
    );

    if (this.globalScale === clamped) {
      return;
    }

    this.globalScale = clamped;
    this.dispatchEvent(
      new CustomEvent("global-scale-changed", {
        detail: { scale: this.globalScale },
      }),
    );
  }

  public adjustGlobalScale(delta: number): void {
    this.setGlobalScale(this.globalScale + delta);
  }

  public resetGlobalScale(): void {
    this.setGlobalScale(1.0);
  }

  public get size(): number {
    return this.molecules.size;
  }

  public on<K extends keyof MoleculeEventMap>(
    type: K,
    listener: (event: MoleculeEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    const handler = listener as EventListener;
    this.addEventListener(type, handler, options);
    return () => this.removeEventListener(type, handler, options);
  }
}

export interface MoleculeStore {
  addEventListener<K extends keyof MoleculeEventMap>(
    type: K,
    listener: (event: MoleculeEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener<K extends keyof MoleculeEventMap>(
    type: K,
    listener: (event: MoleculeEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
}
