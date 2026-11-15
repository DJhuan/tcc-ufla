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

export type LocalSaveResult = "full" | "entries-only" | "failed";

/** Nome da cópia reduzida (sem `frames`), para não sobrescrever o log completo. */
export function entriesOnlyName(fileName: string): string {
  return fileName.replace(/\.json$/, "-entries.json");
}

function trySetItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`[ProtVR-log] Falha ao salvar ${key} no localStorage:`, error);
    return false;
  }
}

/**
 * (A) Salva no localStorage (~5 MB por origem). Se o log completo não
 * couber (as amostras por quadro ocupam a maior parte), tenta salvar a
 * versão reduzida `fallback()` (só `entries`) com o sufixo "-entries".
 */
export function saveLogToLocalStorage(
  fileName: string,
  json: string,
  fallback?: () => string,
): LocalSaveResult {
  if (trySetItem(fileName, json)) return "full";
  if (fallback && trySetItem(entriesOnlyName(fileName), fallback())) {
    return "entries-only";
  }
  return "failed";
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

/**
 * Executa (A), (C) e (B) para um registro. `entriesOnly` gera a versão sem
 * `frames`, usada só se o log completo não couber no localStorage.
 */
export async function exportLog(
  fileName: string,
  json: string,
  entriesOnly?: () => string,
): Promise<void> {
  const stored = saveLogToLocalStorage(fileName, json, entriesOnly);
  const sent = await sendLogToDevServer(fileName, json);
  downloadLog(fileName, json);
  const sizeMB = (json.length / 1048576).toFixed(2);
  const storedText =
    stored === "full"
      ? "ok"
      : stored === "entries-only"
        ? "só entries (log completo não coube)"
        : "falhou";
  console.info(
    `[ProtVR-log] ${fileName} (${sizeMB} MB): localStorage=${storedText}, ` +
      `servidor=${sent ? "ok" : "indisponível"}, download disparado.`,
  );
}
