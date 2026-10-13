/**
 * Main-thread client for swarmWorker.ts: posts a layout request, resolves
 * the matching promise when its response arrives. One worker, reused across
 * every call — spinning up a fresh worker per request would burn the same
 * ~ms-scale startup cost repeatedly for no benefit.
 */
import type { SwarmItem, SwarmOpts, PositionedDot } from "./swarm.ts";
import type { SwarmWorkerRequest, SwarmWorkerResponse } from "./swarmWorker.ts";

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, (dots: PositionedDot[]) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./swarmWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<SwarmWorkerResponse>) => {
      const resolve = pending.get(event.data.id);
      if (resolve) {
        resolve(event.data.dots);
        pending.delete(event.data.id);
      }
    };
  }
  return worker;
}

export function packSwarmAsync(items: SwarmItem[], opts: SwarmOpts): Promise<PositionedDot[]> {
  const id = nextRequestId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const request: SwarmWorkerRequest = { id, items, opts };
    getWorker().postMessage(request);
  });
}
