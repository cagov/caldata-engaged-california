/**
 * Web Worker entry point. packSwarm is pure and DOM-free (see swarm.ts), so
 * running it here instead of the main thread is a drop-in move — no
 * DOM/window dependency to work around. A single layout call over the full
 * 2,678-respondent sample (the "All respondents" default view) costs a few
 * seconds; off the main thread that cost is a visible wait (see Beeswarm's
 * "Arranging N respondents…" status) instead of a multi-second UI freeze.
 */
import { packSwarm, type SwarmItem, type SwarmOpts } from "./swarm.ts";

export interface SwarmWorkerRequest {
  id: number;
  items: SwarmItem[];
  opts: SwarmOpts;
}

export interface SwarmWorkerResponse {
  id: number;
  dots: ReturnType<typeof packSwarm>;
}

self.onmessage = (event: MessageEvent<SwarmWorkerRequest>) => {
  const { id, items, opts } = event.data;
  const dots = packSwarm(items, opts);
  const response: SwarmWorkerResponse = { id, dots };
  (self as unknown as { postMessage: (msg: SwarmWorkerResponse) => void }).postMessage(response);
};
