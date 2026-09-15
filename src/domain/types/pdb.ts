import type * as THREE from "three";

/**
 * Tupla que representa um átomo na estrutura do PDBLoader do Three.js:
 * [x, y, z, [r, g, b], elementSymbol]
 * - x, y, z: coordenadas atômicas;
 * - color: valores RGB normalizados (0-255);
 * - element: símbolo do elemento químico capitalizado (ex.: "C", "N", "O", "P");
 */
export type PDBAtomData = [
  x: number,
  y: number,
  z: number,
  color: [r: number, g: number, b: number],
  element: string,
];

/**
 * Tupla que representa uma ligação covalente no PDB [índiceOrigem, índiceDestino, ordem];
 */
export type PDBBondData = [
  startAtomIndex: number,
  endAtomIndex: number,
  order?: number,
];

/**
 * Estrutura de dados resultante da análise do arquivo PDB;
 */
export interface PDBStructure {
  geometryAtoms: THREE.BufferGeometry;
  geometryBonds: THREE.BufferGeometry;
  json: {
    atoms: PDBAtomData[];
    bonds?: PDBBondData[];
  };
}
