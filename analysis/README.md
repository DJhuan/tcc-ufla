# Scripts de análise do ProtVR

Scripts em Python 3 para os dois experimentos do TCC:

- avaliação zero-shot com CLIP dos quadros gravados no Quest Pro;
- resumo de desempenho a partir das amostras por quadro gravadas pela própria
  aplicação (`?perf=1`).

O passo a passo completo, com os parâmetros de URL e o formato do log, está em
[`docs/INSTRUMENTACAO.md`](../docs/INSTRUMENTACAO.md).

## Instalação

```bash
cd analysis
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt        # CLIP (torch, open_clip, ...)
# ou, só para o desempenho:
pip install -r requirements-perf.txt   # pandas e numpy
```

O `ffmpeg` e o `ffprobe` precisam estar no `PATH`. O `torch` instalado pelo
`pip` é a versão padrão. Para GPU NVIDIA, siga as instruções em
<https://pytorch.org> antes de instalar o resto. Na primeira execução, o
`open_clip` baixa os pesos da OpenAI: cerca de 350 MB para o ViT-B/32 e 900 MB
para o ViT-L/14.

## Arquivos

| Arquivo | Função |
|---|---|
| `protvr_log.py` | Leitura do JSON do log (módulo usado pelos outros scripts) |
| `extract_frames.py` | Extrai quadros do vídeo a N fps e grava o horário de cada um |
| `label_frames.py` | Alinha pelo `sync`, rotula com E1–E5, descarta quadros perto de mudanças e balanceia |
| `prompts.json` | Descrições por estado: conjunto `D` (descritivo) e `S` (semântico), 3 paráfrases cada |
| `clip_eval.py` | Classificação zero-shot com CLIP e métricas por conjunto × condição × modelo |
| `perf_summary.py` | Desempenho por cenário × condição × fase (FPS, dt, cpu, quadros perdidos, chamadas de desenho) e tempos de carga |

## Experimento 1: CLIP

```bash
# 1. Quadros (2 fps por padrão)
python extract_frames.py videos/m1.mp4 --out frames/m1
python extract_frames.py videos/m2.mp4 --out frames/m2

# 2. Rótulos. --sync-video-time: instante (s) do toque no B/Y visto no vídeo
python label_frames.py --video videos/m1.mp4 --frames frames/m1 \
    --log ../logs/protvr-log-AAAA.json --sync-video-time 8.5 --out labels/m1
python label_frames.py --video videos/m2.mp4 --frames frames/m2 \
    --log ../logs/protvr-log-BBBB.json --sync-video-time 6.0 --out labels/m2

# 3. CLIP (ViT-B/32 por padrão; acrescente ViT-L-14 se quiser)
python clip_eval.py --labels labels/m1/labels.csv labels/m2/labels.csv \
    --models ViT-B-32 ViT-L-14 --out results/clip
```

Detalhes do `label_frames.py`:

- Só entram quadros dentro de uma sessão XR, entre `session-start` e
  `session-end`.
- São descartados os quadros a menos de `--guard` segundos (padrão 0,5) de uma
  mudança de estado ou do início ou fim da sessão.
- O sorteio usa `--seed 42`, salvo indicação contrária.
- A condição (`m1`/`m2`) vem do cenário registrado no log, ou de `--condition`.

O `clip_eval.py` grava os resultados em `results/clip/<modelo>/<D|S>/<m1|m2>/`:

- `metrics.json`, `per_state.csv`, `confusion.csv`, `confusion.png` e
  `predictions.csv`;
- um `results/clip/summary.csv` geral.

A coluna `meets_criterion` e o campo `states_meeting_criterion` indicam os
estados com revocação top-1 ≥ 50% (o acaso é 20%).

## Experimento 2: desempenho

Requer logs exportados com `?perf=1` (formato v2, com o campo `frames`) e as
fases marcadas pelo botão A/X (ver `docs/INSTRUMENTACAO.md`, §8).

```bash
pip install -r requirements-perf.txt
python perf_summary.py ../logs/protvr-log-*.json --out results/perf
# opcional: --drop-factor 1.5  (quadro perdido se dt > fator × 1000/frameRate)
```

Saídas em `results/perf/`:

| Arquivo | Conteúdo |
|---|---|
| `runs/<log>.csv` | uma linha por repetição (ciclo do A/X) × fase de cada execução |
| `perf_runs.csv` | todas as repetições juntas |
| `perf_summary.csv` | cenário × condição × fase (`stabilization`, `static`, `interaction`): média e desvio padrão entre repetições, com `n_reps` |
| `loads.csv` / `loads_summary.csv` | tempos de carga (parse, bonds, build e total) por molécula |

Métricas por fase, usando só quadros com `presenting = 1`:

- FPS em janelas de 1 s: média, desvio padrão e mínimo;
- `dt` e `cpu`: média e percentil 95;
- percentual de quadros perdidos;
- média de `calls` e `triangles`, por quadro e somando os dois olhos.
