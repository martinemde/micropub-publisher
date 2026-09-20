import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';

/** Local development uses memory; the production Durable Object supplies durable maps. */
export function stateMap<T>(name: string): Map<string, T> {
  const local = new Map<string, T>();
  return new Proxy(local, {
    get(_target, property) {
      let state: App.Platform['env']['PUBLISHER_STATE'];
      try {
        state = getRequestEvent().platform?.env.PUBLISHER_STATE;
      } catch {
        // Tests and the local conformance harness also call stores outside a request.
      }
      if (!state && env.PUBLISHER_RUNTIME === 'cloudflare') {
        throw new Error('Publisher state is only available inside its Durable Object');
      }
      const map = state ? state.getMap<T>(name) : local;
      const value = Reflect.get(map, property, map);
      return typeof value === 'function' ? value.bind(map) : value;
    }
  });
}
