import { isHttpError } from '@sveltejs/kit';
import { BLUESKY_APP_PASSWORD, BLUESKY_IDENTIFIER, BLUESKY_SERVICE } from '$app/env/private';
import { composeBlueskyPost, openGraph, postToBluesky } from './bluesky.ts';
import { invalid, readProperties, type MicropubProperties } from './micropub.ts';
import { findPost, mutatePost } from './micropub-posts.ts';
import { scheduleAlarm, stateMap } from './state.ts';
import { createStorageBackend } from './storage/factory.ts';

/** A Micropub `syndicate-to` entry. */
export interface SyndicationTarget {
  uid: string;
  name: string;
  service: { name: string; url: string };
  user: { name: string; url: string };
}

/** Targets whose credentials are configured. Bluesky is the only one so far. */
export function syndicationTargets(): SyndicationTarget[] {
  if (!BLUESKY_IDENTIFIER || !BLUESKY_APP_PASSWORD) return [];
  const profile = `https://bsky.app/profile/${BLUESKY_IDENTIFIER}`;
  return [
    {
      uid: profile,
      name: `Bluesky (@${BLUESKY_IDENTIFIER})`,
      service: { name: 'Bluesky', url: 'https://bsky.app/' },
      user: { name: `@${BLUESKY_IDENTIFIER}`, url: profile }
    }
  ];
}

/** Validates `mp-syndicate-to` against the configured targets. */
export function requestedTargets(value: unknown): string[] {
  if (value === undefined) return [];
  const uids = Array.isArray(value) ? value : [value];
  const known = new Set(syndicationTargets().map((target) => target.uid));
  for (const uid of uids) {
    if (typeof uid !== 'string' || !known.has(uid)) invalid('Unknown syndication target');
  }
  return [...new Set(uids as string[])];
}

/** Whether a post already lists a copy on the target's service. */
function alreadySyndicated(properties: MicropubProperties, uid: string): boolean {
  const target = syndicationTargets().find((target) => target.uid === uid);
  return (properties.syndication ?? []).some(
    (url) => typeof url === 'string' && !!target && url.startsWith(target.service.url)
  );
}

export interface SyndicationJob {
  /** The post's permalink. */
  url: string;
  targets: string[];
  /** Copies already made, by target uid, so a retry never posts twice. */
  done: Record<string, string>;
  /** The GitHub credential reference of the writer who asked. */
  credential: string;
  createdAt: number;
  attempts: number;
  nextAt: number;
  error?: string;
}

const jobs = stateMap<SyndicationJob>('syndication-jobs');
/** Minutes between checks; after the last one the job gives up (about 30 minutes). */
const BACKOFF_MINUTES = [1, 2, 4, 8, 15];

export function syndicationJob(url: string): SyndicationJob | undefined {
  return jobs.get(url);
}

/** Queue copies of a post, made once its permalink is live. */
export function queueSyndication(url: string, targets: string[], credential: string): void {
  if (!targets.length) return;
  const existing = jobs.get(url);
  const now = Date.now();
  jobs.set(url, {
    url,
    targets: [...new Set([...(existing?.targets ?? []), ...targets])],
    done: existing?.done ?? {},
    credential,
    createdAt: now,
    attempts: 0,
    nextAt: now + BACKOFF_MINUTES[0] * 60_000
  });
  scheduleNext();
}

function scheduleNext(): void {
  const next = Math.min(...[...jobs.values()].filter((job) => !job.error).map((job) => job.nextAt));
  if (Number.isFinite(next)) scheduleAlarm(next, runSyndication);
}

class NotLive extends Error {}

/** Run every due job. Called by the Durable Object's alarm. */
export async function runSyndication(now = Date.now()): Promise<void> {
  for (const [url, job] of [...jobs]) {
    if (job.error || job.nextAt > now) continue;
    try {
      await syndicate(job);
      jobs.delete(url);
    } catch (error) {
      const message = isHttpError(error)
        ? error.body.message
        : error instanceof Error
          ? error.message
          : 'Unknown error';
      const attempts = job.attempts + 1;
      if (attempts >= BACKOFF_MINUTES.length) {
        console.error(`Syndication gave up for ${url}: ${message}`);
        jobs.set(url, { ...job, attempts, error: message });
      } else {
        jobs.set(url, {
          ...job,
          attempts,
          nextAt: now + BACKOFF_MINUTES[attempts] * 60_000
        });
      }
    }
  }
  scheduleNext();
}

async function syndicate(job: SyndicationJob): Promise<void> {
  // The permalink answers 200 once the deploy carrying the post is live.
  const page = await fetch(job.url, { signal: AbortSignal.timeout(20000) });
  if (!page.ok) throw new NotLive(`${job.url} is not live yet (${page.status})`);
  const html = await page.text();

  const backend = createStorageBackend(job.credential);
  const file = await findPost(backend, job.url);
  const properties = readProperties(await backend.readFile(file.path));
  const status = properties['post-status']?.[0] ?? 'published';
  const visibility = properties.visibility?.[0] ?? 'public';
  // Drafts and hidden posts are never copied elsewhere.
  if (status !== 'published' || visibility === 'private' || visibility === 'unlisted') return;

  for (const uid of job.targets) {
    if (job.done[uid] || alreadySyndicated(properties, uid)) continue;
    const draft = composeBlueskyPost(properties, job.url, openGraph(html));
    job.done[uid] = await postToBluesky(
      {
        service: BLUESKY_SERVICE || 'https://bsky.social',
        identifier: BLUESKY_IDENTIFIER!,
        password: BLUESKY_APP_PASSWORD!
      },
      draft
    );
    jobs.set(job.url, job);
  }

  const copies = Object.values(job.done);
  if (copies.every((url) => properties.syndication?.includes(url))) return;
  await mutatePost(
    backend,
    { action: 'update', url: job.url, add: { syndication: copies } },
    `Syndicate post: ${file.slug}`
  );
}
