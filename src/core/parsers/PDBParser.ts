import * as THREE from "three";
import { PDBLoader } from "three/addons/loaders/PDBLoader.js";
import type {
  IMoleculeParser,
  ParseTimings,
} from "../../domain/IMoleculeParser";
import type { Atom, MoleculeData } from "../../domain/types/molecule";
import type { PDBStructure } from "../../domain/types/pdb";
import { BondCalculator } from "../BondCalculator";

/**
 * Exemplo de arquivo PDB:
 * HETATM   10  C2* ATP   802       7.022  17.119  10.877  1.00 11.15           C
 * HETATM   11  O2* ATP   802       7.520  16.069  11.726  1.00 11.27           O
 * HETATM   12  C1* ATP   802       7.440  16.999   9.417  1.00 10.57           C
 */

export class PDBParser implements IMoleculeParser {
  public readonly supportedExtensions = [".pdb", ".ent"];
  private readonly loader = new PDBLoader();
  private readonly bondCalculator = new BondCalculator();

  public parse(
    content: string,
    name: string,
    timings?: ParseTimings,
  ): MoleculeData {
    const parseStart = performance.now();
    const parsed = this.loader.parse(content) as unknown as PDBStructure;
    const positions = parsed.geometryAtoms.attributes.position
      .array as Float32Array;
    const atomsData = parsed.json?.atoms ?? [];

    const atoms: Atom[] = [];

    for (let i = 0; i < positions.length; i += 3) {
      const idx = i / 3;
      const pos = new THREE.Vector3(
        positions[i],
        positions[i + 1],
        positions[i + 2],
      );
      const element = atomsData[idx]?.[4] ?? "X";

      atoms.push({
        index: idx,
        element: element.toUpperCase(),
        position: pos,
      });
    }

    if (atoms.length > 0) {
      const center = new THREE.Vector3();
      for (let ai = 0; ai < atoms.length; ai++) {
        const atom = atoms[ai];
        center.add(atom.position);
      }
      center.divideScalar(atoms.length);

      for (let ai = 0; ai < atoms.length; ai++) {
        const atom = atoms[ai];
        atom.position.sub(center);
      }
    }

    const bondsStart = performance.now();
    const calculatedBonds = this.bondCalculator.findBonds(atoms);
    const bonds = this.mergeBondsWithGeometryBonds(
      calculatedBonds,
      parsed.geometryBonds,
      positions,
    );

    if (timings) {
      timings.parseMs = bondsStart - parseStart;
      timings.bondsMs = performance.now() - bondsStart;
    }

    return {
      name,
      atoms,
      bonds,
    };
  }

  /**
   * Combina as ligações calculadas por distância com as dos registros CONECT,
   * que o PDBLoader do Three.js devolve em parsed.geometryBonds.
   */
  private mergeBondsWithGeometryBonds(
    calculatedBonds: import("../../domain/types/molecule").Bond[],
    geometryBonds: THREE.BufferGeometry,
    rawAtomPositions: Float32Array,
  ): import("../../domain/types/molecule").Bond[] {
    const bondPositions = geometryBonds.getAttribute(
      "position",
    ) as THREE.BufferAttribute | undefined;
    if (!bondPositions || bondPositions.count < 2) {
      return calculatedBonds;
    }

    // Mapa de coordenadas originais (x,y,z arredondadas em 0,001Å) para índice atômico
    const coordToAtomIndex = new Map<string, number>();
    for (let i = 0; i < rawAtomPositions.length; i += 3) {
      const key = this.getCoordKey(
        rawAtomPositions[i],
        rawAtomPositions[i + 1],
        rawAtomPositions[i + 2],
      );
      coordToAtomIndex.set(key, i / 3);
    }

    // Pares e átomos citados no CONECT
    const conectPairs: Array<[number, number]> = [];
    const conectSet = new Set<string>();
    const conectAtoms = new Set<number>();

    const bondArray = bondPositions.array;
    for (let i = 0; i < bondArray.length; i += 6) {
      const k1 = this.getCoordKey(bondArray[i], bondArray[i + 1], bondArray[i + 2]);
      const k2 = this.getCoordKey(
        bondArray[i + 3],
        bondArray[i + 4],
        bondArray[i + 5],
      );

      const a1 = coordToAtomIndex.get(k1);
      const a2 = coordToAtomIndex.get(k2);

      if (a1 !== undefined && a2 !== undefined && a1 !== a2) {
        const min = Math.min(a1, a2);
        const max = Math.max(a1, a2);
        const pairKey = `${min}-${max}`;

        if (!conectSet.has(pairKey)) {
          conectSet.add(pairKey);
          conectPairs.push([min, max]);
          conectAtoms.add(min);
          conectAtoms.add(max);
        }
      }
    }

    if (conectPairs.length === 0) {
      return calculatedBonds;
    }

    // Ligações por distância, exceto as que ligam dois átomos do CONECT sem
    // que o CONECT as declare
    const bonds: import("../../domain/types/molecule").Bond[] = [];
    const bondSet = new Set<string>();
    for (let i = 0; i < calculatedBonds.length; i++) {
      const b = calculatedBonds[i];
      const min = Math.min(b.startAtomIndex, b.endAtomIndex);
      const max = Math.max(b.startAtomIndex, b.endAtomIndex);
      const pairKey = `${min}-${max}`;

      if (
        conectAtoms.has(min) &&
        conectAtoms.has(max) &&
        !conectSet.has(pairKey)
      ) {
        continue;
      }

      bondSet.add(pairKey);
      bonds.push(b);
    }

    // Ligações do CONECT que a distância não encontrou
    for (let i = 0; i < conectPairs.length; i++) {
      const [min, max] = conectPairs[i];
      const pairKey = `${min}-${max}`;
      if (!bondSet.has(pairKey)) {
        bondSet.add(pairKey);
        bonds.push({ startAtomIndex: min, endAtomIndex: max });
      }
    }

    return bonds;
  }

  private getCoordKey(x: number, y: number, z: number): string {
    return `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  }
}
