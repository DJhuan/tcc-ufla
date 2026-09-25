import * as THREE from "three";
import { PDBLoader } from "three/addons/loaders/PDBLoader.js";
import type { IMoleculeParser } from "../../domain/IMoleculeParser";
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

  public parse(content: string, name: string): MoleculeData {
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

    const bonds = this.bondCalculator.findBonds(atoms);

    return {
      name,
      atoms,
      bonds,
    };
  }
}
