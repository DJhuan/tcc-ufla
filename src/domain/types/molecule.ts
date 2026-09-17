/**
 * Generalização da molécula.
 * 
 * Atom: atomo no espaço 3D;
 * Bond: ligação entre átomos A e b;
 * MoleculeData: estrutura canônica de uma molécula no domínio da aplicação.
 * MoleculeRecord: estrutura de uma molécula no domínio da aplicação, com informações de renderização.
 */

import type * as THREE from "three";

export type Atom = {
  index: number;
  element: string;
  position: THREE.Vector3;
};

export type Bond = {
  startAtomIndex: number;
  endAtomIndex: number;
  order?: number;
};

export type MoleculeData = {
  name: string;
  atoms: Atom[];
  bonds: Bond[];
};

export type MoleculeRecord = {
  id: string;
  name: string;
  object: THREE.Group;
  baseObject: THREE.Object3D;
  outlineObject: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  outlineColor: number;
};