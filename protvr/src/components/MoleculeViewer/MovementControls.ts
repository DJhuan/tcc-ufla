import "./MovementControls.css";

import type { TransformMode } from "./MoleculeViewer";

export function createMovementControls(options: {
  onModeChange: (mode: TransformMode) => void;
}) {
  const root = document.createElement("section");
  root.className = "molecule-panel movement-panel transform-panel";

  const header = document.createElement("div");
  header.className = "molecule-panel__header";

  const title = document.createElement("h2");
  title.className = "molecule-panel__title";
  title.textContent = "Transformar molécula";

  const subtitle = document.createElement("p");
  subtitle.className = "molecule-panel__subtitle";
  subtitle.textContent =
    "Escolha entre mover e rotacionar a molécula selecionada.";

  const status = document.createElement("div");
  status.className = "movement-panel__status";
  status.textContent = "Nenhuma molécula selecionada.";

  const modeRow = document.createElement("div");
  modeRow.className = "transform-panel__modes";

  const modeButtons = new Map<TransformMode, HTMLButtonElement>();

  function createButton(label: string, mode: TransformMode) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "movement-panel__button transform-panel__mode-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      options.onModeChange(mode);
      setMode(mode);
    });
    modeButtons.set(mode, button);
    return button;
  }

  const translate = createButton("Mover", "translate");
  const rotate = createButton("Rotacionar", "rotate");

  modeRow.append(translate, rotate);
  header.append(title, subtitle);
  root.append(header, status, modeRow);

  function setMode(mode: TransformMode) {
    modeButtons.forEach((button, currentMode) => {
      button.classList.toggle("is-active", currentMode === mode);
    });
  }

  setMode("translate");

  return {
    root,
    setSelected(name: string | null) {
      status.textContent = name
        ? `Selecionada: ${name}`
        : "Nenhuma molécula selecionada.";
      root.classList.toggle("is-disabled", !name);
    },
    setMode,
  };
}
