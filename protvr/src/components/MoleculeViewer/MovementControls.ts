import "./MovementControls.css";

export function createMovementControls(options: {
  onMove: (delta: { x: number; y: number; z: number }) => void;
}) {
  const root = document.createElement("section");
  root.className = "molecule-panel movement-panel";

  const header = document.createElement("div");
  header.className = "molecule-panel__header";

  const title = document.createElement("h2");
  title.className = "molecule-panel__title";
  title.textContent = "Mover molécula";

  const subtitle = document.createElement("p");
  subtitle.className = "molecule-panel__subtitle";
  subtitle.textContent = "Use os botões para deslocar a molécula selecionada.";

  const status = document.createElement("div");
  status.className = "movement-panel__status";
  status.textContent = "Nenhuma molécula selecionada.";

  const stepRow = document.createElement("label");
  stepRow.className = "movement-panel__step";

  const stepLabel = document.createElement("span");
  stepLabel.textContent = "Passo";

  const stepInput = document.createElement("input");
  stepInput.type = "number";
  stepInput.min = "0.1";
  stepInput.step = "0.1";
  stepInput.value = "0.5";

  stepRow.append(stepLabel, stepInput);

  const pad = document.createElement("div");
  pad.className = "movement-panel__pad";

  function move(dx: number, dy: number, dz: number) {
    const step = Number(stepInput.value) || 0.5;
    options.onMove({ x: dx * step, y: dy * step, z: dz * step });
  }

  function createButton(label: string, dx: number, dy: number, dz: number) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "movement-panel__button";
    button.textContent = label;
    button.addEventListener("click", () => move(dx, dy, dz));
    return button;
  }

  const up = createButton("↑", 0, 1, 0);
  const down = createButton("↓", 0, -1, 0);
  const left = createButton("←", -1, 0, 0);
  const right = createButton("→", 1, 0, 0);
  const forward = createButton("+Z", 0, 0, 1);
  const back = createButton("-Z", 0, 0, -1);

  pad.append(up, left, right, down, forward, back);
  header.append(title, subtitle);
  root.append(header, status, stepRow, pad);

  return {
    root,
    setSelected(name: string | null) {
      status.textContent = name
        ? `Movendo: ${name}`
        : "Nenhuma molécula selecionada.";
      root.classList.toggle("is-disabled", !name);
    },
  };
}
