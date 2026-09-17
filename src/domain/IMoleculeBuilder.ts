import type * as THREE from "three";
import type { MoleculeData } from "./types/molecule";

/**
 * Um construtuor de moléculas deve ser responsável por converter
 * uma estrutura de dados de uma molécula num modelo 3D apresentável;
 */
export interface IMoleculeBuilder {
  // Converte a estrutura de dados MoleculeData em um objeto 3D do Three.js.
  build(data: MoleculeData): THREE.Group;
}
