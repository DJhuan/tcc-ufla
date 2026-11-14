# Scripts de análise do ProtVR

Scripts em Python 3 para os dois experimentos do TCC:

- avaliação zero-shot com CLIP dos quadros gravados no Quest Pro;
- resumo de desempenho com o OVR Metrics Tool.

O passo a passo completo, com os parâmetros de URL e o formato do log, está em
[`docs/INSTRUMENTACAO.md`](../docs/INSTRUMENTACAO.md).

## Instalação

```bash
cd analysis
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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
| `perf_summary.py` | Tabela de FPS e tempo de GPU por cenário e condição de instanciamento |

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

1. Confira os nomes das colunas do CSV do OVR Metrics Tool:

   ```bash
   python perf_summary.py --list-columns ovr/c1_inst.csv
   ```

   Se os nomes não baterem com os candidatos de `DEFAULT_COLUMNS` (no topo de
   `perf_summary.py`), crie um `columns.json`:

   ```json
   {"fps": "FPS", "gpu_time": "App GPU Time", "gpu_time_unit": "us",
    "timestamp": "Time Stamp", "timestamp_unit": "ms"}
   ```

2. Monte um manifesto com uma linha por gravação. Os caminhos são relativos à
   pasta do manifesto. Com o log preenchido, `scenario` e `instancing` podem
   ficar vazios:

   ```csv
   ovr_csv,log,scenario,instancing
   ovr/c1_inst.csv,logs/protvr-log-1.json,,
   ovr/c1_mesh.csv,logs/protvr-log-2.json,,
   ovr/c3_mesh.csv,,c3,0
   ```

3. Gere a tabela:

   ```bash
   python perf_summary.py --manifest runs.csv --target-hz 72 \
       --columns columns.json --out results/perf_summary.csv
   ```

A tabela tem uma linha por cenário × instancing:

- FPS: média, desvio padrão e mínimo;
- tempo de GPU (ms): média, desvio padrão, mínimo e máximo;
- percentual de amostras com FPS abaixo do alvo;
- quando há log: tempo de carga, `firstFrameMs`, número de malhas, chamadas de
  desenho, triângulos e FPS medido pela própria aplicação.

Se os horários do OVR forem de época, as amostras são recortadas à sessão XR
do log. Caso contrário, use `--trim-start`/`--trim-end` (em segundos) para
descartar o aquecimento e o encerramento.
