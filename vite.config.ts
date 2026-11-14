import { defineConfig, type Plugin } from "vite";
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

/**
 * Receptor de logs da instrumentação (?log=1), apenas em `npm run dev`.
 * O Quest envia POST /__protvr/log?name=protvr-log-<timestamp>.json e o
 * arquivo é gravado em ./logs/ no computador que serve a aplicação.
 */
function protvrLogSink(): Plugin {
  const logDir = path.resolve(process.cwd(), "logs");
  const maxBytes = 64 * 1024 * 1024;
  const validName = /^protvr-log-[A-Za-z0-9-]+\.json$/;

  return {
    name: "protvr-log-sink",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__protvr/log", (req, res, next) => {
        if (req.method !== "POST") return next();

        const name = new URL(req.url ?? "/", "http://localhost").searchParams.get(
          "name",
        );
        if (!name || !validName.test(name)) {
          res.statusCode = 400;
          res.end("nome de arquivo inválido");
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let aborted = false;

        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            aborted = true;
            res.statusCode = 413;
            res.end("log grande demais");
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });

        req.on("end", () => {
          if (aborted) return;
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            JSON.parse(body); // valida antes de gravar
            fs.mkdirSync(logDir, { recursive: true });
            fs.writeFileSync(path.join(logDir, name), body);
            // eslint-disable-next-line no-console
            console.log(`[ProtVR-log] gravado logs/${name} (${size} bytes)`);
            res.statusCode = 204;
            res.end();
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [protvrLogSink()],
  server: {
    https: httpsOptions,
    host: true,
  },
});
