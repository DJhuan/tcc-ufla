import "./styles/main.css";
import { MoleculeViewer } from "./components/MoleculeViewer/MoleculeViewer";
import { createDownloadButton } from "./components/Buttons/DownloadButton";
import { createUploadMolecule } from "./components/Buttons/UploadMolecule";
import { createMoleculeList } from "./components/MoleculeViewer/MoleculeList";
import { createMovementControls } from "./components/MoleculeViewer/MovementControls";

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

const viewer = new MoleculeViewer(viewerHost);

// Botões para funções moleculares;
const uploadControl = createUploadMolecule(async (file) => {
  try {
    await viewer.loadMoleculeFromFile(file);
    syncPanels();
  } catch (error) {
    console.error("Erro ao carregar molécula enviada:", error);
  }
});

const downloadButton = createDownloadButton(viewer.scene, "scene");

const moleculeList = createMoleculeList({
  onSelect: (id) => {
    viewer.selectMolecule(id);
    syncPanels();
  },
  onRemove: (id) => {
    viewer.removeMolecule(id);
    syncPanels();
  },
});

const movementControls = createMovementControls({
  onModeChange: (mode) => {
    viewer.setTransformMode(mode);
    syncPanels();
  },
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

// Montar interface e carregar molécula inicial;
toolbar.append(uploadControl, downloadButton);
sidebar.append(moleculeList.root, movementControls.root);

function syncPanels() {
  moleculeList.render(viewer.getMolecules());
  movementControls.setSelected(viewer.getSelectedMoleculeName());
  movementControls.setMode(viewer.getTransformMode());
}

mountXRButtons();

// Carregar molécula inicial (ATP) para demonstração;
viewer
  .loadMoleculeFromUrl("/assets/ATP.pdb")
  .then(() => syncPanels())
  .catch((error: unknown) => {
    console.error("Erro ao carregar molécula inicial:", error);
  });
