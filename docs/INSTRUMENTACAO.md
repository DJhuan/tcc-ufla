# Instrumentação do ProtVR para os experimentos do TCC

Este documento descreve a instrumentação adicionada ao ProtVR para os dois
experimentos do TCC:

1. **Avaliação com CLIP.** O Quest Pro grava a tela enquanto um roteiro fixo de
   ações é executado. Cada quadro do vídeo é rotulado com o estado de interação
   lido do registro de eventos e depois classificado zero-shot pelo CLIP.
2. **Desempenho.** A própria aplicação mede, quadro a quadro, o intervalo entre
   quadros, o tempo de CPU e as chamadas de desenho em cenários fixos, com e sem
   instanciamento de malhas. As fases de cada execução são marcadas pelo botão
   A/X. Tudo é exportado no mesmo JSON do log; o OVR Metrics Tool não é usado,
   porque não registra sessões do Quest Browser.

Sem nenhum parâmetro de URL, a aplicação se comporta exatamente como antes. A
instrumentação não desenha nada na cena (nenhum HUD) e não altera o retorno
visual avaliado: cores do laser, TransformControls, destaque dos botões do
VRMenu e contorno de seleção.

---

## 1. Parâmetros de URL

| Parâmetro    | Valores                            | Efeito                                                                                                                                                                  |
| ------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log`        | `1`                                | Ativa o registro de eventos (`EventLogger`) e mostra os botões **Exportar log** e **Logs salvos (N)** na barra da página.                                               |
| `perf`       | `1`                                | Grava amostras **por quadro** (`frames` no JSON, §5) e ativa a marcação de fases pelo botão **A/X** (§8). Também ativa o registro e os botões, porque precisa de onde gravar. |
| `instancing` | `0`                                | Constrói um `THREE.Mesh` por átomo e por ligação, compartilhando geometrias e materiais, em vez de `InstancedMesh`. Sem o parâmetro, a construção continua instanciada. |
| `scenario`   | `m1`, `m2`, `c1`, `c2`, `c3`, `c4` | Carrega o cenário ao abrir a página, no lugar do ATP de demonstração. Um id inválido gera um aviso no console e a página carrega o ATP.                                 |

Os parâmetros podem ser combinados:

```
https://<ip-do-pc>:5173/?scenario=m1&log=1                 # CLIP, condição m1
https://<ip-do-pc>:5173/?scenario=c3&perf=1                # desempenho, 6H0F instanciada
https://<ip-do-pc>:5173/?scenario=c3&perf=1&instancing=0   # desempenho, 6H0F não instanciada
```

`1` e `true` ligam uma opção; `0` e `false` desligam.

### Cenários (`src/core/Scenarios.ts`)

| Id   | Arquivos (`public/assets`)         | Uso        | Contorno em VR         |
| ---- | ---------------------------------- | ---------- | ---------------------- |
| `m1` | ATP.pdb + ATP.pdb, lado a lado     | CLIP       | visível (47 átomos)    |
| `m2` | 6H0F.pdb                           | CLIP       | oculto (77.598 átomos) |
| `c1` | ATP.pdb                            | desempenho | visível                |
| `c2` | 6XE9.pdb                           | desempenho | oculto                 |
| `c3` | 6H0F.pdb                           | desempenho | oculto                 |
| `c4` | `C4_PAIR`, hoje ATP.pdb + 6XE9.pdb | desempenho | por molécula           |

- **Contorno:** a instrumentação não o altera. Em VR, ele continua oculto em
  moléculas acima de `VR_OUTLINE_MAX_ATOMS` (1000 átomos); no desktop, aparece
  sempre. A renderização foveada continua ativa nas duas condições.
- **Carga:** os arquivos são carregados em sequência e dispostos lado a lado no
  eixo X, centrados na origem, com 5 Å entre as caixas delimitadoras.
- **Seleção inicial:** é a da última molécula carregada. No `m1`, isso põe o
  gizmo no ATP da direita.
- **c4:** para trocar o par, edite `C4_PAIR` em `src/core/Scenarios.ts`.

---

## 2. Estados de interação (E1–E5)

O `EventLogger` calcula o estado a partir do estado de cada laser
(`idle`/`hover`/`active`), do elemento apontado (`menu`/`gizmo`) e do modo de
transformação atual. Um evento `state` é gravado sempre que o estado muda.

| Estado              | Condição                                       | Retorno visual correspondente                 |
| ------------------- | ---------------------------------------------- | --------------------------------------------- |
| **E5** usando menu  | algum laser em hover ou active com alvo `menu` | laser laranja sobre o painel, botão destacado |
| **E3** transladando | algum laser `active` com modo `translate`      | laser verde arrastando as setas               |
| **E4** rotacionando | algum laser `active` com modo `rotate`         | laser verde arrastando os anéis               |
| **E2** apontando    | algum laser em `hover` com alvo `gizmo`        | laser laranja sobre o gizmo                   |
| **E1** ocioso       | nenhum dos anteriores                          | laser azul                                    |

Em caso de conflito, a prioridade é **E5 > E3/E4 > E2 > E1**.

Observações:

- **E2 vale só para o gizmo.** No ProtVR, o laser fica laranja apenas sobre o
  gizmo do TransformControls. Mirar no corpo da molécula mantém o laser azul,
  então conta como E1.
- **E5 vale para o painel inteiro**, não só para os botões. Qualquer ponto do
  painel deixa o laser laranja. O clique em um botão não muda o laser, então
  continua em E5.
- **Modo trocado durante o arraste:** se o modo mudar no meio de um arraste
  (aperto do grip, `squeeze`), o estado passa entre E3 e E4.
- **Fim da sessão:** ao fim da sessão XR, todos os lasers são considerados
  ociosos e o estado volta a E1.

---

## 3. Formato do log (JSON)

Nome do arquivo: `protvr-log-<ISO-8601 com ":" e "." trocados por "-">.json`,
por exemplo `protvr-log-2026-11-14T15-02-31-123Z.json`.

```json
{
  "format": "protvr-log",
  "version": 2,
  "startedAt": 1763132551123.4,
  "exportedAt": 1763132911456.7,
  "entries": [
    {
      "t": 1763132551123.4,
      "type": "config",
      "data": {
        "experiment": {
          "log": true,
          "perf": false,
          "instancing": true,
          "scenario": "m1",
          "invalidScenario": null
        },
        "timeOrigin": 1763132550001.2,
        "userAgent": "...",
        "url": "..."
      }
    },
    { "t": 1763132551123.5, "type": "state", "data": { "state": "E1" } },
    {
      "t": 1763132563001.0,
      "type": "session-start",
      "data": {
        "environmentBlendMode": "opaque",
        "frameRate": 72,
        "supportedFrameRates": [72, 90],
        "frameIndex": 312,
        "frameT": 12999.85
      }
    },
    { "t": 1763132565210.8, "type": "sync", "data": { "handedness": "right" } },
    {
      "t": 1763132570002.3,
      "type": "laser",
      "data": { "handedness": "right", "state": "hover", "target": "gizmo" }
    },
    { "t": 1763132570002.4, "type": "state", "data": { "state": "E2" } }
  ],
  "frames": {
    "count": 9436,
    "capacity": 131072,
    "full": false,
    "timeOrigin": 1763132550001.2,
    "t": [12999.85, 13013.74, 13027.63],
    "dt": [null, 13.89, 13.89],
    "cpu": [2.1, 1.9, 2.0],
    "calls": [41, 41, 41],
    "triangles": [52380, 52380, 52380],
    "presenting": [0, 1, 1]
  }
}
```

- **`t`:** milissegundos de época (`performance.timeOrigin + performance.now()`),
  em ponto flutuante, monotônico dentro da página.
- **Conteúdo:** o log acumula tudo desde a abertura da página. Cada exportação
  traz o histórico completo, e várias sessões XR aparecem em sequência.
- **Só mudanças:** `entries` não recebe nada a cada quadro. As amostras por
  quadro ficam à parte, em `frames` (§5), e só existem com `?perf=1`; sem ele,
  `frames` é `null`.
- **Versões:** a versão 1 não tinha `frames`, as fases do A/X nem os campos
  `frameRate`/`frameIndex`/`frameT`. Os scripts do CLIP leem só `entries` e
  aceitam as duas versões.
- **`frameIndex` e `frameT`:** presentes nos eventos de sessão, de fase, de taxa
  de atualização e de buffer cheio. `frameIndex` é o índice, em `frames`, da
  primeira amostra gravada a partir do evento (dentro do quadro em andamento, é
  o próprio quadro; -1 se o buffer estiver cheio). `frameT` é o `t` do quadro em
  andamento ou do último iniciado. É por eles que a análise recorta as fases,
  com o mesmo relógio das amostras.

### Tipos de evento

| `type`                    | `data`                                                                                                               | Quando                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `config`                  | `experiment` (parâmetros de URL), `timeOrigin`, `userAgent`, `url`                                                   | primeira entrada                                                 |
| `state`                   | `state`: `E1`…`E5`                                                                                                   | estado derivado mudou (e o E1 inicial)                           |
| `laser`                   | `handedness` (`left`/`right`/`none`), `state` (`idle`/`hover`/`active`), `target` (`menu`/`gizmo`/`null`)            | laser mudou de estado ou de alvo                                 |
| `drag-start` / `drag-end` | `handedness`, `mode` (`translate`/`rotate`)                                                                          | início e fim do arraste do gizmo                                 |
| `transform-mode-changed`  | `mode`                                                                                                               | troca de modo (botão do menu, grip ou painel desktop)            |
| `molecule-added`          | `id`, `name`                                                                                                         | molécula adicionada ao store                                     |
| `molecule-selected`       | `id`, `name` (ou `null`)                                                                                             | seleção mudou                                                    |
| `menu-hover`              | `id` do botão (`prev`, `next`, `mode`, `center`, `scale-down`, `scale-reset`, `scale-up`, `exit`) ou `null`, `label` | laser entrou em um botão, trocou de botão ou saiu                |
| `menu-click`              | `id`, `label` (rótulo antes da ação)                                                                                 | clique em botão do VRMenu                                        |
| `sync`                    | `handedness`                                                                                                         | **borda de subida** do botão B/Y, um evento por toque            |
| `session-start`           | `environmentBlendMode` (`opaque` = VR), `frameRate` e `supportedFrameRates` (ou `null`), `frameIndex`, `frameT`        | início da sessão XR                                              |
| `session-end`             | `frameIndex`, `frameT`                                                                                               | fim da sessão XR (a exportação automática vem logo depois)       |
| `framerate-change`        | `frameRate`, `frameIndex`, `frameT`                                                                                  | a taxa de atualização da sessão mudou (`frameratechange`)        |
| `phase-start`             | `phase` (`static`/`interaction`), `cycle`, `handedness`, `frameIndex`, `frameT`                                      | 1º e 2º toque no A/X de cada ciclo (só com `?perf=1`)            |
| `phase-end`               | `cycle`, `handedness` (`null` se fechado pelo fim da sessão), `reason` opcional (`session-end`), `frameIndex`, `frameT` | 3º toque no A/X, ou fim da sessão com um ciclo aberto            |
| `perf-buffer-full`        | `capacity`, `frameIndex`, `frameT`                                                                                   | o buffer de amostras encheu; a gravação de quadros parou         |
| `load`                    | ver §5                                                                                                               | molécula carregada (depois do primeiro quadro desenhado com ela) |
| `scenario-start`          | `id`, `files`                                                                                                        | início da carga de um cenário                                    |
| `scenario-ready`          | `id`, `molecules` [`{id, name}`]                                                                                     | todas as moléculas do cenário na cena                            |
| `scenario-error`          | `id`, `error`                                                                                                        | falha ao carregar o cenário                                      |

---

## 4. Exportação do log

A exportação acontece **automaticamente ao fim de cada sessão XR** e também
pelo botão **Exportar log**. Ela segue três caminhos ao mesmo tempo:

1. **localStorage** (chave igual ao nome do arquivo): cópia de segurança **no
   navegador do próprio Quest**. Não dá para ler pelo PC. O botão **Logs salvos
   (N)** baixa e reenvia todas as cópias guardadas. O limite é de ~5 MB por
   origem e os logs salvos se acumulam. Se o log completo não couber, é salva
   uma cópia **sem `frames`**, com o sufixo `-entries.json`, para não
   sobrescrever o arquivo completo no PC caso seja reenviada.
2. **Envio ao servidor de desenvolvimento:** `POST /__protvr/log`. O plugin do
   `vite.config.ts` grava o arquivo em **`logs/` no PC** que serve a aplicação.
   Só existe com `npm run dev`, não com `vite preview` nem no build. É o
   caminho recomendado.
3. **Download** do arquivo pelo navegador. No Quest Browser, a exportação
   automática acontece sem gesto do usuário e pode ser bloqueada ou pedir
   confirmação. Por isso os caminhos 1 e 2 existem.

O console do navegador mostra o tamanho do arquivo e o resultado de cada
caminho, com o prefixo `[ProtVR-log]`.

**Tamanho do arquivo com `?perf=1`.** As amostras são arredondadas na
exportação e ocupam ~30 bytes por quadro. Uma execução de ~2,5 min a 72–90 Hz
(~13,5 mil quadros) gera ~0,4 MB; o buffer cheio (131.072 quadros) gera
~3,8 MB. O download e o envio ao servidor lidam bem com esses tamanhos.

---

## 5. Métricas de desempenho

### Tempo de carga (evento `load` e console `[ProtVR-perf]`)

São medidos com `performance.now()` e impressos **sempre** no console, com ou
sem parâmetros. Com o registro ativo, também vão para o log.

| Campo                    | Significado                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`, `atoms`, `bonds` | arquivo e contagens                                                                                                                                                           |
| `meshes`                 | malhas criadas pelo builder (poucas no modo instanciado; átomos + ligações no não instanciado)                                                                                |
| `instancing`             | condição                                                                                                                                                                      |
| `readMs`                 | leitura do arquivo (`fetch`/`File.text()`)                                                                                                                                    |
| `parseMs`                | **(a)** interpretação do PDB: PDBLoader, incluindo os registros CONECT, mais a centralização                                                                                  |
| `bondsMs`                | **(b)** cálculo das ligações (`BondCalculator`) e mescla com as ligações do CONECT                                                                                            |
| `buildMs`                | **(c)** construção da geometria (`BallAndStickBuilder`)                                                                                                                       |
| `sceneMs`                | contorno, registro no store e `scene.add`                                                                                                                                     |
| `totalMs`                | da leitura do arquivo até a molécula entrar na cena: `read + parse + bonds + build + scene`                                                                                   |
| `firstFrameMs`           | do `scene.add` até o fim do primeiro `renderer.render()` seguinte, que inclui o envio de buffers e a compilação de shaders do lado da CPU. A GPU termina de forma assíncrona. |

