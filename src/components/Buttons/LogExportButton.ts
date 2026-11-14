import "./LogExportButton.css";

export interface LogExportButtonOptions {
  onExport: () => void;
  onExportSaved: () => void;
  getSavedCount: () => number;
}

/**
 * Botões de exportação do registro de eventos (só montados com ?log=1).
 * Componente puro: apenas repassa cliques aos callbacks recebidos.
 */
export function createLogExportButtons(options: LogExportButtonOptions) {
  const root = document.createElement("div");
  root.className = "log-export";
  root.style.display = "contents";

  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "log-export-button";
  exportButton.textContent = "Exportar log";
  exportButton.addEventListener("click", () => options.onExport());

  const savedButton = document.createElement("button");
  savedButton.type = "button";
  savedButton.className = "log-export-button";
  savedButton.addEventListener("click", () => {
    options.onExportSaved();
    refresh();
  });

  function refresh() {
    savedButton.textContent = `Logs salvos (${options.getSavedCount()})`;
  }

  exportButton.addEventListener("click", () => window.setTimeout(refresh, 0));
  refresh();

  root.append(exportButton, savedButton);
  return { root, refresh };
}
