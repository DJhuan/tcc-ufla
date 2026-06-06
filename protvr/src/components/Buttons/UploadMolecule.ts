import "./UploadMolecule.css";

export function createUploadMolecule(
  onFileSelected: (file: File) => void,
  labelText = "Carregar PDB",
) {
  const wrapper = document.createElement("label");
  wrapper.className = "upload-control";

  const text = document.createElement("span");
  text.textContent = labelText;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdb,.ent,.txt";
  input.className = "upload-control__input";

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) {
      onFileSelected(file);
      input.value = "";
    }
  });

  wrapper.append(text, input);
  return wrapper;
}