Exemplo de linha no console:

```
[ProtVR-perf] load 6H0F.pdb: 77598 átomos, 78423 ligações, 7 malhas, instancing=1 | read=… parse=… bonds=… build=… scene=… total=… firstFrame=… ms
```

### Amostras por quadro (`frames`, `?perf=1`)

O `FrameSampler` grava uma amostra por quadro em `Float64Array`
pré-alocados, um por campo. Não há alocação de objetos nem log no console por
quadro, e nada aparece na cena. O custo extra são duas chamadas a
`performance.now()` e seis escritas em array.

| Campo        | Significado                                                                                                                                                                       | Arredondamento |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `t`          | `time` recebido do `setAnimationLoop`, em ms desde `timeOrigin`. Na sessão XR, vem do `requestAnimationFrame` do WebXR (no Quest, pode ser o instante previsto de exibição); no desktop, do rAF da janela | 3 casas        |
| `dt`         | `t` menos o `t` do quadro anterior (`null` no primeiro)                                                                                                                           | 2 casas        |
| `cpu`        | `performance.now()` do início do `renderLoop` até logo após `renderer.render()`: `controls.update`, `xrControllerManager.update` e o render. Não inclui o tempo de GPU, que termina de forma assíncrona | 2 casas        |
| `calls`      | `renderer.info.render.calls`, lido logo após o render                                                                                                                             | inteiro        |
| `triangles`  | `renderer.info.render.triangles`, lido logo após o render                                                                                                                         | inteiro        |
| `presenting` | 1 durante a sessão XR, 0 fora dela                                                                                                                                                | inteiro        |

