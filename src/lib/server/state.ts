import { PUBLISHER_RUNTIME } from '$app/env/private';

/** Persistent maps owned by the production Durable Object (scripts/durable-state.mjs). */
interface DurableState {
  getMap<T>(name: string): Map<string, T>;
  setAlarm(at: number): void;
}

/**
 * scripts/cloudflare-worker.mjs registers its Durable Object's state here. The
 * app only ever runs inside that one object, so its isolate holds a single owner.
 */
const DURABLE_STATE = Symbol.for('micropub-publisher.durable-state');

/** Local development uses memory; the production Durable Object supplies durable maps. */
export function stateMap<T>(name: string): Map<string, T> {
  const local = new Map<string, T>();
  return new Proxy(local, {
    get(_target, property) {
      const state = (globalThis as { [DURABLE_STATE]?: DurableState })[DURABLE_STATE];
      if (!state && PUBLISHER_RUNTIME === 'cloudflare') {
        throw new Error('Publisher state is only available inside its Durable Object');
      }
      const map = state ? state.getMap<T>(name) : local;
      const value = Reflect.get(map, property, map);
      return typeof value === 'function' ? value.bind(map) : value;
    }
  });
}

/**
 * Run `task` at `at`. The Durable Object's alarm survives restarts and calls
 * back through /syndication/run; local development uses a timer.
 */
export function scheduleAlarm(at: number, task: () => Promise<void>): void {
  const state = (globalThis as { [DURABLE_STATE]?: DurableState })[DURABLE_STATE];
  if (state) return state.setAlarm(at);
  if (PUBLISHER_RUNTIME === 'cloudflare') {
    throw new Error('Alarms are only available inside the Durable Object');
  }
  clearTimeout(localTimer);
  localTimer = setTimeout(
    () => task().catch((error) => console.error('Scheduled task failed:', error)),
    Math.max(0, at - Date.now())
  );
}
let localTimer: ReturnType<typeof setTimeout> | undefined;
