import { error } from '@sveltejs/kit';
import { runSyndication } from '#lib/server/syndication.ts';
import type { RequestHandler } from './$types';

const ALARM_TOKEN = Symbol.for('micropub-publisher.alarm-token');

/**
 * The Durable Object's alarm calls this to run due syndication jobs. The outer
 * Worker refuses this path, and the token lives only in the object's isolate.
 */
export const POST: RequestHandler = async ({ request }) => {
  const token = (globalThis as { [ALARM_TOKEN]?: string })[ALARM_TOKEN];
  if (!token || request.headers.get('x-publisher-alarm') !== token) error(404, 'Not found');
  await runSyndication();
  return new Response(null, { status: 204 });
};