Cabeçalho de `frames`: `count` (amostras gravadas), `capacity`, `full` e
`timeOrigin` (o mesmo de `config`; `timeOrigin + t` dá o horário de época
aproximado).

- **Capacidade:** 131.072 quadros, cerca de 24 min a 90 Hz ou 18 min a 120 Hz.
  O buffer conta **desde a abertura da página**, incluindo os quadros do
  desktop (`presenting = 0`). Ao encher, a gravação **para** (não sobrescreve)
  e o evento `perf-buffer-full` é registrado uma vez.
- **Taxa de atualização:** `session.frameRate` e `session.supportedFrameRates`
  vão no `session-start`, quando o navegador os informa; a mudança durante a
  sessão gera `framerate-change`.

**Os valores de `calls` e `triangles` são por quadro, ou seja, a soma dos dois
olhos.** Com `info.autoReset = true` (o padrão), o three.js r186 zera os
contadores uma vez por chamada a `render()`. Em WebXR, os dois olhos são
desenhados dentro dessa mesma chamada, num laço sobre o `ArrayCamera`, sem
multiview (`WebGLRenderer.js`, linhas 1731 e 1774). Portanto, os valores são
cerca de 2× os de um olho. Eles também incluem o gizmo, a grade, o menu e os
lasers.

