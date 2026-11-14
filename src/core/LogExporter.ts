/**
 * Saídas do registro de eventos:
 *  (A) localStorage do navegador (rede de segurança no próprio dispositivo);
 *  (B) download do arquivo JSON;
 *  (C) POST para o servidor de desenvolvimento do Vite (grava em ./logs/
 *      no computador que serve a aplicação). Só existe em `npm run dev`.
 */

export const LOG_STORAGE_PREFIX = "protvr-log-";
export const DEV_LOG_ENDPOINT = "/__protvr/log";

export function makeLogFileName(epochMs: number): string {
  const stamp = new Date(epochMs).toISOString().replace(/[:.]/g, "-");
  return `${LOG_STORAGE_PREFIX}${stamp}.json`;
}

/** (A) Retorna false se o armazenamento falhar (ex.: cota excedida). */
export function saveLogToLocalStorage(fileName: string, json: string): boolean {
  try {
    window.localStorage.setItem(fileName, json);
    return true;
  } catch (error) {
    console.warn("[ProtVR-log] Falha ao salvar no localStorage:", error);
    return false;
  }
}

export function listSavedLogs(): string[] {
  const names: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(LOG_STORAGE_PREFIX)) names.push(key);
    }
  } catch {
    // localStorage indisponível;
  }
  return names.sort();
}

export function readSavedLog(fileName: string): string | null {
  try {
    return window.localStorage.getItem(fileName);
  } catch {
    return null;
  }
}

/** (B) */
export function downloadLog(fileName: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revogar com atraso: alguns navegadores (Quest Browser incluso) ainda
  // estão lendo o blob logo após o clique;
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** (C) Retorna true se o servidor de desenvolvimento gravou o arquivo. */
export async function sendLogToDevServer(
  fileName: string,
  json: string,
): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const response = await fetch(
      `${DEV_LOG_ENDPOINT}?name=${encodeURIComponent(fileName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      },
    );
    return response.ok;
  } catch (error) {
    console.warn("[ProtVR-log] Falha ao enviar ao servidor de dev:", error);
    return false;
  }
}

/** Executa (A), (C) e (B) para um registro. */
export async function exportLog(fileName: string, json: string): Promise<void> {
  const stored = saveLogToLocalStorage(fileName, json);
  const sent = await sendLogToDevServer(fileName, json);
  downloadLog(fileName, json);
  console.info(
    `[ProtVR-log] ${fileName}: localStorage=${stored ? "ok" : "falhou"}, ` +
      `servidor=${sent ? "ok" : "indisponível"}, download disparado.`,
  );
}
