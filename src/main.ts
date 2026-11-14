import "./styles/main.css";
import { MoleculeViewer } from "./components/MoleculeViewer/MoleculeViewer";
import { createUploadMolecule } from "./components/Buttons/UploadMolecule";
import { createMoleculeList } from "./components/MoleculeViewer/MoleculeList";
import { createMovementControls } from "./components/MoleculeViewer/MovementControls";
import { createLogExportButtons } from "./components/Buttons/LogExportButton";
import { parseExperimentConfig } from "./core/ExperimentConfig";
import { EventLogger } from "./core/EventLogger";
import { PerfSampler } from "./core/PerfSampler";
import { formatLoadMetrics } from "./core/LoadMetrics";
import {
  downloadLog,
  exportLog,
  listSavedLogs,
  makeLogFileName,
  readSavedLog,
  sendLogToDevServer,
} from "./core/LogExporter";

// Parâmetros de URL dos experimentos (ver docs/INSTRUMENTACAO.md);
const experiment = parseExperimentConfig(window.location.search);

// Criar elementos principais da interface;
const app = document.createElement("div");
app.className = "app-shell";
document.body.appendChild(app);

const toolbar = document.createElement("div");
toolbar.className = "toolbar";

const sidebar = document.createElement("div");
sidebar.className = "sidebar";

const viewerHost = document.createElement("div");
viewerHost.className = "viewer-host";

app.append(toolbar, viewerHost, sidebar);

const viewer = new MoleculeViewer(viewerHost, {
  instancing: experiment.instancing,
});

// Botões para funções moleculares;
const uploadControl = createUploadMolecule(async (file) => {
  try {
    await viewer.loadMoleculeFromFile(file);
  } catch (error) {
    console.error("Erro ao carregar molécula enviada:", error);
  }
});

// Painéis da interface acoplados reativamente ao MoleculeStore;
const moleculeList = createMoleculeList({
  store: viewer.store,
});

const movementControls = createMovementControls({
  store: viewer.store,
});

// Botões para funções de realidade estendida (VR/AR);
async function mountXRButtons() {
  try {
    const [vrButton, arButton] = await Promise.all([
      viewer.enableXR(),
      viewer.enableAR(),
    ]);

    if (vrButton) toolbar.append(vrButton);
    if (arButton) toolbar.append(arButton);
  } catch (e) {
    console.warn("WebXR não disponível:", e);
  }
}

// Montar interface;
toolbar.append(uploadControl);
sidebar.append(moleculeList.root, movementControls.root);

mountXRButtons();

const logger =
  experiment.log || experiment.perf
    ? new EventLogger(viewer.store, viewer.renderer.xr, { experiment })
    : null;

// Tempos de carga: sempre no console; no registro, se ativo;
viewer.setLoadMetricsListener((metrics) => {
  console.info(formatLoadMetrics(metrics));
  logger?.log("load", { ...metrics });
});

// Amostragem de renderer.info a cada segundo (somente com ?perf=1);
if (logger && experiment.perf) {
  viewer.setAfterRenderHook(
    new PerfSampler(viewer.renderer, logger).afterRender,
  );
}

if (logger) {
  viewer.setInteractionObserver(logger);

  const exportCurrentLog = () => {
    void exportLog(makeLogFileName(Date.now()), logger.toJSON());
  };

  const logButtons = createLogExportButtons({
    onExport: exportCurrentLog,
    onExportSaved: () => {
      for (const name of listSavedLogs()) {
        const json = readSavedLog(name);
        if (!json) continue;
        void sendLogToDevServer(name, json);
        downloadLog(name, json);
      }
    },
    getSavedCount: () => listSavedLogs().length,
  });
  // Exportação automática ao fim de cada sessão XR;
  logger.onSessionEnd = () => {
    exportCurrentLog();
    logButtons.refresh();
  };
  toolbar.append(logButtons.root);
}

// Carregar molécula inicial (ATP) para demonstração;
viewer.loadMoleculeFromUrl("/assets/ATP.pdb").catch((error: unknown) => {
  console.error("Erro ao carregar molécula inicial:", error);
});