### Custo esperado sem instanciamento

Medições no desktop, com Node e o builder real:

| Arquivo | Malhas (inst. / não inst.) | `updateMatrixWorld` por quadro (não inst.) | Memória extra (não inst.) |
| ------- | -------------------------- | ------------------------------------------ | ------------------------- |
| 6XE9    | 5 / 44.494                 | ~14 ms                                     | ~150 MB                   |
| 6H0F    | 7 / 156.021                | ~45 ms                                     | ~350 MB                   |

- O contorno é um clone da molécula, então o número de objetos na cena dobra.
  Mesmo invisíveis, esses clones passam pela atualização de matrizes.
- Os átomos e as ligações usam `matrixAutoUpdate = false`, porque são estáticos
  dentro do grupo.
- No Quest, espere poucos FPS no `c3` com `?instancing=0`, e há risco de o
  navegador fechar a aba por falta de memória.

---

## 6. Preparação (comum aos dois experimentos)

1. **Certificados HTTPS:** devem estar em `certs/` (ver `docs/MKCERT.md`). O
   WebXR exige contexto seguro.
2. **Servidor de desenvolvimento:** no PC, rode `npm run dev`. Ele é
   obrigatório para o log ser gravado em `logs/` (§4). Anote o IP mostrado em
   `Network:`.
