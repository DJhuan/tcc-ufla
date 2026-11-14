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
 * - ?scenario=<id> → carrega um cenário pré-definido (ver Scenarios.ts).
 */
import { isScenarioId, type ScenarioId } from "./Scenarios";

export interface ExperimentConfig {
  readonly log: boolean;
  readonly perf: boolean;
  readonly instancing: boolean;
  /** Cenário válido, ou null se ausente. */
  readonly scenario: ScenarioId | null;
  /** Valor bruto de ?scenario quando não corresponde a nenhum cenário. */
  readonly invalidScenario: string | null;
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
  const rawScenario = params.get("scenario")?.trim().toLowerCase() || null;
  const scenario = isScenarioId(rawScenario) ? rawScenario : null;
  return {
    log: isEnabled(params, "log"),
    perf: isEnabled(params, "perf"),
    instancing: !isDisabled(params, "instancing"),
    scenario,
    invalidScenario: rawScenario !== null && scenario === null ? rawScenario : null,
  };
}
