import type { MoleculeData } from "./types/molecule";

// Livre de interferências gráficas;

/**
 * Tempos (ms) das etapas de interpretação, preenchidos em casos te teste, pelo parser.
 * - parseMs: leitura do texto em átomos (inclui centralização);
 * - bondsMs: cálculo/mescla das ligações.
 */
export type ParseTimings = {
  parseMs: number;
  bondsMs: number;
};

export interface IMoleculeParser {
  readonly supportedExtensions: string[];

  /**
   * Converte o texto bruto do arquivo na estrutura do domínio da aplicação.
   * @param content Conteúdo textual do arquivo.
   * @param name Nome do arquivo ou rótulo da molécula.
   * @param timings Se informado, recebe os tempos de cada etapa.
   */
  parse(content: string, name: string, timings?: ParseTimings): MoleculeData;
}
