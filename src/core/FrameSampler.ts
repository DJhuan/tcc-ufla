import type { WebGLRenderer } from "three";

/**
 * Amostragem de desempenho POR QUADRO (somente com ?perf=1).
 *
 * O MoleculeViewer chama `beginFrame(time)` no início do renderLoop e
 * `endFrame()` logo após `renderer.render()`. Por quadro são gravados:
 *
 * - t:          `time` recebido do setAnimationLoop (ms desde
 *               performance.timeOrigin). Durante a sessão XR, é o tempo do
 *               requestAnimationFrame do WebXR (no Quest, pode ser o instante
 *               previsto de exibição); no desktop, o do rAF da janela;
 * - dt:         t - t do quadro anterior (NaN no primeiro);
 * - cpu:        performance.now() de beginFrame até endFrame (controls,
 *               controles XR e render). Não inclui o tempo de GPU, que
 *               termina de forma assíncrona;
 * - calls,
 *   triangles:  renderer.info.render, lidos logo após o render. Em WebXR o
 *               three.js r186 desenha os dois olhos numa única chamada a
 *               render() (laço sobre o ArrayCamera, sem multiview) e zera
 *               renderer.info uma vez por chamada: os valores são POR QUADRO,
 *               a soma dos dois olhos;
 * - presenting: 1 se renderer.xr.isPresenting, senão 0.
 *
 * Armazenamento: estrutura de arrays (um Float64Array por campo),
 * pré-alocada. Quando o buffer enche, a gravação para (não sobrescreve) e
 * `onBufferFull` é chamado uma única vez. Nenhuma alocação por quadro.
 */

/** 2^17 quadros: ~24 min a 90 Hz, ~18 min a 120 Hz (~6 MB em memória). */
export const FRAME_SAMPLER_CAPACITY = 131_072;

/** Ganchos chamados pelo renderLoop do MoleculeViewer. */
export interface FrameHook {
  beginFrame(time: number): void;
  endFrame(): void;
}

export type FramesExport = {
  count: number;
  capacity: number;
  full: boolean;
  timeOrigin: number;
  t: number[];
  /** NaN (null no JSON) no primeiro quadro. */
  dt: number[];
  cpu: number[];
  calls: number[];
  triangles: number[];
  presenting: number[];
};

function roundTo(values: Float64Array, count: number, decimals: number): number[] {
  const factor = 10 ** decimals;
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    // NaN permanece NaN e vira null no JSON.stringify;
    out[i] = Math.round(values[i] * factor) / factor;
  }
  return out;
}

export class FrameSampler implements FrameHook {
  public readonly capacity: number;
  public readonly t: Float64Array;
  public readonly dt: Float64Array;
  public readonly cpu: Float64Array;
  public readonly calls: Float64Array;
  public readonly triangles: Float64Array;
  public readonly presenting: Float64Array;

  /** Chamado uma única vez quando o buffer enche. */
  public onBufferFull: (() => void) | null = null;

  private readonly renderer: WebGLRenderer;
  private count = 0;
  private full = false;
  private prevTime = Number.NaN;
  private frameTime = Number.NaN;
  private cpuStart = 0;

  public constructor(renderer: WebGLRenderer, capacity = FRAME_SAMPLER_CAPACITY) {
    this.renderer = renderer;
    this.capacity = capacity;
    this.t = new Float64Array(capacity);
    this.dt = new Float64Array(capacity);
    this.cpu = new Float64Array(capacity);
    this.calls = new Float64Array(capacity);
    this.triangles = new Float64Array(capacity);
    this.presenting = new Float64Array(capacity);
  }

  public beginFrame(time: number): void {
    this.frameTime = time;
    this.cpuStart = performance.now();
  }

  public endFrame(): void {
    const cpuEnd = performance.now();
    const i = this.count;

    if (i >= this.capacity) {
      if (!this.full) {
        this.full = true;
        this.onBufferFull?.();
      }
      return;
    }

    const info = this.renderer.info.render;
    this.t[i] = this.frameTime;
    this.dt[i] = this.frameTime - this.prevTime;
    this.cpu[i] = cpuEnd - this.cpuStart;
    this.calls[i] = info.calls;
    this.triangles[i] = info.triangles;
    this.presenting[i] = this.renderer.xr.isPresenting ? 1 : 0;

    this.prevTime = this.frameTime;
    this.count = i + 1;
  }

  /**
   * Índice da primeira amostra gravada a partir de agora: dentro do
   * renderLoop (antes de endFrame) é o quadro em andamento; fora dele, o
   * próximo quadro. -1 se o buffer estiver cheio.
   */
  public get frameIndex(): number {
    return this.count < this.capacity ? this.count : -1;
  }

  /** `time` do quadro em andamento (ou do último iniciado). */
  public get currentFrameTime(): number {
    return this.frameTime;
  }

  public get sampleCount(): number {
    return this.count;
  }

  public get isFull(): boolean {
    return this.full;
  }

  /**
   * Arrays cortados em `count` e arredondados para reduzir o JSON:
   * t com 3 casas, dt e cpu com 2 (10 µs; o performance.now() dos
   * navegadores já é mais grosso que isso), calls/triangles/presenting inteiros.
   */
  public toJSONObject(): FramesExport {
    const n = this.count;
    return {
      count: n,
      capacity: this.capacity,
      full: this.full,
      timeOrigin: performance.timeOrigin,
      t: roundTo(this.t, n, 3),
      dt: roundTo(this.dt, n, 2),
      cpu: roundTo(this.cpu, n, 2),
      calls: roundTo(this.calls, n, 0),
      triangles: roundTo(this.triangles, n, 0),
      presenting: roundTo(this.presenting, n, 0),
    };
  }
}
