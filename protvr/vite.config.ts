import { defineConfig } from "vite";
import fs from "fs";
import path from "path";

// Procura certificados em ./certs/localhost+2.pem e localhost+2-key.pem (padrão mkcert)
const certDir = path.resolve(process.cwd(), "certs");
const certFile = path.join(certDir, "localhost+2.pem");
const keyFile = path.join(certDir, "localhost+2-key.pem");

let httpsOptions: false | { key: Buffer; cert: Buffer } = false;
try {
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    httpsOptions = {
      key: fs.readFileSync(keyFile),
      cert: fs.readFileSync(certFile),
    };
    // eslint-disable-next-line no-console
    console.log("Vite: usando HTTPS com certificados em:", certDir);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "Vite: certificados não encontrados em ./certs — iniciando em HTTP. Gere-os com mkcert e coloque em ./certs/",
    );
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn("Vite: erro ao ler certificados, iniciando em HTTP:", e);
}

export default defineConfig({
  server: {
    https: httpsOptions,
    host: true,
  },
});
