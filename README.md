# AoE2 Replay Analyzer

Reproductor interactivo de replays de **Age of Empires II: Definitive Edition**. Subís un
`.aoe2record` y ves la partida sobre un mapa isométrico con zoom y pan, línea de tiempo,
jugadores, edificios y chat.

El parseo ocurre en el servidor: el archivo **no se guarda** en ningún lado.

## Estado

MVP funcional. Verificado end-to-end con un replay real de 7.25 MB (91.9 min, mapa 144,
3 jugadores): parseo en ~1.4 s y respuesta JSON de ~133 KB.

## Cómo correrlo

Requisitos: Node 20+ y pnpm.

```bash
pnpm install
pnpm dev
```

Abrí http://localhost:3000 y arrastrá un `.aoe2record` (suelen estar en
`Documents/My Games/Age of Empires 2 DE/<steam-id>/savegame/`).

Variables de entorno: todas opcionales, ver `.env.example`.

Para probar el build de producción:

```bash
pnpm build
pnpm start
```

## Arquitectura

| Pieza | Rol |
|---|---|
| `workers/parse-replay.mjs` | Parser en worker thread: `aoe2rec-js` y fallback `agelens` |
| `src/lib/parse-replay.ts` | Cliente del worker: timeout, aislamiento de fallos, tipos |
| `src/lib/replay-store.ts` | Cache en disco por hash del archivo (deep links) |
| `src/app/api/parse/route.ts` | `POST /api/parse` (multipart `file`) → JSON |
| `src/app/api/replay/[id]/route.ts` | `GET /api/replay/<id>` → modelo cacheado |
| `src/components/Analyzer.tsx` | Layout, upload, timeline, reloj de reproducción |
| `src/components/MapCanvas.tsx` | Canvas isométrico con zoom anclado y pan |
| `src/lib/types.ts` | Tipos compartidos y paleta de colores de jugador |

### Por qué un worker

El parser vive en un worker thread por dos motivos concretos:

1. **`aoe2rec-js` es WASM y puede matar el proceso.** En algunos replays del mismo
   build del juego muere con un trap (`RuntimeError: unreachable`) que en el hilo
   principal se lleva puesto el server. Aislado, se atrapa y se prueba el plan B.
2. **Parsear ~500k operaciones bloquea el event loop** más de un segundo; en un
   worker el resto de los requests sigue respondiendo.

El worker se referencia por ruta (`process.cwd()/workers/parse-replay.mjs`) para que
el código fuente sea el que corre en desarrollo, pero **Turbopack detecta el
`new Worker(...)` y además lo compila como entry propio** en el build de producción.
Consecuencia práctica: tocás `workers/parse-replay.mjs` y en `pnpm dev` se ve al
toque, pero con `pnpm build && pnpm start` hace falta reconstruir, porque el server
ejecuta el chunk emitido, no el archivo fuente.

Como el panic hook de Rust escribe el backtrace directo a `stderr` (no pasa por
`console.error`), el worker tapa `process.stderr.write` mientras intenta `aoe2rec`.
Sin eso, un replay inválido metía ~110 KB de backtrace en el log por request.

### Dos motores

| Motor | Cuándo | Qué aporta |
|---|---|---|
| `aoe2rec-js` (WASM) | Primero, siempre | más rápido; `unit_ids` en los `Move` |
| `agelens` (JS puro) | Si el primero falla | parsea replays que rompen el WASM; sin `unit_ids` |

Medición sobre un corpus real de 140 replays (builds 48987 a 57257):

| Categoría | Parseados | Detalle |
|---|---|---|
| Multijugador (`MP Replay`) | **84 / 84** | 100 % |
| Un jugador / campaña (`SP Replay`) | 22 / 55 | 40 % |
| **Total** | **107 / 140** | 76 % |

`aoe2rec-js` solo resuelve 42 de los 140; `agelens` rescata 65 más. Los 33 que
fallan con los dos son todos de un jugador: usan un layout de capítulos que
ninguno de los dos parsers contempla. Reproducir el número:

```bash
node scripts/parse-fixtures.mjs "/ruta/a/savegame"
```

`agelens` no incluye el prefijo de longitud en su decodificación de acciones y sus
campos de `Build` salen corridos, así que los decodificamos nosotros desde su
`payload.raw`: el registro es `[player u8][largo u16][payload]`, y el payload usa el
mismo layout que documenta la tabla de abajo.

Cuando se usa el fallback, la UI muestra un badge **parser alternativo** y el
`meta.engine` de la respuesta lo dice explícitamente.

