import "./MovementControls.css";
import { MoleculeStore, type TransformMode } from "../../state/MoleculeStore";

export type { TransformMode } from "../../state/MoleculeStore";

export interface MovementControlsOptions {
  store?: MoleculeStore;
  onModeChange?: (mode: TransformMode) => void;
  onScaleChange?: (scale: number) => void;
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

  // Seção de Escala Global
  const scaleSection = document.createElement("div");
  scaleSection.className = "transform-panel__scale-section";

  const scaleHeader = document.createElement("div");
  scaleHeader.className = "transform-panel__scale-header";

  const scaleLabel = document.createElement("span");
  scaleLabel.textContent = "Escala geral";

  const scaleValue = document.createElement("span");
  scaleValue.className = "transform-panel__scale-value";
  scaleValue.textContent = "1.0x (100%)";

  scaleHeader.append(scaleLabel, scaleValue);

  const scaleSlider = document.createElement("input");
  scaleSlider.type = "range";
  scaleSlider.className = "transform-panel__scale-slider";
  scaleSlider.min = String(MoleculeStore.MIN_SCALE);
  scaleSlider.max = "3.0";
  scaleSlider.step = "0.05";
  scaleSlider.value = "1.0";

  function updateScaleDisplay(scale: number) {
    scaleValue.textContent = `${scale.toFixed(2)}x (${Math.round(scale * 100)}%)`;
    scaleSlider.value = String(scale);
  }

  function handleScaleInput(scale: number) {
    if (options.onScaleChange) {
      options.onScaleChange(scale);
    } else if (options.store) {
      options.store.setGlobalScale(scale);
    }
    updateScaleDisplay(scale);
  }

  scaleSlider.addEventListener("input", () => {
    handleScaleInput(Number.parseFloat(scaleSlider.value));
  });

  const scaleActions = document.createElement("div");
  scaleActions.className = "transform-panel__scale-actions";

  const scaleMinusBtn = document.createElement("button");
  scaleMinusBtn.type = "button";
  scaleMinusBtn.className =
    "movement-panel__button transform-panel__scale-button";
  scaleMinusBtn.textContent = "-0.1x";
  scaleMinusBtn.addEventListener("click", () => {
    if (options.store) {
      options.store.adjustGlobalScale(-0.1);
    }
  });

  const scaleResetBtn = document.createElement("button");
  scaleResetBtn.type = "button";
  scaleResetBtn.className =
    "movement-panel__button transform-panel__scale-button";
  scaleResetBtn.textContent = "Resetar (1.0x)";
  scaleResetBtn.addEventListener("click", () => {
    if (options.store) {
      options.store.resetGlobalScale();
    }
  });

  const scalePlusBtn = document.createElement("button");
  scalePlusBtn.type = "button";
  scalePlusBtn.className =
    "movement-panel__button transform-panel__scale-button";
  scalePlusBtn.textContent = "+0.1x";
  scalePlusBtn.addEventListener("click", () => {
    if (options.store) {
      options.store.adjustGlobalScale(0.1);
    }
  });

  scaleActions.append(scaleMinusBtn, scaleResetBtn, scalePlusBtn);
  scaleSection.append(scaleHeader, scaleSlider, scaleActions);

  header.append(title, subtitle);
  root.append(header, status, modeRow, scaleSection);

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

    store.addEventListener("global-scale-changed", (event) => {
      updateScaleDisplay(event.detail.scale);
    });

    setSelected(store.getSelectedMoleculeName());
    setMode(store.getTransformMode());
    updateScaleDisplay(store.getGlobalScale());
  } else {
    setSelected(null);
    setMode("translate");
    updateScaleDisplay(1.0);
  }

  return {
    root,
    setSelected,
    setMode,
    setScale: updateScaleDisplay,
  };
}
