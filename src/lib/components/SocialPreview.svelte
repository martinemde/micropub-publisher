<script lang="ts">
  import { Copy, ExternalLink } from '@lucide/svelte';
  import {
    BLUESKY_LIMIT,
    X_LIMIT,
    composeBlueskyPost,
    composeXPost,
    graphemes,
    xLength,
    type Card
  } from '#lib/social-posts.ts';
  import type { MicropubProperties } from '#lib/post-properties.ts';

  // What the publisher will post to Bluesky and what to paste into X, composed
  // by the same code the publisher runs. The link card's title, description,
  // and image come from the live page then; this approximates them.
  let {
    properties,
    permalink,
    card,
    bluesky,
    willPost = false
  }: {
    properties: MicropubProperties;
    permalink: string;
    card: Omit<Card, 'uri'>;
    /** The Bluesky account to show, when the post will be copied there. */
    bluesky?: { name: string; handle: string };
    /** Whether saving will post it to Bluesky. */
    willPost?: boolean;
  } = $props();

  const blueskyPost = $derived(composeBlueskyPost(properties, permalink, card));
  const xPost = $derived(composeXPost(properties, permalink));
  const host = $derived(new URL(permalink).host);
  let copied = $state(false);
  // An image that can't load shows no thumbnail, as on Bluesky.
  let failedImage = $state<string | undefined>();

  /** The post text as runs, with link facets marked. */
  const runs = $derived.by(() => {
    const { text, links } = blueskyPost;
    const parts: { text: string; uri?: string }[] = [];
    let at = 0;
    for (const link of [...links].sort((a, b) => a.start - b.start)) {
      if (link.start > at) parts.push({ text: text.slice(at, link.start) });
      parts.push({ text: text.slice(link.start, link.end), uri: link.uri });
      at = link.end;
    }
    if (at < text.length) parts.push({ text: text.slice(at) });
    return parts;
  });

  async function copyXPost() {
    await navigator.clipboard.writeText(xPost);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<section aria-label="Social posts" class="mt-10 space-y-6 border-t border-surface-200-800 pt-6">
  {#if bluesky}
    <div>
      <h2 class="mb-2 flex items-baseline justify-between gap-3 text-sm font-semibold">
        <span
          >Bluesky <span class="font-normal text-surface-600-400"
            >{willPost
              ? '· posts after the deploy'
              : '· check “Post to Bluesky” to post this'}</span
          ></span
        >
        <span
          class={[
            'font-normal tabular-nums',
            graphemes(blueskyPost.text) > BLUESKY_LIMIT ? 'text-error-600-400' : 'text-surface-600-400'
          ]}>{graphemes(blueskyPost.text)} / {BLUESKY_LIMIT}</span
        >
      </h2>
      <article
        aria-label="Bluesky post preview"
        class="rounded-xl border border-surface-200-800 bg-surface-50-950 p-4 text-[15px] leading-snug"
      >
        <header class="mb-1 flex items-baseline gap-1.5">
          <span class="font-semibold">{bluesky.name}</span>
          <span class="truncate text-surface-600-400">{bluesky.handle} · now</span>
        </header>
        <p class="whitespace-pre-wrap">
          {#each runs as run, index (index)}{#if run.uri}<span class="text-primary-600-400"
                >{run.text}</span
              >{:else}{run.text}{/if}{/each}
        </p>
        {#if blueskyPost.card}
          <div class="mt-3 overflow-hidden rounded-lg border border-surface-200-800">
            {#if blueskyPost.card.image && failedImage !== blueskyPost.card.image}
              <img
                src={blueskyPost.card.image}
                alt=""
                onerror={() => (failedImage = blueskyPost.card?.image)}
                class="aspect-[1200/630] w-full object-cover"
              />
            {/if}
            <div class="space-y-0.5 p-3 text-sm">
              <p class="font-semibold">{blueskyPost.card.title}</p>
              {#if blueskyPost.card.description}
                <p class="line-clamp-2 text-surface-600-400">{blueskyPost.card.description}</p>
              {/if}
              <p class="border-t border-surface-200-800 pt-1.5 text-xs text-surface-600-400">
                {host}
              </p>
            </div>
          </div>
        {/if}
      </article>
    </div>
  {/if}

  <div>
    <h2 class="mb-2 flex items-baseline justify-between text-sm font-semibold">
      X
      <span
        class={[
          'font-normal tabular-nums',
          xLength(xPost) > X_LIMIT ? 'text-error-600-400' : 'text-surface-600-400'
        ]}>{xLength(xPost)} / {X_LIMIT}</span
      >
    </h2>
    <p
      aria-label="X post text"
      class="rounded-xl border border-surface-200-800 bg-surface-50-950 p-4 text-[15px] leading-snug whitespace-pre-wrap"
    >
      {xPost}
    </p>
    <div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
      <button
        type="button"
        onclick={copyXPost}
        class="flex items-center gap-1.5 rounded-lg border border-surface-200-800 px-3 py-1.5 hover:bg-surface-100-900"
      >
        <Copy class="size-4" aria-hidden="true" />
        {copied ? 'Copied' : 'Copy'}
      </button>
      <!-- X's share link opens a prefilled post; it costs nothing, unlike the API. -->
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a
        href={`https://x.com/intent/post?text=${encodeURIComponent(xPost)}`}
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1.5 rounded-lg border border-surface-200-800 px-3 py-1.5 hover:bg-surface-100-900"
      >
        <ExternalLink class="size-4" aria-hidden="true" />
        Open in X
      </a>
      <span class="text-surface-600-400">Post it after the deploy so the link card loads.</span>
    </div>
  </div>
</section>
