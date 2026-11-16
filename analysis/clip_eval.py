#!/usr/bin/env python3
"""Classificação zero-shot dos quadros rotulados com CLIP (open_clip).

* Modelos: ViT-B-32 (padrão) e, opcionalmente, ViT-L-14, ambos com os
  pesos pré-treinados da OpenAI (`pretrained="openai"`), sem ajuste fino.
* Prompt ensembling: para cada estado, a representação de texto é a média
  (renormalizada) das representações das 3 paráfrases de prompts.json.
* Para cada combinação conjunto (D/S) × condição (m1/m2) × modelo, salva
  em <out>/<modelo>/<conjunto>/<condição>/:
      metrics.json      acurácia top-1/top-2, F1 macro, critério do TCC
      per_state.csv     precisão, revocação, F1 e suporte por estado
      confusion.csv     matriz de confusão (linhas = real, colunas = predito)
      confusion.png
      predictions.csv   predição e probabilidades por quadro
  e um resumo geral em <out>/summary.csv.
* Critério do TCC: estados com revocação top-1 ≥ 50% (acaso = 20%).

Uso:
    python clip_eval.py --labels labels/m1/labels.csv labels/m2/labels.csv \\
        --models ViT-B-32 ViT-L-14 --out results/clip
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from protvr_log import STATES

PROMPT_SETS = ["D", "S"]
RECALL_CRITERION = 0.5
MODEL_ALIASES = {"ViT-B/32": "ViT-B-32", "ViT-L/14": "ViT-L-14"}


# --------------------------------------------------------------------------
# Métricas (independentes do torch)
# --------------------------------------------------------------------------

def evaluate(
    labels: pd.DataFrame,
    probs: np.ndarray,
    out_dir: Path,
    title: str,
) -> dict:
    """Calcula e salva as métricas de um conjunto de quadros.

    `probs` tem forma (n_quadros, 5), colunas na ordem de STATES.
    """
    from sklearn.metrics import confusion_matrix, precision_recall_fscore_support

    out_dir.mkdir(parents=True, exist_ok=True)
    y_true = labels["state"].to_numpy()
    order = np.argsort(-probs, axis=1)
    y_pred = np.array(STATES)[order[:, 0]]
    true_idx = np.array([STATES.index(s) for s in y_true])
    top2_hit = (order[:, 0] == true_idx) | (order[:, 1] == true_idx)

    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=STATES, zero_division=0,
    )
    present = support > 0
    per_state = pd.DataFrame({
        "state": STATES,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "support": support,
        "meets_criterion": (recall >= RECALL_CRITERION) & present,
    })
    per_state.to_csv(out_dir / "per_state.csv", index=False)

    cm = confusion_matrix(y_true, y_pred, labels=STATES)
    pd.DataFrame(cm, index=[f"true_{s}" for s in STATES], columns=[f"pred_{s}" for s in STATES]).to_csv(
        out_dir / "confusion.csv"
    )
    plot_confusion(cm, out_dir / "confusion.png", title)

    predictions = labels[["frame", "file", "video_time_s", "state"]].copy()
    predictions["pred_top1"] = y_pred
    predictions["pred_top2"] = np.array(STATES)[order[:, 1]]
    predictions["correct_top1"] = y_pred == y_true
    predictions["correct_top2"] = top2_hit
    for i, state in enumerate(STATES):
        predictions[f"p_{state}"] = probs[:, i]
    predictions.to_csv(out_dir / "predictions.csv", index=False)

    metrics = {
        "n_frames": int(len(labels)),
        "accuracy_top1": float(np.mean(y_pred == y_true)),
        "accuracy_top2": float(np.mean(top2_hit)),
        # F1 macro sobre os estados presentes nos rótulos;
        "f1_macro": float(np.mean(f1[present])) if present.any() else 0.0,
        "chance": 1.0 / len(STATES),
        "recall_criterion": RECALL_CRITERION,
        "states_meeting_criterion": [s for s, ok in zip(STATES, per_state["meets_criterion"]) if ok],
        "states_absent": [s for s, p in zip(STATES, present) if not p],
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    return metrics


def plot_confusion(cm: np.ndarray, path: Path, title: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    row_sums = cm.sum(axis=1, keepdims=True)
    norm = np.divide(cm, row_sums, out=np.zeros_like(cm, dtype=float), where=row_sums > 0)

    fig, ax = plt.subplots(figsize=(5.2, 4.6), dpi=150)
    image = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(STATES)), STATES)
    ax.set_yticks(range(len(STATES)), STATES)
    ax.set_xlabel("Predito")
    ax.set_ylabel("Real")
    ax.set_title(title, fontsize=9)
    for i in range(len(STATES)):
        for j in range(len(STATES)):
            color = "white" if norm[i, j] > 0.6 else "black"
            ax.text(j, i, f"{cm[i, j]}\n{norm[i, j]:.0%}", ha="center", va="center", fontsize=7, color=color)
    fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04, label="fração da linha")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


# --------------------------------------------------------------------------
# CLIP
# --------------------------------------------------------------------------

def pick_device(requested: str) -> str:
    import torch

    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load_model(name: str, device: str):
    import open_clip

    model, _, preprocess = open_clip.create_model_and_transforms(name, pretrained="openai", force_quick_gelu=True, device=device)
    model.eval()
    tokenizer = open_clip.get_tokenizer(name)
    return model, preprocess, tokenizer


def pad_to_square(img):
    """Completa a imagem com preto até ficar quadrada, sem cortar nada.

    O pré-processamento do CLIP faz um corte central quadrado; num quadro 16:9
    isso descarta ~22% da largura de cada lado, onde costumam ficar o laser e
    o gizmo.
    """
    from PIL import Image

    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), (0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    return canvas


def encode_images(model, preprocess, files: list[str], device: str, batch_size: int, fit: str = "crop") -> np.ndarray:
    import torch
    from PIL import Image

    def load(f):
        img = Image.open(f).convert("RGB")
        return pad_to_square(img) if fit == "pad" else img

    features = []
    with torch.no_grad():
        for start in range(0, len(files), batch_size):
            batch = [preprocess(load(f)) for f in files[start:start + batch_size]]
            emb = model.encode_image(torch.stack(batch).to(device)).float()
            features.append(torch.nn.functional.normalize(emb, dim=-1).cpu().numpy())
            print(f"  imagens: {min(start + batch_size, len(files))}/{len(files)}", end="\r", flush=True)
    print()
    return np.concatenate(features, axis=0)


def encode_prompt_set(model, tokenizer, prompts: dict, prompt_set: str, device: str) -> np.ndarray:
    """Retorna (5, d): média renormalizada das paráfrases de cada estado."""
    import torch

    rows = []
    with torch.no_grad():
        for state in STATES:
            texts = prompts[state][prompt_set]
            emb = model.encode_text(tokenizer(texts).to(device)).float()
            emb = torch.nn.functional.normalize(emb, dim=-1).mean(dim=0)
            rows.append(torch.nn.functional.normalize(emb, dim=-1).cpu().numpy())
    return np.stack(rows)


def softmax(logits: np.ndarray) -> np.ndarray:
    z = logits - logits.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--labels", type=Path, nargs="+", required=True, help="um ou mais labels.csv (coluna 'condition' define m1/m2)")
    parser.add_argument("--prompts", type=Path, default=Path(__file__).with_name("prompts.json"))
    parser.add_argument("--models", nargs="+", default=["ViT-B-32"], help="ViT-B-32 (padrão) e/ou ViT-L-14")
    parser.add_argument("--sets", nargs="+", default=PROMPT_SETS, choices=PROMPT_SETS)
    parser.add_argument("--device", default="auto", help="auto, cpu, cuda ou mps")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--fit", choices=["crop", "pad"], default="crop",
                        help="crop: corte central quadrado do CLIP (padrão); pad: completa com preto até ficar quadrada, mantendo o quadro inteiro")
    parser.add_argument("--out", type=Path, default=Path("results/clip"))
    args = parser.parse_args()

    prompts = json.loads(args.prompts.read_text(encoding="utf-8"))
    for state in STATES:
        for s in args.sets:
            if len(prompts.get(state, {}).get(s, [])) == 0:
                print(f"erro: prompts.json não tem paráfrases para {state}/{s}.", file=sys.stderr)
                return 1

    labels = pd.concat([pd.read_csv(p) for p in args.labels], ignore_index=True)
    missing = [f for f in labels["file"] if not Path(f).is_file()]
    if missing:
        print(f"erro: {len(missing)} quadro(s) não encontrado(s), ex.: {missing[0]}", file=sys.stderr)
        return 1
    conditions = sorted(labels["condition"].astype(str).unique())
    print(f"{len(labels)} quadros; condições: {', '.join(conditions)}")

    device = pick_device(args.device)
    summary = []
    for raw_name in args.models:
        model_name = MODEL_ALIASES.get(raw_name, raw_name)
        print(f"modelo {model_name} (openai) em {device}, ajuste da imagem: {args.fit}")
        model, preprocess, tokenizer = load_model(model_name, device)
        image_features = encode_images(model, preprocess, labels["file"].tolist(), device, args.batch_size, args.fit)
        logit_scale = float(model.logit_scale.exp().item())

        for prompt_set in args.sets:
            text_features = encode_prompt_set(model, tokenizer, prompts, prompt_set, device)
            probs_all = softmax(logit_scale * image_features @ text_features.T)

            for condition in conditions:
                mask = (labels["condition"].astype(str) == condition).to_numpy()
                subset = labels[mask].reset_index(drop=True)
                out_dir = args.out / model_name / prompt_set / condition
                title = f"{model_name} | conjunto {prompt_set} | {condition} (n={len(subset)})"
                metrics = evaluate(subset, probs_all[mask], out_dir, title)
                summary.append({
                    "model": model_name,
                    "fit": args.fit,
                    "prompt_set": prompt_set,
                    "condition": condition,
                    "n_frames": metrics["n_frames"],
                    "accuracy_top1": metrics["accuracy_top1"],
                    "accuracy_top2": metrics["accuracy_top2"],
                    "f1_macro": metrics["f1_macro"],
                    "states_meeting_criterion": " ".join(metrics["states_meeting_criterion"]),
                    "n_states_meeting_criterion": len(metrics["states_meeting_criterion"]),
                })
                print(
                    f"  {prompt_set}/{condition}: top1={metrics['accuracy_top1']:.1%} "
                    f"top2={metrics['accuracy_top2']:.1%} F1macro={metrics['f1_macro']:.3f} "
                    f"revocação≥50%: {metrics['states_meeting_criterion'] or 'nenhum'}"
                )

    args.out.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(summary).to_csv(args.out / "summary.csv", index=False)
    print(f"resumo → {args.out / 'summary.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
