import "./styles/main.css";
import { MoleculeViewer } from "./components/MoleculeViewer/MoleculeViewer";
import { createUploadMolecule } from "./components/Buttons/UploadMolecule";
import { createMoleculeList } from "./components/MoleculeViewer/MoleculeList";
import { createMovementControls } from "./components/MoleculeViewer/MovementControls";
import { createLogExportButtons } from "./components/Buttons/LogExportButton";
import { parseExperimentConfig } from "./core/ExperimentConfig";
import { EventLogger } from "./core/EventLogger";
import { FrameSampler } from "./core/FrameSampler";
import { formatLoadMetrics } from "./core/LoadMetrics";
import { SCENARIOS, SCENARIO_IDS, getScenarioUrls } from "./core/Scenarios";
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
    ? new EventLogger(
        viewer.store,
        viewer.renderer.xr,
        { experiment },
        // Fases do experimento pelo botão A/X (somente com ?perf=1);
        { phaseMarking: experiment.perf },
      )
    : null;

// Tempos de carga: sempre no console; no registro, se ativo;
viewer.setLoadMetricsListener((metrics) => {
  console.info(formatLoadMetrics(metrics));
  logger?.log("load", { ...metrics });
});

// Amostragem por quadro (somente com ?perf=1): entra no JSON em `frames`;
if (logger && experiment.perf) {
  const frameSampler = new FrameSampler(viewer.renderer);
  logger.attachFrameSampler(frameSampler);
  viewer.setFrameHook(frameSampler);
}

if (logger) {
  viewer.setInteractionObserver(logger);

  const exportCurrentLog = () => {
    void exportLog(makeLogFileName(Date.now()), logger.toJSON(), () =>
      logger.toJSON({ includeFrames: false }),
    );
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

if (experiment.invalidScenario) {
  console.warn(
    `[ProtVR] Cenário desconhecido "${experiment.invalidScenario}". ` +
      `Válidos: ${SCENARIO_IDS.join(", ")}. Carregando a molécula padrão.`,
  );
}

if (experiment.scenario) {
  // Cenário pré-carregado dos experimentos (substitui a molécula inicial);
  const scenario = SCENARIOS[experiment.scenario];
  const urls = getScenarioUrls(scenario);
  logger?.log("scenario-start", { id: scenario.id, files: scenario.files });

  viewer
    .loadMoleculesSideBySide(urls)
    .then((loaded) => {
      logger?.log("scenario-ready", {
        id: scenario.id,
        molecules: loaded.map(({ id, name }) => ({ id, name })),
      });
      console.info(`[ProtVR] Cenário ${scenario.id}: ${scenario.description}`);
    })
    .catch((error: unknown) => {
      logger?.log("scenario-error", { id: scenario.id, error: String(error) });
      console.error(`Erro ao carregar o cenário ${scenario.id}:`, error);
    });
} else {
  // Carregar molécula inicial (ATP) para demonstração;
  viewer.loadMoleculeFromUrl("/assets/ATP.pdb").catch((error: unknown) => {
    console.error("Erro ao carregar molécula inicial:", error);
  });
}
