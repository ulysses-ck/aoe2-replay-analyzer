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

Para probar el build de producción:

```bash
pnpm build
pnpm start
```

## Arquitectura

| Pieza | Rol |
|---|---|
| `src/lib/parse-replay.ts` | Convierte el `.aoe2record` en un modelo compacto |
| `src/app/api/parse/route.ts` | `POST /api/parse` (multipart `file`) → JSON |
| `src/components/Analyzer.tsx` | Layout, upload, timeline, reloj de reproducción |
| `src/components/MapCanvas.tsx` | Canvas isométrico con zoom anclado y pan |
| `src/lib/types.ts` | Tipos compartidos y paleta de colores de jugador |

El parser es [`aoe2rec-js`](https://www.npmjs.com/package/aoe2rec-js) (WASM, MIT), que corre
en un route handler de Node. `next.config.ts` lo excluye del bundler con
`serverExternalPackages` porque carga un `.wasm` desde `node_modules`.

### Qué expone el replay

| Dato | Fuente | Nota |
|---|---|---|
| Edificio construido (`t`, x, y, tipo, jugador) | `Action > Build` | binario: f32 x@4, f32 y@8, u32 tipo@12 |
| Orden de movimiento (destino + `unit_ids`) | `Action > Move` | punto de destino, no trayectoria |
| Unidades entrenadas | `Action > DeQueue` | edificio + unidad + cantidad |
| Edades | `Chat` de sistema | `<player_id,N,AGE> ha avanzado a la Edad …` |
| Chat de jugadores | `Chat` | |
| Cámara del jugador grabado | `Viewlock` | ~1 muestra cada 50 ms |

**No** hay recursos, kills, HP ni posiciones continuas: el replay guarda órdenes, no estado.
Cualquier métrica de esos ejes requiere simular el motor o mostrar un proxy.

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

## Límites conocidos

- **Cobertura del parser.** `aoe2rec-js` falla con un panic en algunos replays
  (`bad magic`) incluso dentro del mismo build del juego. Falta un fallback
  (`agelens` o `mgz-fast`).
- **Edificios sin footprint real.** Todos se dibujan con el mismo volumen; el tipo está en
  el modelo pero todavía no se mapea a tamaño/forma.
- **Sin terreno ni doodads.** El mapa es el rombo de juego con grilla adaptativa.
- **Nombres de civilización** no se muestran a propósito: el mapeo de `civ_id` todavía no
  está validado y un nombre equivocado es peor que ninguno.

## Siguiente

- Fallback de parseo para los replays que rompen.
- Cámara que sigue al jugador (`Viewlock`) y heatmap de "a dónde miró".
- Deep link al viewport (`?t=&x=&y=&z=`).
- Índice de highlights (raids, batallas, picos de APM) reusando la heurística del MVP viejo.
