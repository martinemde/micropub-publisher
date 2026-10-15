import { PUBLISHER_RUNTIME } from '$app/env/private';

/** Persistent maps owned by the production Durable Object (scripts/durable-state.mjs). */
interface DurableState {
  getMap<T>(name: string): Map<string, T>;
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