3. **Quest Pro:** conecte-o à mesma rede e abra
   `https://<ip-do-pc>:5173/?...` no Quest Browser. Aceite o certificado, se
   pedido.
4. **Recarregue a página entre execuções**, para que cada log e cada medição
   comecem do zero. O log e o buffer de quadros acumulam tudo desde a abertura
   da página.

---

## 7. Experimento 1: avaliação com CLIP

### 7.1 Gravação no Quest

Para cada condição (`m1` e `m2`):

1. Abra `https://<ip-do-pc>:5173/?scenario=m1&log=1`, ou `m2`. Não use
   `?perf=1` nas gravações para o CLIP.
2. Comece a gravação de tela do Quest (botão Meta, depois Câmera, depois
   **Gravar vídeo**).
3. Entre em VR pelo botão **ENTER VR**.
4. **Sync:** dê **um toque curto no botão B ou Y**. Isso gera o evento `sync` e
   também traz o menu para a frente do usuário. O salto do menu serve de marca
   visual para achar o instante no vídeo.
5. Execute o roteiro fixo de ações, passando por todos os estados.
6. Saia da sessão pelo botão **Sair da Sessão VR** do menu, ou pelo botão Meta.
   O log é exportado automaticamente e gravado em `logs/` no PC.
7. Pare a gravação.
8. Copie o vídeo para o PC. Por USB, ele fica em `Oculus/VideoShots/` no Quest.

Confira:

- o arquivo `logs/protvr-log-*.json` no PC e a mensagem `[ProtVR-log] gravado`
  no terminal do `npm run dev`;
- se o envio falhar, use o botão **Logs salvos (N)** na página do Quest.

### 7.2 Identificar o instante do sync no vídeo

