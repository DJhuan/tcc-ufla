/**
 * Tempos de carga de uma molécula (ms, medidos com performance.now()).
 *
 * total = read + parse + bonds + build + scene, onde:
 * - readMs:  leitura do arquivo (fetch/File.text());
 * - parseMs: (a) interpretação do PDB (PDBLoader + centralização);
 * - bondsMs: (b) cálculo das ligações (BondCalculator + CONECT);
 * - buildMs: (c) construção da geometria (BallAndStickBuilder);
 * - sceneMs: contorno + registro no store + scene.add.
 * firstFrameMs mede, à parte, do scene.add até o fim do primeiro
 * renderer.render() seguinte (envio de buffers e compilação de shaders
 * no lado da CPU; a GPU termina de forma assíncrona).
 */
export type LoadMetrics = {
  name: string;
  atoms: number;
  bonds: number;
  meshes: number;
  instancing: boolean;
  readMs: number;
  parseMs: number;
  bondsMs: number;
  buildMs: number;
  sceneMs: number;
  totalMs: number;
  firstFrameMs: number | null;
};

export const PERF_CONSOLE_PREFIX = "[ProtVR-perf]";

export function formatLoadMetrics(m: LoadMetrics): string {
  const f = (v: number | null) => (v === null ? "-" : v.toFixed(1));
  return (
    `${PERF_CONSOLE_PREFIX} load ${m.name}: ${m.atoms} átomos, ${m.bonds} ligações, ` +
    `${m.meshes} malhas, instancing=${m.instancing ? 1 : 0} | ` +
    `read=${f(m.readMs)} parse=${f(m.parseMs)} bonds=${f(m.bondsMs)} ` +
    `build=${f(m.buildMs)} scene=${f(m.sceneMs)} total=${f(m.totalMs)} ` +
    `firstFrame=${f(m.firstFrameMs)} ms`
  );
}
