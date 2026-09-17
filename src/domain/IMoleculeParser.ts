import type { MoleculeData } from "./types/molecule";

// Livre de interferências gráficas;

export interface IMoleculeParser {
  readonly supportedExtensions: string[];

  /**
   * Converte o texto bruto do arquivo na estrutura do domínio da aplicação.
   * @param content Conteúdo textual do arquivo.
   * @param name Nome do arquivo ou rótulo da molécula.
   */
  parse(content: string, name: string): MoleculeData;
}
