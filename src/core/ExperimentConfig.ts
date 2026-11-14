/**
 * Configuração dos experimentos do TCC, lida dos parâmetros de URL.
 *
 * Função pura: recebe a query string (ex.: window.location.search) e
 * devolve as flags. Sem parâmetros, todas as instrumentações ficam
 * desligadas e a aplicação se comporta como de costume.
 *
 * - ?log=1 → ativa o EventLogger (registro de eventos de interação).
 */
export interface ExperimentConfig {
  readonly log: boolean;
}

function isEnabled(params: URLSearchParams, key: string): boolean {
  const value = params.get(key);
  return value === "1" || value === "true";
}

export function parseExperimentConfig(search: string): ExperimentConfig {
  const params = new URLSearchParams(search);
  return {
    log: isEnabled(params, "log"),
  };
}
