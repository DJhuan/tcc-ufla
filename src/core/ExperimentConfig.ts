/**
 * Configuração dos experimentos do TCC, lida dos parâmetros de URL.
 *
 * Função pura: recebe a query string (ex.: window.location.search) e
 * devolve as flags. Sem parâmetros, todas as instrumentações ficam
 * desligadas e a aplicação se comporta como de costume.
 *
 * - ?log=1        → ativa o EventLogger (registro de eventos de interação).
 * - ?perf=1       → amostra renderer.info a cada segundo (implica o logger).
 * - ?instancing=0 → um THREE.Mesh por átomo/ligação em vez de InstancedMesh.
 */
export interface ExperimentConfig {
  readonly log: boolean;
  readonly perf: boolean;
  readonly instancing: boolean;
}

function isEnabled(params: URLSearchParams, key: string): boolean {
  const value = params.get(key);
  return value === "1" || value === "true";
}

function isDisabled(params: URLSearchParams, key: string): boolean {
  const value = params.get(key);
  return value === "0" || value === "false";
}

export function parseExperimentConfig(search: string): ExperimentConfig {
  const params = new URLSearchParams(search);
  return {
    log: isEnabled(params, "log"),
    perf: isEnabled(params, "perf"),
    instancing: !isDisabled(params, "instancing"),
  };
}
