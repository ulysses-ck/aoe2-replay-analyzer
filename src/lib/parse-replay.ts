import path from "node:path";
import { Worker } from "node:worker_threads";

import type { ReplayModel } from "./types";

/**
 * Cliente del parser. El trabajo pesado vive en `workers/parse-replay.mjs`,
 * que corre en un worker thread por dos razones:
 *
 * 1. `aoe2rec-js` es WASM y en algunos replays muere con un trap
 *    (`RuntimeError: unreachable`). En el hilo principal eso se lleva puesto el
 *    server; aislado, se atrapa y se cae al parser de respaldo.
 * 2. Parsear ~500k operaciones bloquea el event loop más de un segundo.
 *
 * El worker se resuelve por ruta porque el bundler no puede seguir un módulo que
 * Node carga en runtime: tiene que existir tal cual en el deploy.
 */

export type ParseErrorCode = "unsupported" | "timeout" | "crashed";

export class ReplayParseError extends Error {
  readonly code: ParseErrorCode;

  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.name = "ReplayParseError";
    this.code = code;
  }
}

const WORKER_PATH = path.join(process.cwd(), "workers", "parse-replay.mjs");
const TIMEOUT_MS = 120_000;

type WorkerResult =
  | { ok: true; model: ReplayModel; fallbackReason?: string }
  | { ok: false; code: ParseErrorCode; message: string; fallback?: string };

export function parseReplay(buffer: ArrayBuffer, fileName: string): Promise<ReplayModel> {
  return new Promise<ReplayModel>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const worker = new Worker(WORKER_PATH, {
      workerData: { buffer, fileName },
      transferList: [buffer],
    });

    const timer = setTimeout(() => {
      void worker.terminate();
      finish(() => reject(new ReplayParseError("timeout", "El parseo tardó demasiado")));
    }, TIMEOUT_MS);

    worker.once("message", (result: WorkerResult) => {
      if (result.ok) {
        finish(() => resolve(result.model));
      } else {
        finish(() =>
          reject(
            new ReplayParseError(
              result.code,
              result.fallback ? `${result.message} / ${result.fallback}` : result.message,
            ),
          ),
        );
      }
      void worker.terminate();
    });

    worker.once("error", (error) => {
      finish(() => reject(new ReplayParseError("crashed", error.message)));
    });

    worker.once("exit", (code) => {
      finish(() => reject(new ReplayParseError("crashed", `El worker salió con código ${code}`)));
    });
  });
}
