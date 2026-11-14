/**
 * Cenários pré-carregados dos experimentos (?scenario=<id>).
 *
 * Os arquivos ficam em public/assets e são carregados em sequência,
 * lado a lado no eixo X, na ordem listada.
 *
 * m1/m2 → avaliação com CLIP; c1–c4 → desempenho (OVR Metrics Tool).
 * O contorno não é forçado aqui: em VR ele continua oculto apenas para
 * moléculas acima de VR_OUTLINE_MAX_ATOMS (visível no m1, oculto no m2).
 */

export const SCENARIO_IDS = ["m1", "m2", "c1", "c2", "c3", "c4"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

/** Par de moléculas simultâneas do cenário c4 (configurável). */
export const C4_PAIR: readonly string[] = ["ATP.pdb", "6XE9.pdb"];

export const SCENARIO_ASSET_BASE = "/assets/";

export type Scenario = {
  readonly id: ScenarioId;
  readonly files: readonly string[];
  readonly description: string;
};

export const SCENARIOS: Readonly<Record<ScenarioId, Scenario>> = {
  m1: {
    id: "m1",
    files: ["ATP.pdb", "ATP.pdb"],
    description: "CLIP: duas cópias de ATP lado a lado (contorno visível)",
  },
  m2: {
    id: "m2",
    files: ["6H0F.pdb"],
    description: "CLIP: 6H0F (contorno ocultado em VR)",
  },
  c1: { id: "c1", files: ["ATP.pdb"], description: "Desempenho: ATP" },
  c2: { id: "c2", files: ["6XE9.pdb"], description: "Desempenho: 6XE9" },
  c3: { id: "c3", files: ["6H0F.pdb"], description: "Desempenho: 6H0F" },
  c4: {
    id: "c4",
    files: C4_PAIR,
    description: `Desempenho: ${C4_PAIR.join(" + ")} simultâneas`,
  },
};

export function isScenarioId(value: string | null): value is ScenarioId {
  return value !== null && (SCENARIO_IDS as readonly string[]).includes(value);
}

export function getScenarioUrls(scenario: Scenario): string[] {
  return scenario.files.map((file) => `${SCENARIO_ASSET_BASE}${file}`);
}
