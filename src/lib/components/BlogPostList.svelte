<script lang="ts">
  import { FileText, FilePenLine } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import { browser } from '$app/environment';

  interface BlogPostFileInfo {
    filename: string;
    path: string;
    slug: string;
    date: string;
  }

  interface Props {
    onSelectPost: (path: string, isDraft: boolean) => void;
    currentPath?: string;
    hasDraft?: boolean;
    request?: (url: string) => Promise<Response>;
    onLoad?: (posts: BlogPostFileInfo[]) => void;
  }

  let {
    onSelectPost,
    currentPath = '',
    hasDraft = false,
    request = fetch,
    onLoad
  }: Props = $props();

  let posts = $state<BlogPostFileInfo[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Load posts from API
  async function loadPosts() {
    try {
      loading = true;
      error = '';
      const response = await request('/api/posts');

      if (!response.ok) {
        throw new Error('Failed to load posts');
      }

      posts = await response.json();
      onLoad?.(posts);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load posts';
      console.error('Error loading posts:', err);
    } finally {
      loading = false;
    }
  }

  // Load posts when component mounts
  $effect(() => {
    if (browser) {
      untrack(loadPosts);
    }
  });

  function formatDate(dateStr: string): string {
    // Filename dates are calendar days; formatting them in UTC keeps the day intact.
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    });
  }
</script>

<div class="flex h-full flex-col">
  <div class="mb-2 flex items-center justify-between px-1">
    <h2 class="text-xs font-semibold tracking-wide text-surface-600-400 uppercase">Recent</h2>
    <button
      type="button"
      onclick={() => loadPosts()}
      disabled={loading}
      class="text-xs text-surface-600-400 hover:text-surface-950-50 disabled:opacity-50"
    >
      {loading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  {#if error}
    <div class="text-error-900-50 mb-3 rounded-lg bg-error-50-950 p-3 text-sm">
      {error}
    </div>
  {/if}

  <div class="-mx-1 flex-1 space-y-0.5 overflow-y-auto px-1 pb-3">
    <!-- Draft post (if exists) -->
    {#if hasDraft}
      <button
        type="button"
        onclick={() => onSelectPost('', true)}
        class="flex w-full items-start gap-3 rounded-lg bg-primary-50-950 px-3 py-2 text-left hover:bg-primary-100-900 {currentPath ===
        ''
          ? 'ring-1 ring-primary-500'
          : ''}"
      >
        <FilePenLine class="mt-0.5 size-4 shrink-0 text-primary-600-400" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">Unsaved Draft</div>
          <div class="text-xs text-surface-600-400">Click to continue editing</div>
        </div>
      </button>
    {/if}

    <!-- Existing posts -->
    {#if loading}
      <div class="py-8 text-center text-sm text-surface-600-400">Loading posts...</div>
    {:else if posts.length === 0}
      <div class="py-8 text-center text-sm text-surface-600-400">No blog posts found</div>
    {:else}
      {#each posts as post (post.path)}
        <button
          type="button"
          onclick={() => onSelectPost(post.path, false)}
          aria-current={currentPath === post.path ? 'page' : undefined}
          class="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-100-900 {currentPath ===
          post.path
            ? 'bg-surface-100-900 font-medium'
            : ''}"
        >
          <FileText class="mt-0.5 size-4 shrink-0 text-surface-500" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm">{post.slug}</div>
            <div class="text-xs text-surface-600-400">{formatDate(post.date)}</div>
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>
