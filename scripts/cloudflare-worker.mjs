import { DurableObject } from 'cloudflare:workers';
import app from './app.js';
import { DurableState } from './durable-state.mjs';

// Read by src/lib/server/state.ts. The adapter's worker passes no per-request
// platform, so the one Durable Object hands its storage to the app this way.
const DURABLE_STATE = Symbol.for('micropub-publisher.durable-state');
// Read by src/routes/syndication/run: only this object's alarm knows it.
const ALARM_TOKEN = Symbol.for('micropub-publisher.alarm-token');
const ALARM_PATH = '/syndication/run';

export class Publisher extends DurableObject {
  #pending = Promise.resolve();
  constructor(ctx, env) {
    super(ctx, env);
    globalThis[DURABLE_STATE] = new DurableState(ctx.storage);
    globalThis[ALARM_TOKEN] = crypto.randomUUID();
  }
  async alarm() {
    // Runs through the same queue as requests, so its GitHub writes never race them.
    const url = new URL(ALARM_PATH, this.env.PUBLIC_APP_URL);
    const response = await this.fetch(
      new Request(url, {
        method: 'POST',
        headers: { 'x-publisher-alarm': globalThis[ALARM_TOKEN] }
      })
    );
    if (!response.ok) console.error(`Alarm failed: ${response.status}`);
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
    if (new URL(request.url).pathname === ALARM_PATH) return new Response(null, { status: 404 });
    return env.PUBLISHER.getByName('publisher').fetch(request);
  }
};
