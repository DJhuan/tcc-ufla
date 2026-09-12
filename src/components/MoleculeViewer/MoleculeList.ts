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
      const row = document.createElement("button");
      row.type = "button";
      row.className = `molecule-list__item${item.selected ? " is-selected" : ""}`;
      row.addEventListener("click", () => options.onSelect(item.id));

      const info = document.createElement("div");
      info.className = "molecule-list__item-info";

      const name = document.createElement("strong");
      name.className = "molecule-list__item-name";
      name.textContent = item.name;

      const status = document.createElement("span");
      status.className = "molecule-list__item-status";
      status.textContent = item.selected ? "Selecionada" : "Disponível";

      const actions = document.createElement("button");
      actions.type = "button";
      actions.className = "molecule-list__remove";
      actions.textContent = "Remover";
      actions.addEventListener("click", (event) => {
        event.stopPropagation();
        options.onRemove(item.id);
      });

      info.append(name, status);
      row.append(info, actions);
      list.append(row);
    }
  }

  return {
    root,
    render,
  };
}
