import "./DownloadButton.css";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

export function createDownloadButton(scene: THREE.Scene, fileName = "scene") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Exportar GLTF";
  button.className = "download-button";

  button.addEventListener("click", () => {
    const exporter = new GLTFExporter();

    exporter.parse(
      scene,
      (result: object) => {
        const gltfJson = JSON.stringify(result, null, 2);
        const blob = new Blob([gltfJson], { type: "model/gltf+json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = `${fileName}.gltf`;
        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
      },
      (error: unknown) => {
        console.error("Erro ao exportar GLTF:", error);
      },
      { binary: false },
    );
  });

  return button;
}
