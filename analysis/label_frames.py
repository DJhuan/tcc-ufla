#!/usr/bin/env python3
"""Rotula cada quadro com o estado de interação (E1–E5) lido do log.

Alinhamento dos relógios: o instante do primeiro evento "sync" do log
(toque no botão B/Y) é casado com o instante do mesmo toque no vídeo,
informado manualmente em --sync-video-time (segundos desde o início do
vídeo). Para cada quadro:

    epoch_ms = t_sync_log + (video_time_s - sync_video_time) * 1000

Regras:
  * só entram quadros dentro de uma sessão XR (entre session-start e
    session-end), já que fora dela o vídeo mostra o navegador 2D;
  * o estado de um quadro é o do último evento "state" anterior a ele;
  * quadros a menos de --guard segundos (padrão 0,5) de uma mudança de
    estado, ou do início/fim de sessão, são descartados;
  * balanceamento: sorteia o mesmo número de quadros por estado
    (o mínimo entre os estados presentes, ou --per-state), com semente fixa.

Saídas:
    labels.csv              quadros balanceados (entrada do clip_eval.py)
    labels_unbalanced.csv   todos os quadros válidos antes do sorteio

Uso:
    python label_frames.py --video m1.mp4 --frames frames/m1 \\
        --log logs/protvr-log-....json --sync-video-time 12.4 --out labels/m1
"""

from __future__ import annotations

import argparse
import bisect
import json
import subprocess
import sys
from pathlib import Path

import pandas as pd

from protvr_log import STATES, load_log


def probe_duration(video: Path) -> float | None:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(video)],
            check=True, capture_output=True, text=True,
        )
        return float(json.loads(result.stdout)["format"]["duration"])
    except Exception:  # noqa: BLE001 - verificação opcional
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--video", type=Path, help="vídeo original (usado só para conferir a duração)")
    parser.add_argument("--frames", type=Path, required=True, help="pasta gerada pelo extract_frames.py (com frames.csv)")
    parser.add_argument("--log", type=Path, required=True, help="JSON do log (protvr-log-*.json)")
    parser.add_argument("--sync-video-time", type=float, required=True, help="instante (s) do toque de sync no vídeo")
    parser.add_argument("--sync-index", type=int, default=0, help="qual evento sync usar (0 = primeiro; padrão: 0)")
    parser.add_argument("--condition", help="rótulo da condição (m1/m2); padrão: cenário registrado no log")
    parser.add_argument("--guard", type=float, default=0.5, help="margem (s) em torno de mudanças de estado (padrão: 0.5)")
    parser.add_argument("--per-state", type=int, help="quadros por estado (padrão: mínimo entre os estados presentes)")
    parser.add_argument("--seed", type=int, default=42, help="semente do sorteio (padrão: 42)")
    parser.add_argument("--out", type=Path, required=True, help="pasta de saída")
    args = parser.parse_args()

    log = load_log(args.log)
    frames_csv = args.frames / "frames.csv"
    if not frames_csv.is_file():
        print(f"erro: {frames_csv} não encontrado (rode extract_frames.py antes).", file=sys.stderr)
        return 1
    frames = pd.read_csv(frames_csv)

    syncs = log.sync_times()
    if len(syncs) <= args.sync_index:
        print(f"erro: o log tem {len(syncs)} evento(s) sync; --sync-index={args.sync_index}.", file=sys.stderr)
        return 1
    t_sync = syncs[args.sync_index]

    condition = args.condition or log.scenario or "desconhecida"

    if args.video is not None:
        duration = probe_duration(args.video)
        last = float(frames["video_time_s"].max())
        if duration is not None and last > duration + 1:
            print(f"aviso: último quadro em {last:.1f}s, mas o vídeo tem {duration:.1f}s.", file=sys.stderr)

    changes = log.state_changes()
    if not changes:
        print("erro: o log não tem eventos 'state'.", file=sys.stderr)
        return 1
    change_times = [t for t, _ in changes]
    sessions = log.session_intervals()
    if not sessions:
        print("erro: o log não tem nenhuma sessão XR (session-start).", file=sys.stderr)
        return 1

    # Instantes "sensíveis": mudanças de estado e limites de sessão.
    boundaries = sorted(change_times + [t for s in sessions for t in s])
    guard_ms = args.guard * 1000.0

    frames["epoch_ms"] = t_sync + (frames["video_time_s"] - args.sync_video_time) * 1000.0
    frames["file"] = [str((args.frames / f).resolve()) for f in frames["file"]]

    states, distances, reasons = [], [], []
    for epoch in frames["epoch_ms"]:
        in_session = any(start <= epoch <= end for start, end in sessions)
        idx = bisect.bisect_right(change_times, epoch) - 1
        state = changes[idx][1] if idx >= 0 else None

        j = bisect.bisect_left(boundaries, epoch)
        near = [abs(epoch - boundaries[k]) for k in (j - 1, j) if 0 <= k < len(boundaries)]
        dist = min(near) / 1000.0 if near else float("inf")

        if not in_session:
            reason = "fora-da-sessao"
        elif state is None:
            reason = "sem-estado"
        elif dist * 1000.0 < guard_ms:
            reason = "perto-de-mudanca"
        else:
            reason = ""
        states.append(state)
        distances.append(round(dist, 3))
        reasons.append(reason)

    frames["state"] = states
    frames["dist_to_change_s"] = distances
    frames["discard_reason"] = reasons
    frames["condition"] = condition

    print(f"condição: {condition} | sync do log em {t_sync:.0f} ms ↔ {args.sync_video_time:.3f} s no vídeo")
    print("descartes:", frames["discard_reason"].replace("", "mantido").value_counts().to_dict())

    valid = frames[frames["discard_reason"] == ""].drop(columns=["discard_reason"])
    counts = valid["state"].value_counts().reindex(STATES, fill_value=0)
    print("quadros válidos por estado:", counts.to_dict())

    present = [s for s in STATES if counts[s] > 0]
    missing = [s for s in STATES if counts[s] == 0]
    if missing:
        print(f"aviso: estados sem nenhum quadro válido: {', '.join(missing)}", file=sys.stderr)
    if not present:
        print("erro: nenhum quadro válido.", file=sys.stderr)
        return 1

    per_state = args.per_state if args.per_state is not None else int(counts[present].min())
    parts = []
    for state in present:
        pool = valid[valid["state"] == state]
        n = min(per_state, len(pool))
        if n < per_state:
            print(f"aviso: {state} tem só {len(pool)} quadros (< {per_state}); usando todos.", file=sys.stderr)
        parts.append(pool.sample(n=n, random_state=args.seed))
    balanced = pd.concat(parts).sort_values("frame")

    args.out.mkdir(parents=True, exist_ok=True)
    columns = ["frame", "file", "video_time_s", "epoch_ms", "state", "condition", "dist_to_change_s"]
    valid[columns].to_csv(args.out / "labels_unbalanced.csv", index=False)
    balanced[columns].to_csv(args.out / "labels.csv", index=False)
    print(f"{len(balanced)} quadros balanceados ({per_state} por estado) → {args.out / 'labels.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
