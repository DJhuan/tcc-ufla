#!/usr/bin/env python3
"""Resumo de desempenho a partir dos CSVs do OVR Metrics Tool + logs do ProtVR.

Entrada principal: um manifesto CSV, uma linha por execução (gravação):

    ovr_csv,log,scenario,instancing
    ovr/c1_inst.csv,logs/protvr-log-...json,,
    ovr/c3_mesh.csv,,c3,0

* `ovr_csv` (obrigatório): CSV exportado pelo OVR Metrics Tool;
* `log` (opcional): JSON do ProtVR da mesma execução. Fornece cenário e
  condição (se as colunas ficarem vazias), recorta as amostras do OVR à
  sessão XR quando os horários são de época e acrescenta tempo de carga
  e chamadas de desenho (eventos "load" e "perf");
* `scenario` / `instancing` (opcionais se houver log): sobrescrevem o log.
Caminhos relativos são resolvidos a partir da pasta do manifesto.

Para cada (cenário, instancing), concatena as amostras de todas as
execuções e calcula média, desvio padrão e mínimo do FPS e do tempo de
GPU, e o percentual de amostras com FPS abaixo da taxa alvo (--target-hz,
padrão 72).

Nomes de colunas do OVR Metrics Tool: NÃO CONFIRMADOS. O mapeamento
padrão (DEFAULT_COLUMNS) tenta vários nomes candidatos; confira os nomes
reais com `--list-columns arquivo.csv` e, se necessário, passe um JSON
com `--columns map.json`, por exemplo:
    {"fps": "FPS", "gpu_time": "App GPU Time", "gpu_time_unit": "us",
     "timestamp": "Time Stamp", "timestamp_unit": "ms"}

Uso:
    python perf_summary.py --manifest runs.csv --out results/perf_summary.csv
    python perf_summary.py --list-columns ovr/c1_inst.csv
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import pandas as pd

from protvr_log import ProtVRLog, load_log

# Candidatos (comparação sem diferenciar maiúsculas/minúsculas e espaços).
DEFAULT_COLUMNS: dict[str, object] = {
    "fps": ["FPS", "Frame Rate", "fps"],
    "gpu_time": ["App GPU Time", "App GPU Time (us)", "App GPU Time µs", "GPU Time", "app_gpu_time"],
    # "auto": deduz pela unidade no nome da coluna (us/µs/ms) ou pela magnitude.
    "gpu_time_unit": "auto",
    "timestamp": ["Time Stamp", "Timestamp", "Time", "time_ms"],
    # "auto": época em s/ms/µs pela magnitude; valores pequenos = relativos.
    "timestamp_unit": "auto",
}


def norm(name: str) -> str:
    return "".join(name.lower().split())


def resolve_column(df: pd.DataFrame, spec: object, required: bool, key: str) -> str | None:
    candidates = [spec] if isinstance(spec, str) else list(spec or [])
    by_norm = {norm(c): c for c in df.columns}
    for cand in candidates:
        if cand in df.columns:
            return cand
        if norm(cand) in by_norm:
            return by_norm[norm(cand)]
    # Último recurso: coluna cujo nome contém o candidato.
    for cand in candidates:
        for col in df.columns:
            if norm(cand) in norm(col):
                return col
    if required:
        raise KeyError(
            f"coluna para '{key}' não encontrada (candidatos: {candidates}). "
            f"Colunas do arquivo: {list(df.columns)}. Ajuste com --columns."
        )
    return None


def gpu_time_to_ms(series: pd.Series, column: str, unit: str) -> pd.Series:
    if unit == "auto":
        lowered = column.lower()
        if "µs" in lowered or "us)" in lowered or lowered.endswith(" us") or "micro" in lowered:
            unit = "us"
        elif "ms" in lowered:
            unit = "ms"
        else:
            unit = "us" if series.median() > 1000 else "ms"
            print(f"aviso: unidade de '{column}' deduzida pela magnitude: {unit}", file=sys.stderr)
    factor = {"us": 1e-3, "ms": 1.0, "s": 1e3, "ns": 1e-6}[unit]
    return series * factor


def timestamps_to_epoch_ms(series: pd.Series, unit: str) -> pd.Series | None:
    """Converte para ms de época; None se os horários forem relativos."""
    values = pd.to_numeric(series, errors="coerce")
    if values.isna().all():
        parsed = pd.to_datetime(series, errors="coerce")
        if parsed.isna().all():
            return None
        return parsed.astype("int64") / 1e6
    if unit == "auto":
        median = values.median()
        if median > 1e14:
            unit = "us"
        elif median > 1e11:
            unit = "ms"
        elif median > 1e8:
            unit = "s"
        else:
            return None
    factor = {"us": 1e-3, "ms": 1.0, "s": 1e3}[unit]
    return values * factor


def read_ovr(path: Path, columns: dict, log: ProtVRLog | None, trim_start: float, trim_end: float) -> pd.DataFrame:
    df = pd.read_csv(path)
    fps_col = resolve_column(df, columns["fps"], True, "fps")
    gpu_col = resolve_column(df, columns["gpu_time"], False, "gpu_time")
    ts_col = resolve_column(df, columns["timestamp"], False, "timestamp")

    out = pd.DataFrame({"fps": pd.to_numeric(df[fps_col], errors="coerce")})
    out["gpu_ms"] = (
        gpu_time_to_ms(pd.to_numeric(df[gpu_col], errors="coerce"), gpu_col, str(columns["gpu_time_unit"]))
        if gpu_col else math.nan
    )

    epoch = timestamps_to_epoch_ms(df[ts_col], str(columns["timestamp_unit"])) if ts_col else None
    if epoch is not None and log is not None:
        sessions = log.session_intervals()
        if sessions:
            inside = pd.Series(False, index=df.index)
            for start, end in sessions:
                inside |= (epoch >= start) & (epoch <= end)
            if inside.any():
                out = out[inside]
                epoch = epoch[inside]
            else:
                print(f"aviso: {path.name}: nenhuma amostra dentro das sessões XR do log; usando todas.", file=sys.stderr)

    if trim_start > 0 or trim_end > 0:
        if epoch is not None:
            rel = (epoch - epoch.min()) / 1000.0
        else:
            rel = pd.Series(range(len(out)), index=out.index, dtype=float)  # ~1 amostra/s
        keep = (rel >= trim_start) & (rel <= rel.max() - trim_end)
        out = out[keep]

    return out.dropna(subset=["fps"])


def log_extras(log: ProtVRLog | None) -> dict:
    if log is None:
        return {}
    loads = log.of_type("load")
    ready = [e["t"] for e in log.of_type("scenario-ready")]
    if ready:
        loads = [e for e in loads if e["t"] <= ready[0]]
    perf = [e["data"] for e in log.of_type("perf") if e["data"].get("presenting")]
    extras: dict = {}
    if loads:
        extras["load_total_ms"] = sum(e["data"]["totalMs"] for e in loads)
        first = [e["data"].get("firstFrameMs") for e in loads if e["data"].get("firstFrameMs") is not None]
        extras["load_first_frame_ms"] = sum(first) if first else math.nan
        extras["atoms"] = sum(e["data"]["atoms"] for e in loads)
        extras["meshes"] = sum(e["data"]["meshes"] for e in loads)
    if perf:
        extras["draw_calls_mean"] = sum(p["calls"] for p in perf) / len(perf)
        extras["triangles_mean"] = sum(p["triangles"] for p in perf) / len(perf)
        extras["app_fps_mean"] = sum(p["fps"] for p in perf) / len(perf)
    return extras


def parse_instancing(value: object) -> bool | None:
    if value is None or (isinstance(value, float) and math.isnan(value)) or str(value).strip() == "":
        return None
    return str(value).strip().lower() in {"1", "true", "sim", "yes", "inst", "instanced"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, help="CSV com as execuções (ovr_csv, log, scenario, instancing)")
    parser.add_argument("--target-hz", type=float, default=72.0, help="taxa de atualização alvo (padrão: 72)")
    parser.add_argument("--columns", type=Path, help="JSON com o mapeamento de colunas do OVR Metrics Tool")
    parser.add_argument("--trim-start", type=float, default=0.0, help="segundos descartados no início de cada execução")
    parser.add_argument("--trim-end", type=float, default=0.0, help="segundos descartados no fim de cada execução")
    parser.add_argument("--out", type=Path, default=Path("results/perf_summary.csv"))
    parser.add_argument("--list-columns", type=Path, metavar="CSV", help="só lista as colunas de um CSV do OVR e sai")
    args = parser.parse_args()

    if args.list_columns:
        df = pd.read_csv(args.list_columns, nrows=5)
        for col in df.columns:
            print(f"{col!r}: ex. {df[col].iloc[0] if len(df) else ''}")
        return 0
    if not args.manifest:
        parser.error("--manifest é obrigatório (ou use --list-columns).")

    columns = dict(DEFAULT_COLUMNS)
    if args.columns:
        columns.update(json.loads(args.columns.read_text(encoding="utf-8")))

    manifest = pd.read_csv(args.manifest, dtype=str, keep_default_na=False)
    base = args.manifest.parent
    samples, runs = [], []

    for i, row in manifest.iterrows():
        ovr_path = base / row["ovr_csv"]
        log = load_log(base / row["log"]) if row.get("log") else None

        scenario = row.get("scenario") or (log.scenario if log else None)
        instancing = parse_instancing(row.get("instancing"))
        if instancing is None and log is not None:
            instancing = log.instancing
        if not scenario or instancing is None:
            print(f"erro: linha {i + 2}: cenário/instancing indefinidos (preencha o manifesto ou informe o log).", file=sys.stderr)
            return 1

        data = read_ovr(ovr_path, columns, log, args.trim_start, args.trim_end)
        data["scenario"] = scenario
        data["instancing"] = int(instancing)
        samples.append(data)
        runs.append({"scenario": scenario, "instancing": int(instancing), **log_extras(log)})
        print(f"{ovr_path.name}: {scenario} instancing={int(instancing)} → {len(data)} amostras")

    all_samples = pd.concat(samples, ignore_index=True)
    runs_df = pd.DataFrame(runs)

    rows = []
    for (scenario, instancing), group in all_samples.groupby(["scenario", "instancing"], sort=True):
        fps, gpu = group["fps"], group["gpu_ms"]
        run_group = runs_df[(runs_df["scenario"] == scenario) & (runs_df["instancing"] == instancing)]
        row = {
            "scenario": scenario,
            "instancing": instancing,
            "n_runs": len(run_group),
            "n_samples": len(group),
            "fps_mean": fps.mean(),
            "fps_std": fps.std(ddof=1),
            "fps_min": fps.min(),
            "gpu_ms_mean": gpu.mean(),
            "gpu_ms_std": gpu.std(ddof=1),
            "gpu_ms_min": gpu.min(),
            "gpu_ms_max": gpu.max(),
            "target_hz": args.target_hz,
            "pct_below_target": 100.0 * (fps < args.target_hz).mean(),
        }
        for extra in ("load_total_ms", "load_first_frame_ms", "atoms", "meshes", "draw_calls_mean", "triangles_mean", "app_fps_mean"):
            if extra in run_group:
                row[extra] = run_group[extra].mean()
        rows.append(row)

    summary = pd.DataFrame(rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    summary.to_csv(args.out, index=False, float_format="%.3f")
    with pd.option_context("display.max_columns", None, "display.width", 200):
        print(summary.round(2).to_string(index=False))
    print(f"tabela → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
