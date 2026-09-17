import * as THREE from "three";
import { PDBLoader } from "three/addons/loaders/PDBLoader.js";
import type { IMoleculeParser } from "../../domain/IMoleculeParser";
import type { Atom, Bond, MoleculeData } from "../../domain/types/molecule";
import type { PDBStructure } from "../../domain/types/pdb";

/**
 * Exemplo de arquivo PDB:
 * HETATM   10  C2* ATP   802       7.022  17.119  10.877  1.00 11.15           C
 * HETATM   11  O2* ATP   802       7.520  16.069  11.726  1.00 11.27           O
 * HETATM   12  C1* ATP   802       7.440  16.999   9.417  1.00 10.57           C
 */

export class PDBParser implements IMoleculeParser {
  public readonly supportedExtensions = [".pdb", ".ent"];
  private readonly loader = new PDBLoader();

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

    const bonds = this.parseBonds(content, atoms.length);

    return {
      name,
      atoms,
      bonds,
    };
  }

  private parseBonds(content: string, totalAtoms: number): Bond[] {
    const bonds: Bond[] = [];
    const bondSet = new Set<string>();
    const lines = content.split("\n");

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (!line.startsWith("CONECT")) continue;

      const sourceSerial = parseInt(line.slice(6, 11).trim(), 10);
      if (isNaN(sourceSerial)) continue;

      const targets = [
        parseInt(line.slice(11, 16).trim(), 10),
        parseInt(line.slice(16, 21).trim(), 10),
        parseInt(line.slice(21, 26).trim(), 10),
        parseInt(line.slice(26, 31).trim(), 10),
      ];

      for (let tsi = 0; tsi < targets.length; tsi++) {
        const targetSerial = targets[tsi];
        if (isNaN(targetSerial)) continue;

        const i = sourceSerial - 1;
        const j = targetSerial - 1;

        if (i < 0 || i >= totalAtoms || j < 0 || j >= totalAtoms) continue;

        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!bondSet.has(key)) {
          bondSet.add(key);
          bonds.push({
            startAtomIndex: Math.min(i, j),
            endAtomIndex: Math.max(i, j),
            order: 1,
          });
        }
      }
    }

    return bonds;
  }
}