Abra o vídeo num player que mostre o tempo com precisão de quadro, como o mpv
(`mpv --osd-fractions vídeo.mp4`, com `.` e `,` para avançar e voltar um
quadro). Anote o tempo, em segundos, do **primeiro quadro em que o menu salta
para a frente da visão**. Esse é o valor de `--sync-video-time`.

### 7.3 Análise

Veja `analysis/README.md` para a instalação. Para um venv descartável com
torch e open_clip, veja `sandbox/TUTORIAL_TORCH_OPENCLIP.md`.

```bash
cd analysis
python extract_frames.py videos/m1.mp4 --out frames/m1            # 2 fps (--fps N)
python label_frames.py --video videos/m1.mp4 --frames frames/m1 \
    --log ../logs/protvr-log-<m1>.json --sync-video-time <s> --out labels/m1
# (repita para m2)
python clip_eval.py --labels labels/m1/labels.csv labels/m2/labels.csv \
    --models ViT-B-32 ViT-L-14 --out results/clip
```

**Rotulação.** O `label_frames.py` alinha os relógios com:

```
epoch = t_sync + (t_vídeo − sync_video_time) · 1000
```

Em seguida:

- mantém só os quadros dentro de sessões XR;
- dá a cada quadro o estado vigente;
- descarta quadros a menos de 0,5 s de uma mudança de estado ou de um limite
  de sessão;
- sorteia o mesmo número de quadros por estado, com semente 42.

**Classificação.** O `clip_eval.py` usa os pesos OpenAI, sem ajuste fino. A
representação de cada estado é a média das 3 paráfrases de `prompts.json`
(conjuntos D e S). Para cada modelo × conjunto × condição, salva:

- acurácia top-1 e top-2;
- precisão, revocação e F1 por estado;
- F1 macro;
- matriz de confusão (CSV e PNG);
- predições por quadro.

O campo `states_meeting_criterion` lista os estados com **revocação top-1 ≥
50%** (critério do TCC; o acaso é 20%).

---

## 8. Experimento 2: desempenho (medido na aplicação)

### 8.1 Marcação das fases com o botão A/X

Cada execução tem três fases: **estabilização (10 s)**, **estática (60 s)** e
**interação (60 s)**. Com `?perf=1`, o botão **A** (controle direito) ou **X**
(controle esquerdo), índice 4 do gamepad, marca as fases. O botão não tinha
outro uso, e a detecção é pela borda de subida, como no `sync` do B/Y: um
evento por toque, sem nenhum efeito visual.

| Toque           | Evento                                | Significado                              |
| --------------- | ------------------------------------- | ---------------------------------------- |
| 1º              | `phase-start` `{phase: "static"}`     | fim da estabilização, início da estática |
| 2º              | `phase-start` `{phase: "interaction"}` | fim da estática, início da interação     |
| 3º              | `phase-end`                           | fim da interação                         |
| 4º              | `phase-start` `{phase: "static"}`     | recomeça o ciclo (`cycle` + 1)           |

- A estabilização não tem marca própria: vai do `session-start` até o 1º toque.
- Se a sessão terminar com um ciclo aberto, um `phase-end` com
  `reason: "session-end"` é registrado automaticamente.
- Sem `?perf=1`, o A/X é ignorado.
- A e X avançam o mesmo ciclo. Use um único controle para não marcar duas vezes.

### 8.2 Coleta

Para cada cenário (`c1`–`c4`) × condição (instanciado e `instancing=0`), faça
**3 repetições**, cada uma numa página recarregada:

1. Abra, por exemplo, `https://<ip-do-pc>:5173/?scenario=c2&perf=1&instancing=0`
   e espere a molécula aparecer.
2. Entre em VR pelo botão **ENTER VR** e fique na posição de referência.
3. **Estabilização:** espere 10 s sem interagir.
4. **Toque no A (1º):** começa a fase estática. Fique 60 s parado, olhando para
   as moléculas.
5. **Toque no A (2º):** começa a fase de interação. Execute por 60 s o roteiro
   de interação (mover, rotacionar, usar o menu).
6. **Toque no A (3º):** fim da interação.
7. Saia da sessão pelo menu (**Sair da Sessão VR**) ou pelo botão Meta. O log,
   com as amostras por quadro, é exportado automaticamente e gravado em `logs/`
   no PC.
8. Recarregue a página antes da próxima repetição.

