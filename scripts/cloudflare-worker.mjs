import { DurableObject } from 'cloudflare:workers';
import app from './app.js';
import { DurableState } from './durable-state.mjs';

export class Publisher extends DurableObject {
  #pending = Promise.resolve();
  constructor(ctx, env) {
    super(ctx, env);
    this.state = new DurableState(ctx.storage);
  }
  fetch(request) {
    // One owner for credentials, token refresh, replay protection, and GitHub writes.
    // A promise queue allows slow GitHub I/O without blockConcurrencyWhile's timeout.
    const response = this.#pending.then(() =>
      app.fetch(request, { ...this.env, PUBLISHER_STATE: this.state }, this.ctx)
    );
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
