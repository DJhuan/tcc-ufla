import type { WebGLRenderer } from "three";
import type { EventLogger } from "./EventLogger";

/**
 * Amostra renderer.info uma vez por segundo e registra um evento "perf".
 *
 * Deve ser chamado logo após renderer.render() (renderer.info é zerado
 * no início de cada render() quando info.autoReset = true).
 *
 * Em WebXR, o three.js desenha os dois olhos dentro de uma única chamada
 * a render() (laço sobre o ArrayCamera, sem multiview), com um único
 * reset por chamada. Logo, `calls` e `triangles` são POR QUADRO, ou seja,
 * a soma dos dois olhos.
 *
 * Fora do segundo de amostragem, o custo é uma subtração e uma comparação.
 */
export class PerfSampler {
  private readonly renderer: WebGLRenderer;
  private readonly logger: EventLogger;
  private readonly intervalMs: number;
  private lastSampleTime = -1;
  private lastFrame = 0;

  public constructor(
    renderer: WebGLRenderer,
    logger: EventLogger,
    intervalMs = 1000,
  ) {
    this.renderer = renderer;
    this.logger = logger;
    this.intervalMs = intervalMs;
  }

  public afterRender = (): void => {
    const now = performance.now();
    const info = this.renderer.info;

    if (this.lastSampleTime < 0) {
      this.lastSampleTime = now;
      this.lastFrame = info.render.frame;
      return;
    }

    const elapsed = now - this.lastSampleTime;
    if (elapsed < this.intervalMs) return;

    const frames = info.render.frame - this.lastFrame;
    this.lastSampleTime = now;
    this.lastFrame = info.render.frame;

    this.logger.log("perf", {
      calls: info.render.calls,
      triangles: info.render.triangles,
      lines: info.render.lines,
      points: info.render.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      frames,
      intervalMs: elapsed,
      fps: (frames * 1000) / elapsed,
      presenting: this.renderer.xr.isPresenting,
    });
  };
}