### Deep links

Cada modelo parseado se guarda en disco bajo el hash del archivo, así que la URL
puede llevar el estado completo:

```
/?r=<id>&t=1800&x=70&y=90&z=300
```

`r` es el replay (hash del contenido), `t` el segundo, `x`/`y` el tile en el centro
del viewport y `z` el zoom. El botón **Copiar link** arma y copia esa URL; abrirla
restaura partida, instante y encuadre sin volver a subir nada.

El directorio del cache se configura con `REPLAY_CACHE_DIR` (ver `.env.example`);
por defecto es `./.cache/replays` y está en `.gitignore`. Subir dos veces el mismo
archivo no duplica nada. No hay purga automática todavía.

### Qué expone el replay

| Dato | Fuente | Nota |
|---|---|---|
| Edificio construido (`t`, x, y, tipo, jugador) | `Action > Build` | binario: f32 x@4, f32 y@8, u32 tipo@12 |
| Orden de movimiento (destino + `unit_ids`) | `Action > Move` | punto de destino, no trayectoria |
| Unidades entrenadas | `Action > DeQueue` | edificio + unidad + cantidad |
| Edades | `Chat` de sistema | `<player_id,N,AGE> ha avanzado a la Edad …` |
| Chat de jugadores | `Chat` | |
| Cámara del jugador grabado | `Viewlock` | ~1 muestra cada ~100 ms, comprimida a los cambios |

**No** hay recursos, kills, HP ni posiciones continuas: el replay guarda órdenes, no estado.
Cualquier métrica de esos ejes requiere simular el motor o mostrar un proxy.

### Cámara del dueño

El replay graba la cámara de **quien lo grabó**, no de todos: hay una operación
`Viewlock` por sync con `{x, y, player_id}`. Ese `player_id` es el `player_number`
del dueño (el `rec_owner` de `Pregame` es un slot de 8 y en multijugador no
coincide, así que no sirve para cruzar). El modelo expone la serie comprimida en
`model.viewlocks` (`[t, x, y]`, sólo los cambios) y marca `owner: true` en la
lista de jugadores.

Con el botón **Seguir al dueño** el viewport se centra en esa cámara y avanza con
el reloj; arrastrar el mapa desactiva el seguimiento para no pelear por el
encuadre. Si el replay no trae viewlocks (pasa en algunos `SP`), el botón no
aparece.

## Atajos

| Tecla | Acción |
|---|---|
| `Espacio` | Play / pausa |
| `←` / `→` | ±5 s |
| Rueda | Zoom anclado al cursor |
| Arrastrar | Pan |
| Doble click / botón | Reset de vista |

## Verificación

`scripts/capture.mjs` levanta un navegador real, sube un replay y saca capturas de cada
estado (upload, mapa, 12 min, 30 min, zoom, play). Necesita la app corriendo y un Chromium
de Playwright:

```bash
node ./node_modules/playwright/cli.js install chromium --only-shell
node scripts/capture.mjs /ruta/al/replay.aoe2record /tmp/shots
```

> Corré el script con el `node` del sistema, no con `pnpm exec`: en WSL `pnpm` puede
> resolver al shim de Windows y Playwright entonces busca binarios `win64`.

Para medir cobertura de parseo sobre un lote de replays (usa el mismo worker que la API):

```bash
node scripts/parse-fixtures.mjs "/ruta/a/savegame"
```

Reporta por archivo qué motor resolvió, tiempo, duración, tamaño de mapa y cuántos
edificios/movimientos/mensajes salieron.

## Límites conocidos

- **Cobertura del parser.** Multijugador entra completo; los replays de un jugador
  fallan en 33 de 55 casos. Ahí la API devuelve 422 con código, sin tumbar el server.
- **Edificios sin footprint real.** Todos se dibujan con el mismo volumen; el tipo está en
  el modelo pero todavía no se mapea a tamaño/forma.
- **Sin terreno ni doodads.** El mapa es el rombo de juego con grilla adaptativa. `agelens`
  sí expone los tiles del mapa; falta usarlos.
- **Nombres de civilización** no se muestran a propósito: el mapeo de `civ_id` todavía no
  está validado y un nombre equivocado es peor que ninguno.

## Siguiente

- Usar los tiles de `agelens` para dibujar terreno real.
- Heatmap de "a dónde miró" reusando la serie de `viewlocks`.
- Deep link al viewport (`?t=&x=&y=&z=`).
- Índice de highlights (raids, batallas, picos de APM) reusando la heurística del MVP viejo.
