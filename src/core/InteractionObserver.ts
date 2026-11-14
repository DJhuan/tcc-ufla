import type { VRMenuButtonId } from "./VRMenu";

export type LaserState = "idle" | "hover" | "active";

/** Elemento para o qual o laser aponta quando está em hover/active. */
export type PointerTarget = "menu" | "gizmo" | null;

/**
 * Observador opcional das interações em VR.
 *
 * XRControllerManager e VRMenu chamam estes métodos apenas quando algo
 * muda (nunca a cada quadro). Quando nenhum observador é registrado,
 * o custo é somente uma checagem de `undefined`.
 */
export interface InteractionObserver {
  laserChanged(
    handedness: XRHandedness,
    state: LaserState,
    target: PointerTarget,
  ): void;
  dragStarted(handedness: XRHandedness, mode: string): void;
  dragEnded(handedness: XRHandedness, mode: string): void;
  syncPressed(handedness: XRHandedness): void;
  menuButtonHovered(id: VRMenuButtonId | null, label: string | null): void;
  menuButtonClicked(id: VRMenuButtonId, label: string): void;
}
