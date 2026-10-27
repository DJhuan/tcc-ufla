import type { Atom, Bond } from "../domain/types/molecule";
import { COVALENT_RADII } from "../domain/Constants";

export class BondCalculator {
  // Aresta mínima das células da grade (Å). A aresta efetiva é calculada em
  // findBonds e nunca é menor que o maior alcance de ligação possível.
  private readonly minCellSize: number;

  // Tolerância somada à soma dos raios covalentes (Å).
  private readonly tolerance: number;

  // Distância mínima ao quadrado (Å²): descarta pares sobrepostos ou duplicados.
  private static readonly MIN_DIST_SQ = 0.4 * 0.4;

  // Comparando sempre com átomos dos 13 vizinhos próximos em sentido único;
  private static readonly NEIGHBOR_OFFSETS: ReadonlyArray<
    [number, number, number]
  > = [
    // z = 0 (4 vizinhos no mesmo plano);
    [1, 0, 0],
    [-1, 1, 0],
    [0, 1, 0],
    [1, 1, 0],

    // z = 1 (9 vizinhos no plano acima);
    [-1, -1, 1],
    [0, -1, 1],
    [1, -1, 1],
    [-1, 0, 1],
    [0, 0, 1],
    [1, 0, 1],
    [-1, 1, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];

  public constructor(minCellSize = 2.4, tolerance = 0.45) {
    this.minCellSize = minCellSize;
    this.tolerance = tolerance;
  }

  public findBonds(atoms: Atom[]): Bond[] {
    if (atoms.length < 2) return [];

    const bonds: Bond[] = [];

    // Raios covalentes e o maior raio entre os elementos presentes.
    const radii = new Float32Array(atoms.length);
    let maxRadius = 0;
    for (let i = 0; i < atoms.length; i++) {
      radii[i] = COVALENT_RADII[atoms[i].element] ?? COVALENT_RADII.DEFAULT;
      if (radii[i] > maxRadius) maxRadius = radii[i];
    }

    // Maior distância em que dois átomos ainda satisfazem o critério de ligação.
    // Com a aresta >= esse alcance, todo par ligado cai na mesma célula ou em
    // células adjacentes, o que torna a busca nos 13 vizinhos completa.
    const maxBondDist = 2 * maxRadius + this.tolerance;
    const cellSize = Math.max(this.minCellSize, maxBondDist);

    const grid = new Map<string, number[]>();
    for (let a = 0; a < atoms.length; a++) {
      const pos = atoms[a].position;
      // A chave é "x,y,z";
      const key =
        Math.floor(pos.x / cellSize) +
        "," +
        Math.floor(pos.y / cellSize) +
        "," +
        Math.floor(pos.z / cellSize);

      if (!grid.has(key)) {
        grid.set(key, []);
      }
      grid.get(key)!.push(a);
    }

    const checkPair = (i: number, j: number) => {
      const posA = atoms[i].position;
      const posB = atoms[j].position;

      const dx = posA.x - posB.x;
      const dy = posA.y - posB.y;
      const dz = posA.z - posB.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < BondCalculator.MIN_DIST_SQ) return;

      const maxDist = radii[i] + radii[j] + this.tolerance;
      const maxDistSq = maxDist * maxDist;

      if (distSq <= maxDistSq) {
        bonds.push({
          startAtomIndex: Math.min(i, j),
          endAtomIndex: Math.max(i, j),
          order: 1,
        });
      }
    };

    for (const [key, cell] of grid) {
      const coords = key.split(",").map(Number);
      const gx = coords[0];
      const gy = coords[1];
      const gz = coords[2];

      const cellLength = cell.length;

      for (let a = 0; a < cellLength; a++) {
        for (let b = a + 1; b < cellLength; b++) {
          checkPair(cell[a], cell[b]);
        }
      }

      for (let n = 0; n < BondCalculator.NEIGHBOR_OFFSETS.length; n++) {
        const offset = BondCalculator.NEIGHBOR_OFFSETS[n];
        const neighborKey = `${gx + offset[0]},${gy + offset[1]},${gz + offset[2]}`;
        const neighborCell = grid.get(neighborKey);

        if (!neighborCell) continue;

        const neighborLength = neighborCell.length;
        for (let a = 0; a < cellLength; a++) {
          for (let b = 0; b < neighborLength; b++) {
            checkPair(cell[a], neighborCell[b]);
          }
        }
      }
    }

    return bonds;
  }
}