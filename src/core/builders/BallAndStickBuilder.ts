import * as THREE from "three";
import type { IMoleculeBuilder } from "../../domain/IMoleculeBuilder";
import type { MoleculeData } from "../../domain/types/molecule";
import { ELEMENT_COLORS, ELEMENT_RADII } from "../../domain/Constants";

/**
 * Pipeline de construção de moléculas no estilo Bola e Bastão.
 *
 * 1. Agrupamento de átomos por elemento químico.
 * 2. Criação de uma malha por elemento.
 * 3. Criação de uma malha para as ligações químicas.
 */

export class BallAndStickBuilder implements IMoleculeBuilder {
  private static readonly _direction = new THREE.Vector3();
  private static readonly _midpoint = new THREE.Vector3();
  private static readonly _up = new THREE.Vector3(0, 1, 0);

  public build(data: MoleculeData): THREE.Group {
    const group = new THREE.Group();
    group.name = `Molecule-${data.name}`;

    // 1. Agrupamento;
    const atomsByElement = new Map<
      string,
      { color: number; radius: number; positions: THREE.Vector3[] }
    >();

    for (let ia = 0; ia < data.atoms.length; ia++) {
      const atom = data.atoms[ia];
      const key = atom.element.toUpperCase();
      let bucket = atomsByElement.get(key);

      if (!bucket) {
        bucket = {
          color: ELEMENT_COLORS[key] ?? 0xffffff,
          radius: ELEMENT_RADII[key] ?? 0.45,
          positions: [],
        };
        atomsByElement.set(key, bucket);
      }

      bucket.positions.push(atom.position);
    }

    const sphereGeometry = new THREE.SphereGeometry(1, 16, 12);
    const dummy = new THREE.Object3D();

    // 2. Malha para elementos;
    atomsByElement.forEach((bucket) => {
      const count = bucket.positions.length;
      if (count === 0) return;

      const material = new THREE.MeshStandardMaterial({
        color: bucket.color,
        metalness: 0.1,
        roughness: 0.8,
      });

      const mesh = new THREE.InstancedMesh(sphereGeometry, material, count);

      for (let i = 0; i < count; i++) {
        dummy.position.copy(bucket.positions[i]);
        dummy.scale.setScalar(bucket.radius);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    });

    // 3. Malha para ligações;
    if (data.bonds.length > 0) {
      const bondGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
      const bondMaterial = new THREE.MeshStandardMaterial({
        color: 0x999999,
        metalness: 0.1,
        roughness: 0.8,
      });

      const bondMesh = new THREE.InstancedMesh(
        bondGeometry,
        bondMaterial,
        data.bonds.length,
      );

      for (let i = 0; i < data.bonds.length; i++) {
        const bond = data.bonds[i];
        const start = data.atoms[bond.startAtomIndex]?.position;
        const end = data.atoms[bond.endAtomIndex]?.position;

        if (!start || !end) continue;

        // Calcula direção e comprimento reutilizando vetores de rascunho
        BallAndStickBuilder._direction.subVectors(end, start);
        const length = BallAndStickBuilder._direction.length();

        BallAndStickBuilder._midpoint
          .addVectors(start, end)
          .multiplyScalar(0.5);

        dummy.position.copy(BallAndStickBuilder._midpoint);
        dummy.quaternion.setFromUnitVectors(
          BallAndStickBuilder._up,
          BallAndStickBuilder._direction.normalize(),
        );
        dummy.scale.set(0.12, length, 0.12);
        dummy.updateMatrix();

        bondMesh.setMatrixAt(i, dummy.matrix);
      }

      bondMesh.instanceMatrix.needsUpdate = true;
      group.add(bondMesh);
    }

    return group;
  }
}
