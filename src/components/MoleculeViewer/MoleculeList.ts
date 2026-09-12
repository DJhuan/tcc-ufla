import "./MoleculeList.css";

export type MoleculeListItem = {
  id: string;
  name: string;
  selected: boolean;
};

export function createMoleculeList(options: {
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const root = document.createElement("section");
  root.className = "molecule-panel molecule-list";

  const header = document.createElement("div");
  header.className = "molecule-panel__header";

  const title = document.createElement("h2");
  title.className = "molecule-panel__title";
  title.textContent = "Moléculas";

  const subtitle = document.createElement("p");
  subtitle.className = "molecule-panel__subtitle";
  subtitle.textContent = "Selecione uma molécula para mover ou remover.";

  const list = document.createElement("div");
  list.className = "molecule-list__items";

  const emptyState = document.createElement("div");
  emptyState.className = "molecule-list__empty";
  emptyState.textContent = "Nenhuma molécula adicionada ainda.";

  header.append(title, subtitle);
  root.append(header, list);

  function render(items: MoleculeListItem[]) {
    list.replaceChildren();

    if (items.length === 0) {
      list.append(emptyState);
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = `molecule-list__item${item.selected ? " is-selected" : ""}`;
      row.setAttribute("role", "listitem");

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "molecule-list__select-btn";
      selectBtn.setAttribute("aria-pressed", item.selected ? "true" : "false");
      selectBtn.addEventListener("click", () => options.onSelect(item.id));

      const info = document.createElement("div");
      info.className = "molecule-list__item-info";

      const name = document.createElement("strong");
      name.className = "molecule-list__item-name";
      name.textContent = item.name;

      const status = document.createElement("span");
      status.className = "molecule-list__item-status";
      status.textContent = item.selected ? "Selecionada" : "Disponível";

      info.append(name, status);
      selectBtn.append(info);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "molecule-list__remove";
      removeBtn.textContent = "Remover";
      removeBtn.setAttribute("aria-label", `Remover ${item.name}`);
      removeBtn.addEventListener("click", () => options.onRemove(item.id));

      row.append(selectBtn, removeBtn);
      list.append(row);
    }
  }

  return {
    root,
    render,
  };
}
