import { DurableObject } from 'cloudflare:workers';
import app from './app.js';
import { DurableState } from './durable-state.mjs';

// Read by src/lib/server/state.ts. The adapter's worker passes no per-request
// platform, so the one Durable Object hands its storage to the app this way.
const DURABLE_STATE = Symbol.for('micropub-publisher.durable-state');

export class Publisher extends DurableObject {
  #pending = Promise.resolve();
  constructor(ctx, env) {
    super(ctx, env);
    globalThis[DURABLE_STATE] = new DurableState(ctx.storage);
  }
  fetch(request) {
    // One owner for credentials, token refresh, replay protection, and GitHub writes.
    // A promise queue allows slow GitHub I/O without blockConcurrencyWhile's timeout.
    const response = this.#pending.then(() => app.fetch(request, this.env, this.ctx));
    this.#pending = response.then(
      () => {},
      () => {}
    );
    return response;
  }
}

export default {
  fetch(request, env) {
    return env.PUBLISHER.getByName('publisher').fetch(request);
  }
};