Confira no terminal do `npm run dev` a mensagem `[ProtVR-log] gravado
logs/...`. Se o envio falhar, use o botão **Logs salvos (N)** na página (a cópia
no `localStorage` pode estar sem `frames`; nesse caso, use o download).

Também dá para fazer as 3 repetições numa mesma sessão, tocando o A de novo
para iniciar outro ciclo. Mas aí só o primeiro ciclo tem estabilização
medida, e o recarregamento da página entre repetições não acontece.

### 8.3 Análise

```bash
cd analysis
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-perf.txt          # só pandas e numpy
python perf_summary.py ../logs/protvr-log-*.json --out results/perf
```

O `perf_summary.py` lê o cenário e a condição do evento `config` e recorta as
fases pelo `frameIndex` das marcas, usando só quadros com `presenting = 1`.
Cada ciclo é uma repetição. Para cada cenário × condição × fase
(`stabilization`, `static`, `interaction`), calcula:

- FPS em janelas de 1 s (contagem de quadros; a última janela incompleta é
  descartada): média, desvio padrão e mínimo;
- `dt` e `cpu`: média e percentil 95. O `dt` de um quadro cujo anterior não
  estava em XR é ignorado;
- quadros perdidos: percentual de quadros com `dt > 1,5 × 1000 / frameRate`,
  usando a taxa vigente (`session-start`/`framerate-change`). Se o navegador
  não informar a taxa, ela é estimada pela mediana do `dt`, com aviso. O fator
  é ajustável com `--drop-factor`;
- média de `calls` e `triangles`.

Saídas em `results/perf/`:

| Arquivo             | Conteúdo                                                                    |
| ------------------- | --------------------------------------------------------------------------- |
| `runs/<log>.csv`    | uma linha por repetição × fase de cada execução                             |
| `perf_runs.csv`     | todas as repetições juntas                                                  |
| `perf_summary.csv`  | cenário × condição × fase: média e desvio padrão entre repetições (`n_reps`) |
| `loads.csv`         | tempos de carga de cada molécula (eventos `load`)                           |
| `loads_summary.csv` | cenário × condição × molécula: média e desvio padrão de parse, bonds, build e total |

O script avisa quando o buffer encheu, quando faltam marcas de fase e quando
alguma combinação não tem exatamente 3 repetições.

---

## 9. Mapa do código

| Arquivo                                           | Papel                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/core/ExperimentConfig.ts`                    | leitura dos parâmetros de URL (função pura)                                                  |
| `src/core/InteractionObserver.ts`                 | interface do observador de interações; sem observador, o custo é uma checagem de `undefined` |
| `src/core/EventLogger.ts`                         | registro de eventos, cálculo de E1–E5, ciclo de fases e exportação com `frames`              |
| `src/core/LogExporter.ts`                         | localStorage, envio ao servidor de dev e download                                            |
| `src/core/FrameSampler.ts`                        | amostras por quadro em `Float64Array` pré-alocados (`?perf=1`)                               |
| `src/core/LoadMetrics.ts`                         | tipo e formatação das métricas de carga                                                      |
| `src/core/Scenarios.ts`                           | cenários e `C4_PAIR`                                                                         |
| `src/core/XRControllerManager.ts`                 | avisa sobre laser e alvo, arraste, `sync` (B/Y) e marca de fase (A/X), por borda de subida   |
| `src/core/VRMenu.ts`                              | avisa sobre hover e clique de botões                                                         |
| `src/core/builders/BallAndStickBuilder.ts`        | condição instanciada ou não instanciada                                                      |
| `src/core/parsers/PDBParser.ts`                   | tempos das etapas (a) e (b)                                                                  |
| `src/components/MoleculeViewer/MoleculeViewer.ts` | tempos (c) e total, ganchos por quadro no `renderLoop(time, frame)`, carga lado a lado        |
| `src/components/Buttons/LogExportButton.ts`       | botões de exportação (só repassam cliques)                                                   |
| `src/main.ts`                                     | liga as peças conforme os parâmetros                                                         |
| `vite.config.ts`                                  | plugin `protvr-log-sink` (só em `npm run dev`)                                               |
| `analysis/`                                       | scripts Python (ver `analysis/README.md`)                                                    |
