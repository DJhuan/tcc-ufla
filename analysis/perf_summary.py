#!/usr/bin/env python3
"""Resumo de desempenho a partir dos logs do ProtVR (formato v2, ?perf=1).

Cada JSON exportado contém as amostras por quadro (`frames`) e os eventos
(`entries`). Cenário e condição (instanciado ou não) vêm do evento
"config". As fases vêm das marcas do botão A/X:

    session-start ─ stabilization ─ phase-start{static} ─ static ─
    phase-start{interaction} ─ interaction ─ phase-end

Cada ciclo static/interaction é uma repetição. O segmento "stabilization"
vai do session-start até o primeiro phase-start{static} da sessão. Os
limites usam o `frameIndex` das marcas (mesmo relógio das amostras) e só
entram quadros com presenting = 1.

Métricas por fase:
  * FPS em janelas de 1 s (contagem de quadros; a última janela incompleta é
    descartada): média, desvio padrão e mínimo;
  * dt e cpu (ms): média e percentil 95. O dt do primeiro quadro em XR (que
    inclui a transição desktop→XR) é ignorado;
  * quadros perdidos: dt > FATOR × 1000 / frameRate (FATOR = 1,5), com a taxa
    vigente (session-start / framerate-change) ou, se o navegador não a
    informar, estimada pela mediana do dt;
  * média de calls e triangles (por quadro, soma dos dois olhos).

Saídas em --out:
  runs/<log>.csv     uma linha por repetição × fase, para cada execução
  perf_runs.csv      todas as repetições juntas
  perf_summary.csv   cenário × condição × fase: média e desvio padrão
                     entre repetições (n_reps)
  loads.csv          tempos de carga (eventos "load") de cada molécula
  loads_summary.csv  cenário × condição × molécula: média e desvio padrão

Uso:
    python perf_summary.py ../logs/protvr-log-*.json --out results/perf
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from protvr_log import ProtVRLog, load_log

FRAME_FIELDS = ["t", "dt", "cpu", "calls", "triangles", "presenting"]
PHASES = ["stabilization", "static", "interaction"]
COMMON_RATES = np.array([60.0, 72.0, 80.0, 90.0, 120.0])
METRICS = [
    "duration_s", "n_frames", "fps_mean", "fps_std", "fps_min",
    "dt_mean", "dt_p95", "cpu_mean", "cpu_p95",
    "dropped_n", "dropped_pct", "calls_mean", "triangles_mean",
]
LOAD_FIELDS = ["parseMs", "bondsMs", "buildMs", "totalMs", "readMs", "sceneMs", "firstFrameMs"]


def warn(message: str) -> None:
    print(f"aviso: {message}", file=sys.stderr)


def frames_dataframe(log: ProtVRLog) -> pd.DataFrame | None:
    frames = log.frames
    if not frames or not frames.get("count"):
        return None
    df = pd.DataFrame({f: pd.to_numeric(pd.Series(frames[f]), errors="coerce") for f in FRAME_FIELDS})
    df.index.name = "frame"
    # dt válido só se o quadro anterior também estava em XR;
    prev_presenting = df["presenting"].shift(1)
    df["dt_valid"] = (df["presenting"] == 1) & (prev_presenting == 1) & df["dt"].notna()
    return df


def resolve_index(value, count: int, label: str, log: ProtVRLog) -> int:
    if value is None or value < 0:
        warn(f"{log.path.name}: '{label}' sem frameIndex válido (buffer cheio?); usando o fim das amostras.")
        return count
    return int(value)


def segments(log: ProtVRLog, count: int) -> list[dict]:
    """Lista de {cycle, phase, start, end} com índices de quadro [start, end)."""
    out: list[dict] = []
    session_idx: int | None = None
    first_cycle_pending = False
    open_phase: dict | None = None

    def close(end: int) -> None:
        nonlocal open_phase
        if open_phase is not None:
            out.append({**open_phase, "end": end})
            open_phase = None

    for e in log.of_type("session-start", "session-end", "phase-start", "phase-end"):
        d = e["data"]
        kind = e["type"]
        if kind == "session-start":
            session_idx = resolve_index(d.get("frameIndex"), count, kind, log)
            first_cycle_pending = True
        elif kind == "phase-start":
            idx = resolve_index(d.get("frameIndex"), count, kind, log)
            close(idx)
            if d.get("phase") == "static" and first_cycle_pending and session_idx is not None:
                out.append({"cycle": d.get("cycle"), "phase": "stabilization", "start": session_idx, "end": idx})
                first_cycle_pending = False
            open_phase = {"cycle": d.get("cycle"), "phase": d.get("phase"), "start": idx}
        elif kind == "phase-end":
            close(resolve_index(d.get("frameIndex"), count, kind, log))
        elif kind == "session-end":
            close(resolve_index(d.get("frameIndex"), count, kind, log))
            session_idx = None
            first_cycle_pending = False
    close(count)
    return [s for s in out if s["end"] > s["start"]]


def refresh_rates(log: ProtVRLog, df: pd.DataFrame) -> tuple[pd.Series, str]:
    """Taxa de atualização vigente em cada quadro e a origem da informação."""
    events = []
    for e in log.of_type("session-start", "framerate-change"):
        rate, idx = e["data"].get("frameRate"), e["data"].get("frameIndex")
        if rate and idx is not None and idx >= 0:
            events.append((int(idx), float(rate)))
    if events:
        events.sort()
        starts = np.array([i for i, _ in events])
        rates = np.array([r for _, r in events])
        pos = np.searchsorted(starts, df.index.to_numpy(), side="right") - 1
        series = pd.Series(np.where(pos >= 0, rates[np.clip(pos, 0, None)], np.nan), index=df.index)
        if series[df["presenting"] == 1].notna().all():
            return series, "session"
    valid_dt = df.loc[df["dt_valid"], "dt"]
    if valid_dt.empty:
        return pd.Series(np.nan, index=df.index), "indisponível"
    estimate = COMMON_RATES[np.argmin(np.abs(COMMON_RATES - 1000.0 / valid_dt.median()))]
    warn(f"{log.path.name}: frameRate não informado; estimado em {estimate:g} Hz pela mediana do dt.")
    return pd.Series(estimate, index=df.index), "estimated"


def segment_metrics(seg: pd.DataFrame, drop_factor: float) -> dict:
    t = seg["t"].to_numpy()
    rel = t - t[0]
    n_full = int(np.floor(rel[-1] / 1000.0))
    if n_full > 0:
        windows = np.floor(rel / 1000.0).astype(int)
        counts = np.bincount(windows[windows < n_full], minlength=n_full).astype(float)
        fps_mean, fps_std, fps_min = counts.mean(), (counts.std(ddof=1) if n_full > 1 else np.nan), counts.min()
    else:
        fps_mean = fps_std = fps_min = np.nan

    valid = seg[seg["dt_valid"]]
    dt = valid["dt"]
    threshold = drop_factor * 1000.0 / valid["rate"]
    dropped = int((dt > threshold).sum())

    return {
        "duration_s": rel[-1] / 1000.0,
        "n_frames": len(seg),
        "n_windows": n_full,
        "fps_mean": fps_mean,
        "fps_std": fps_std,
        "fps_min": fps_min,
        "dt_mean": dt.mean(),
        "dt_p95": dt.quantile(0.95) if len(dt) else np.nan,
        "cpu_mean": seg["cpu"].mean(),
        "cpu_p95": seg["cpu"].quantile(0.95),
        "dropped_n": dropped,
        "dropped_pct": 100.0 * dropped / len(dt) if len(dt) else np.nan,
        "refresh_hz": seg["rate"].mode().iloc[0] if seg["rate"].notna().any() else np.nan,
        "calls_mean": seg["calls"].mean(),
        "triangles_mean": seg["triangles"].mean(),
    }


def condition_label(instancing) -> str:
    if instancing is None:
        return "desconhecida"
    return "instanced" if instancing else "non-instanced"


def analyse_log(path: Path, drop_factor: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    log = load_log(path)
    scenario = log.scenario or "sem-cenario"
    instancing = log.instancing
    base = {"file": path.name, "scenario": scenario, "instancing": instancing,
            "condition": condition_label(instancing)}

    loads = pd.DataFrame([
        {**base, "name": e["data"].get("name"), "atoms": e["data"].get("atoms"),
         "bonds": e["data"].get("bonds"), "meshes": e["data"].get("meshes"),
         **{f: e["data"].get(f) for f in LOAD_FIELDS}}
        for e in log.of_type("load")
    ])

    df = frames_dataframe(log)
    if df is None:
        warn(f"{path.name}: sem amostras por quadro (log v{log.version} ou sem ?perf=1); só tempos de carga.")
        return pd.DataFrame(), loads
    if log.of_type("perf-buffer-full"):
        warn(f"{path.name}: o buffer de quadros encheu; o fim da execução não foi gravado.")

    df["rate"], rate_source = refresh_rates(log, df)
    rows = []
    for s in segments(log, len(df)):
        seg = df.iloc[s["start"]:s["end"]]
        seg = seg[seg["presenting"] == 1]
        if len(seg) < 2:
            warn(f"{path.name}: ciclo {s['cycle']} fase {s['phase']} sem quadros em XR suficientes; ignorado.")
            continue
        rows.append({**base, "cycle": s["cycle"], "phase": s["phase"],
                     "frame_start": s["start"], "frame_end": s["end"],
                     "refresh_source": rate_source, **segment_metrics(seg, drop_factor)})
    if not rows:
        warn(f"{path.name}: nenhuma fase marcada (botão A/X) encontrada.")
    return pd.DataFrame(rows), loads


def aggregate(df: pd.DataFrame, keys: list[str], metrics: list[str], count_name: str) -> pd.DataFrame:
    grouped = df.groupby(keys, dropna=False, sort=True)
    out = grouped.size().rename(count_name).to_frame()
    for m in metrics:
        out[f"{m}_mean"] = grouped[m].mean()
        out[f"{m}_std"] = grouped[m].std(ddof=1)
    return out.reset_index()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("logs", type=Path, nargs="+", help="JSONs exportados pelo ProtVR (?perf=1)")
    parser.add_argument("--out", type=Path, default=Path("results/perf"), help="pasta de saída")
    parser.add_argument("--drop-factor", type=float, default=1.5,
                        help="quadro perdido se dt > FATOR × intervalo nominal (padrão: 1.5)")
    args = parser.parse_args()

    (args.out / "runs").mkdir(parents=True, exist_ok=True)
    all_runs, all_loads = [], []
    for path in args.logs:
        runs, loads = analyse_log(path, args.drop_factor)
        if not runs.empty:
            runs.to_csv(args.out / "runs" / f"{path.stem}.csv", index=False, float_format="%.4f")
            all_runs.append(runs)
            print(f"{path.name}: {runs['scenario'].iloc[0]} / {runs['condition'].iloc[0]} → "
                  f"{runs['cycle'].nunique()} repetição(ões), {len(runs)} linhas")
        if not loads.empty:
            all_loads.append(loads)

    if all_runs:
        runs_df = pd.concat(all_runs, ignore_index=True)
        runs_df["phase"] = pd.Categorical(runs_df["phase"], PHASES, ordered=True)
        runs_df.to_csv(args.out / "perf_runs.csv", index=False, float_format="%.4f")
        summary = aggregate(runs_df, ["scenario", "condition", "phase"], METRICS, "n_reps")
        summary = summary[summary["n_reps"] > 0]
        summary.to_csv(args.out / "perf_summary.csv", index=False, float_format="%.4f")
        cols = ["scenario", "condition", "phase", "n_reps", "fps_mean_mean", "fps_min_mean",
                "dt_p95_mean", "cpu_mean_mean", "dropped_pct_mean", "calls_mean_mean"]
        with pd.option_context("display.width", 200, "display.max_columns", None):
            print(summary[cols].round(2).to_string(index=False))
        reps = summary[summary["phase"] != "stabilization"]["n_reps"]
        if len(reps) and (reps != 3).any():
            warn("há combinações com número de repetições diferente de 3 (veja n_reps).")
    else:
        warn("nenhuma fase encontrada em nenhum log; perf_summary.csv não gerado.")

    if all_loads:
        loads_df = pd.concat(all_loads, ignore_index=True)
        loads_df.to_csv(args.out / "loads.csv", index=False, float_format="%.3f")
        aggregate(loads_df, ["scenario", "condition", "name"], ["parseMs", "bondsMs", "buildMs", "totalMs"], "n").to_csv(
            args.out / "loads_summary.csv", index=False, float_format="%.3f")

    print(f"resultados em {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
