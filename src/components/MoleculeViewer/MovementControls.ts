import "./MovementControls.css";
import type { MoleculeStore, TransformMode } from "../../state/MoleculeStore";

export type { TransformMode } from "../../state/MoleculeStore";

export interface MovementControlsOptions {
  store?: MoleculeStore;
  onModeChange?: (mode: TransformMode) => void;
}

export function createMovementControls(options: MovementControlsOptions) {
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

  function setMode(mode: TransformMode) {
    modeButtons.forEach((button, currentMode) => {
      button.classList.toggle("is-active", currentMode === mode);
    });
  }

  function handleModeClick(mode: TransformMode) {
    if (options.onModeChange) {
      options.onModeChange(mode);
    } else if (options.store) {
      options.store.setTransformMode(mode);
    }
    setMode(mode);
  }

  function createButton(label: string, mode: TransformMode) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "movement-panel__button transform-panel__mode-button";
    button.textContent = label;
    button.addEventListener("click", () => handleModeClick(mode));
    modeButtons.set(mode, button);
    return button;
  }

  const translate = createButton("Mover", "translate");
  const rotate = createButton("Rotacionar", "rotate");

  modeRow.append(translate, rotate);
  header.append(title, subtitle);
  root.append(header, status, modeRow);

  function setSelected(name: string | null) {
    status.textContent = name
      ? `Selecionada: ${name}`
      : "Nenhuma molécula selecionada.";
    root.classList.toggle("is-disabled", !name);
  }

  if (options.store) {
    const store = options.store;

    store.addEventListener("molecule-selected", (event) => {
      setSelected(event.detail.name);
    });

    store.addEventListener("transform-mode-changed", (event) => {
      setMode(event.detail.mode);
    });

    setSelected(store.getSelectedMoleculeName());
    setMode(store.getTransformMode());
  } else {
    setSelected(null);
    setMode("translate");
  }

  return {
    root,
    setSelected,
    setMode,
  };
}
