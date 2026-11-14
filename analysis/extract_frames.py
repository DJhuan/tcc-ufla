#!/usr/bin/env python3
"""Extrai quadros de um vídeo do Quest a N fps com o ffmpeg.

Saída (em --out):
    frame_000000.jpg, frame_000001.jpg, ...
    frames.csv  →  frame,file,video_time_s

`video_time_s` é o instante do quadro em relação ao início do vídeo,
lido do próprio ffmpeg (filtro showinfo), descontado o start_time do
contêiner.

Uso:
    python extract_frames.py gravacao.mp4 --out frames/m1 --fps 2
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

PTS_RE = re.compile(r"\bn:\s*(\d+).*?\bpts_time:\s*([-\d.]+)")


def probe_start_time(video: Path) -> float:
    """start_time do contêiner (s); 0 se ausente."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=start_time",
            "-of", "json", str(video),
        ],
        check=True, capture_output=True, text=True,
    )
    value = json.loads(result.stdout).get("format", {}).get("start_time")
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", type=Path, help="arquivo de vídeo (ex.: .mp4 do Quest)")
    parser.add_argument("--out", type=Path, required=True, help="pasta de saída dos quadros")
    parser.add_argument("--fps", type=float, default=2.0, help="quadros por segundo (padrão: 2)")
    parser.add_argument("--quality", type=int, default=2, help="qualidade JPEG do ffmpeg, 2 (melhor) a 31 (padrão: 2)")
    parser.add_argument("--overwrite", action="store_true", help="apaga quadros existentes em --out")
    args = parser.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            print(f"erro: '{tool}' não encontrado no PATH.", file=sys.stderr)
            return 1
    if not args.video.is_file():
        print(f"erro: vídeo não encontrado: {args.video}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    existing = list(args.out.glob("frame_*.jpg"))
    if existing:
        if not args.overwrite:
            print(f"erro: {args.out} já contém quadros; use --overwrite.", file=sys.stderr)
            return 1
        for f in existing:
            f.unlink()

    start_time = probe_start_time(args.video)

    cmd = [
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(args.video),
        "-vf", f"fps={args.fps},showinfo",
        "-q:v", str(args.quality),
        "-start_number", "0",
        str(args.out / "frame_%06d.jpg"),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr[-4000:], file=sys.stderr)
        return result.returncode

    times: dict[int, float] = {}
    for line in result.stderr.splitlines():
        if "Parsed_showinfo" not in line:
            continue
        match = PTS_RE.search(line)
        if match:
            times[int(match.group(1))] = float(match.group(2)) - start_time

    files = sorted(args.out.glob("frame_*.jpg"))
    rows = []
    for i, file in enumerate(files):
        # Fallback (não deveria ocorrer): tempo nominal pela taxa de extração.
        t = times.get(i, i / args.fps)
        rows.append({"frame": i, "file": file.name, "video_time_s": f"{t:.4f}"})

    if len(times) != len(files):
        print(
            f"aviso: {len(files)} quadros, mas {len(times)} tempos lidos do ffmpeg; "
            "os faltantes usam o tempo nominal i/fps.",
            file=sys.stderr,
        )

    csv_path = args.out / "frames.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["frame", "file", "video_time_s"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"{len(rows)} quadros em {args.out} ({args.fps} fps); tempos em {csv_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
