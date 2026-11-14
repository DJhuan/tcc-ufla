"""Leitura do registro de eventos do ProtVR (protvr-log-*.json).

Formato (ver docs/INSTRUMENTACAO.md):
    {
      "format": "protvr-log", "version": 1,
      "startedAt": <ms de época>, "exportedAt": <ms de época>,
      "entries": [{"t": <ms de época>, "type": "...", "data": {...}}, ...]
    }
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

STATES = ["E1", "E2", "E3", "E4", "E5"]


@dataclass
class ProtVRLog:
    path: Path
    started_at: float
    exported_at: float
    entries: list[dict[str, Any]]

    def of_type(self, *types: str) -> list[dict[str, Any]]:
        wanted = set(types)
        return [e for e in self.entries if e["type"] in wanted]

    @property
    def config(self) -> dict[str, Any]:
        """Dados da entrada "config" (inclui o objeto `experiment`)."""
        for entry in self.entries:
            if entry["type"] == "config":
                return entry["data"]
        return {}

    @property
    def experiment(self) -> dict[str, Any]:
        return self.config.get("experiment", {}) or {}

    @property
    def scenario(self) -> str | None:
        return self.experiment.get("scenario")

    @property
    def instancing(self) -> bool | None:
        value = self.experiment.get("instancing")
        return None if value is None else bool(value)

    def sync_times(self) -> list[float]:
        return [e["t"] for e in self.of_type("sync")]

    def session_intervals(self) -> list[tuple[float, float]]:
        """Intervalos [início, fim] (ms de época) de cada sessão XR.

        Uma sessão sem "session-end" (log exportado durante a sessão) é
        fechada em `exportedAt`.
        """
        intervals: list[tuple[float, float]] = []
        start: float | None = None
        for entry in self.entries:
            if entry["type"] == "session-start":
                start = entry["t"]
            elif entry["type"] == "session-end" and start is not None:
                intervals.append((start, entry["t"]))
                start = None
        if start is not None:
            intervals.append((start, self.exported_at))
        return intervals

    def state_changes(self) -> list[tuple[float, str]]:
        """Lista ordenada de (t, estado) a partir das entradas "state"."""
        changes = [(e["t"], e["data"]["state"]) for e in self.of_type("state")]
        changes.sort(key=lambda item: item[0])
        return changes


def load_log(path: str | Path) -> ProtVRLog:
    path = Path(path)
    with path.open(encoding="utf-8") as fh:
        raw = json.load(fh)
    if raw.get("format") != "protvr-log":
        raise ValueError(f"{path}: não é um log do ProtVR (campo 'format').")
    entries = sorted(raw.get("entries", []), key=lambda e: e["t"])
    return ProtVRLog(
        path=path,
        started_at=float(raw.get("startedAt", entries[0]["t"] if entries else 0)),
        exported_at=float(raw.get("exportedAt", entries[-1]["t"] if entries else 0)),
        entries=entries,
    )
