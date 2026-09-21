<script lang="ts">
  import remarkHtml from 'remark-html';
  import remarkParse from 'remark-parse';
  import type { PageData } from './$types';
  import { Upload, Save } from 'lucide-svelte';
  import { resolve } from '$app/paths';
  import { unified } from 'unified';
  import { browser } from '$app/environment';
  import BlogPostList from '$lib/components/BlogPostList.svelte';

  import ActionLog, { type Action } from '$lib/components/ActionLog.svelte';
  import { postTypes, inferPostType, type PostType, type Photo } from '$lib/editor/posts';

  let { data }: { data: PageData } = $props();

  const STORAGE_KEY = 'blog-editor-draft';

  interface EditorDraft {
    postType?: PostType;
    bookmark?: string;
    photos?: Photo[];
    drafts?: Partial<Record<PostType, EditorDraft>>;
    title: string;
    content: string;
    slug: string;
    description: string;
    categories: string;
    published: boolean;
    publishedAt?: string;
    autoSlug: boolean;
    savedAt: string;
    currentPath: string;
  }

  // Form state
  function localDateTime(date: Date): string {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1);
  }

  let postType = $state<PostType>('article');
  let bookmark = $state('');
  let photos = $state<Photo[]>([]);
  let drafts: Partial<Record<PostType, EditorDraft>> = {};
  let actions = $state<Action[]>([]);
  let nextAction = 0;

  async function loggedFetch(url: string, init?: RequestInit): Promise<Response> {
    const id = ++nextAction;
    const method = init?.method ?? 'GET';
    let request = `${method} ${url}`;
    if (typeof init?.body === 'string') {
      request += `\nContent-Type: application/json\n\n${JSON.stringify(JSON.parse(init.body), null, 2)}`;
    } else if (init?.body instanceof FormData) {
      request += '\nContent-Type: multipart/form-data (browser-generated boundary)\n\n';
      request += [...init.body]
        .map(
          ([key, value]) =>
            `${key}: ${typeof value === 'string' ? value : `${value.name} (${value.type}, ${value.size} bytes; binary omitted)`}`
        )
        .join('\n');
    }
    const explanation = url.startsWith('/api/')
      ? 'Publisher repository API, not part of Micropub.'
      : url === '/micropub/media'
        ? 'The media endpoint stores a file and returns its URL in Location. The post is saved separately.'
        : 'Micropub uses h-entry for all four post types. Properties determine the kind of post. Creation returns 201 and Location; an update uses action: update and returns 204.';
    actions.push({ id, time: new Date().toLocaleTimeString(), method, url, explanation, request });
    const complete = (result: Partial<Action>) => {
      actions = actions.map((action) => (action.id === id ? { ...action, ...result } : action));
    };
    try {
      const response = await fetch(url, init);
      const body = await response.clone().text();
      const headers = ['content-type', 'location'].flatMap((key) => {
        const value = response.headers.get(key);
        return value ? [`${key}: ${value}`] : [];
      });
      complete({
        status: response.status,
        response: [
          `HTTP ${response.status} ${response.statusText}`,
          ...headers,
          '',
          body || '(empty body)'
        ].join('\n')
      });
      return response;
    } catch (err) {
      complete({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  let title = $state('');
  let content = $state('');
  let slug = $state('');
  let description = $state('');
  let categories = $state('');
  let published = $state(false);
  let publishedAt = $state(localDateTime(new Date()));
  let autoSlug = $state(true);
  let currentPath = $state(''); // Empty string means new post, otherwise path to existing post

  function postState() {
    return {
      postType,
      bookmark,
      photos: $state.snapshot(photos),
      title,
      content,
      slug,
      description,
      categories,
      published,
      publishedAt,
      currentPath
    };
  }

  // Local draft backups are separate from the last loaded or submitted post.
  let savedPost = $state(JSON.stringify(postState()));

  // UI state
  let submitting = $state(false);
  let error = $state('');
  let success = $state('');
  let uploadingImage = $state(false);

  // Auto-save state
  let saveStatus: 'idle' | 'saving' | 'saved' = $state('idle');
  let lastSaved = $state<Date | null>(null);

  // Preview state
  let activeTab: 'edit' | 'preview' = $state('edit');
  let previewHtml = $state('');
  let previewLoading = $state(false);

  // Load draft from localStorage on mount
  $effect(() => {
    if (!browser) return;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const draft: EditorDraft = JSON.parse(saved);
        postType = draft.postType ?? 'article';
        bookmark = draft.bookmark ?? '';
        photos = draft.photos ?? [];
        drafts = draft.drafts ?? {};
        title = draft.title;
        content = draft.content;
        slug = draft.slug;
        description = draft.description;
        categories = draft.categories;
        published = draft.published ?? false;
        publishedAt = draft.publishedAt ?? localDateTime(new Date());
        autoSlug = draft.autoSlug;
        currentPath = draft.currentPath || '';
        lastSaved = new Date(draft.savedAt);
        saveStatus = 'saved';
      }
    } catch (err) {
      console.error('Failed to load draft:', err);
    }
  });

  // Auto-generate slug from title
  $effect(() => {
    if (autoSlug && title) {
      slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }
  });

  // Debounced auto-save to localStorage
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  function saveDraft() {
    if (!browser) return;

    saveStatus = 'saving';

    try {
      const draft: EditorDraft = {
        postType,
        bookmark,
        photos: $state.snapshot(photos),
        drafts,
        title,
        content,
        slug,
        description,
        categories,
        published,
        publishedAt,
        autoSlug,
        currentPath,
        savedAt: new Date().toISOString()
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      lastSaved = new Date();
      saveStatus = 'saved';
    } catch (err) {
      console.error('Failed to save draft:', err);
      saveStatus = 'idle';
    }
  }

  function clearDraft() {
    if (!browser) return;

    if (saveTimeout) clearTimeout(saveTimeout);

    try {
      delete drafts[postType];
      if (Object.keys(drafts).length) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...postState(), autoSlug, savedAt: new Date().toISOString(), drafts })
        );
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      lastSaved = null;
      saveStatus = 'idle';
    } catch (err) {
      console.error('Failed to clear draft:', err);
    }
  }

  function switchType(type: PostType) {
    if (currentPath || submitting || uploadingImage || type === postType) return;
    drafts[postType] = { ...postState(), autoSlug, savedAt: new Date().toISOString() };
    restoreComposer(type);
    saveDraft();
  }

  function restoreComposer(type: PostType) {
    const draft = drafts[type];
    postType = type;
    title = draft?.title ?? '';
    content = draft?.content ?? '';
    bookmark = draft?.bookmark ?? '';
    photos = draft?.photos ?? [];
    slug = draft?.slug ?? '';
    description = draft?.description ?? '';
    categories = draft?.categories ?? '';
    published = draft?.published ?? false;
    publishedAt = draft?.publishedAt ?? localDateTime(new Date());
    autoSlug = draft?.autoSlug ?? true;
    currentPath = '';
    error = '';
    success = '';
    activeTab = 'edit';
  }

  function newPost() {
    if (hasUnsavedChanges() && !confirm('Discard unsubmitted changes and start a new post?'))
      return;
    delete drafts[postType];
    restoreComposer(postType);
    savedPost = JSON.stringify(postState());
    clearDraft();
  }

  function formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 10) return 'just now';
    if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes === 1) return '1 minute ago';
    if (diffInMinutes < 60) return `${diffInMinutes} minutes ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours === 1) return '1 hour ago';
    if (diffInHours < 24) return `${diffInHours} hours ago`;

    return date.toLocaleDateString();
  }

  // Check if current form has unsaved changes
  function hasUnsavedChanges(): boolean {
    return JSON.stringify(postState()) !== savedPost;
  }

  // Load a blog post from the API
  async function loadPost(path: string) {
    if (!path) {
      // Load draft from localStorage (already loaded on mount)
      return;
    }

    try {
      error = '';
      const response = await loggedFetch(`/api/posts/read?path=${encodeURIComponent(path)}`);

      if (!response.ok) {
        throw new Error('Failed to load post');
      }

      const { frontmatter, content: postContent } = await response.json();

      // Populate form
      const source = frontmatter.micropub?.properties;
      postType = source ? inferPostType(source) : 'article';
      bookmark = source?.['bookmark-of']?.[0] ?? '';
      photos = (source?.photo ?? []).map((photo: string | Photo) =>
        typeof photo === 'string' ? { value: photo, alt: '' } : { ...photo }
      );
      title = source ? (source.name?.[0] ?? '') : frontmatter.title || '';
      slug = frontmatter.slug || '';
      description = frontmatter.description || '';
      published = frontmatter.published ?? false;
      const filenameDate = path
        .split('/')
        .pop()
        ?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      publishedAt = localDateTime(new Date(frontmatter.date || filenameDate || Date.now()));
      categories = frontmatter.categories?.join(', ') || '';
      const originalContent = frontmatter.micropub?.properties?.content?.[0];
      content =
        typeof originalContent === 'string'
          ? originalContent
          : (originalContent?.html ?? originalContent?.text ?? (source ? '' : postContent));
      currentPath = path;
      autoSlug = false; // Don't auto-generate slug for existing posts
      savedPost = JSON.stringify(postState());

      // Clear draft from localStorage since we're loading an existing post
      clearDraft();
    } catch (err) {
      error = `Failed to load post: ${err instanceof Error ? err.message : 'Unknown error'}`;
      console.error('Error loading post:', err);
    }
  }

  // Handle selecting a post from the list
  async function handleSelectPost(path: string, isDraft: boolean) {
    if (submitting || uploadingImage) return;
    // If selecting draft, just reload from localStorage (already loaded)
    if (isDraft) {
      return;
    }

    // Check if there are unsaved changes
    if (hasUnsavedChanges()) {
      const confirmed = confirm(
        'You have unsaved changes in your draft. Loading a different post will discard these changes. Continue?'
      );
      if (!confirmed) {
        return;
      }
    }

    await loadPost(path);
  }

  // Auto-save when form fields change (debounced 1 second)
  $effect(() => {
    // Watch all form fields
    const _ = [
      postType,
      bookmark,
      photos,
      title,
      content,
      slug,
      description,
      categories,
      published,
      publishedAt,
      autoSlug
    ];

    // Only back up changes that haven't been submitted.
    if (!hasUnsavedChanges()) return;

    // Clear existing timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Set new timeout
    saveTimeout = setTimeout(() => {
      saveDraft();
    }, 1000);

    // Cleanup on effect re-run or unmount
    return () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
    };
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    success = '';
    if (submitting || uploadingImage) return;
    if ((postType === 'article' || postType === 'note') && !content.trim()) {
      error = 'Write some content before saving.';
      activeTab = 'edit';
      return;
    }
    if (postType === 'photo' && !photos.length) {
      error = 'Add a photo before saving.';
      return;
    }
    submitting = true;
    const submittedPost = postState();

    try {
      const postDate = new Date(publishedAt).toISOString();

      const postUrl = currentPath
        ? `${data.siteUrl}/blog/${currentPath
            .split('/')
            .pop()!
            .replace(/^\d{4}-\d{2}-\d{2}-/, '')
            .replace(/\.md$/, '')}`
        : '';
      const properties = {
        ...(postType === 'article' || postType === 'bookmark'
          ? { name: title ? [title] : [] }
          : {}),
        content: content ? [content] : [],
        slug: slug ? [slug] : [],
        ...(postType === 'bookmark' ? { 'bookmark-of': [bookmark] } : {}),
        ...(postType === 'photo' ? { photo: $state.snapshot(photos) } : {}),
        description: description ? [description] : [],
        category: categories ? categories.split(',').map((c) => c.trim()) : [],
        published: [postDate],
        'post-status': [published ? 'published' : 'draft']
      };
      const response = await loggedFetch('/micropub', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          currentPath
            ? { action: 'update', url: postUrl, replace: properties }
            : {
                type: ['h-entry'],
                properties: Object.fromEntries(
                  Object.entries(properties).filter(([, values]) => values.length)
                )
              }
        )
      });

      if (response.ok) {
        const location = response.headers.get('Location') || postUrl;
        success = currentPath
          ? `Post updated successfully! View at: ${location}`
          : `Post created successfully! View at: ${location}`;
        // Update currentPath if this was a new post
        if (!currentPath) {
          // Extract path from location or construct it
          const datePrefix = postDate.slice(0, 10);
          const createdSlug = new URL(location).pathname.split('/').pop()!;
          if (slug === submittedPost.slug) slug = createdSlug;
          autoSlug = false;
          currentPath = `src/content/blog/${datePrefix}-${createdSlug}.md`;
          submittedPost.slug = createdSlug;
          submittedPost.currentPath = currentPath;
        }
        savedPost = JSON.stringify(submittedPost);
        if (hasUnsavedChanges()) {
          // Preserve edits made while the request was in flight.
          saveDraft();
        } else {
          clearDraft();
        }
      } else {
        const errorText = await response.text();
        error = `Failed to ${currentPath ? 'update' : 'create'} post: ${errorText}`;
      }
    } catch (err) {
      error = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
    } finally {
      submitting = false;
    }
  }

  async function handleImageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    uploadingImage = true;
    error = '';

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await loggedFetch('/micropub/media', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const imageUrl = response.headers.get('Location');
        if (imageUrl) {
          // Insert markdown image syntax at cursor or end
          if (postType === 'photo') {
            photos.push({ value: imageUrl, alt: '' });
          } else {
            const imageMd = `![${file.name}](${imageUrl})`;
            content = content ? `${content}\n\n${imageMd}` : imageMd;
          }
        }
      } else {
        const errorText = await response.text();
        error = `Failed to upload image: ${errorText}`;
      }
    } catch (err) {
      error = `Error uploading image: ${err instanceof Error ? err.message : 'Unknown error'}`;
    } finally {
      uploadingImage = false;
      // Reset input
      input.value = '';
    }
  }

  async function updatePreview() {
    if (!content) {
      previewHtml = '<p class="text-surface-600-400">Start writing to see preview...</p>';
      return;
    }

    previewLoading = true;

    try {
      // Render markdown directly in the browser
      const result = await unified().use(remarkParse).use(remarkHtml).process(content);
      previewHtml = String(result);
    } catch {
      previewHtml = '<p class="text-error-500">Error rendering preview</p>';
    } finally {
      previewLoading = false;
    }
  }

  // Update preview when switching to preview tab
  $effect(() => {
    if (activeTab === 'preview') {
      updatePreview();
    }
  });
</script>

{#snippet imageUpload()}
  <label
    class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1 text-sm text-surface-700-300 hover:bg-surface-100-900"
  >
    <Upload class="h-4 w-4" />
    {uploadingImage ? 'Uploading...' : 'Upload Image'}
    <input
      type="file"
      accept="image/*"
      onchange={handleImageUpload}
      disabled={uploadingImage}
      class="hidden"
    />
  </label>
{/snippet}

<svelte:head>
  <title>Publisher - Martin Emde</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6">
  <!-- Header -->
  <div class="mb-6 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <h1 class="text-surface-900-50 text-2xl font-bold">Publisher</h1>
      {#if saveStatus === 'saving'}
        <span class="flex items-center gap-1.5 text-sm text-surface-600-400">
          <Save class="h-3.5 w-3.5 animate-pulse" />
          Saving...
        </span>
      {:else if saveStatus === 'saved' && lastSaved}
        <span class="flex items-center gap-1.5 text-sm text-surface-600-400">
          <Save class="h-3.5 w-3.5" />
          Saved {formatRelativeTime(lastSaved)}
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-4">
      {#if data.isAuthenticated && data.user}
        <div class="hidden items-center gap-3 sm:flex">
          <img
            src={data.user.avatar_url}
            alt={data.user.name || data.user.login}
            class="size-8 rounded-full"
          />
          <span class="text-sm text-surface-700-300">
            {data.user.name || data.user.login}
          </span>
        </div>
        <a
          data-sveltekit-reload
          href={resolve('/auth/github/logout')}
          class="rounded-lg border border-surface-200-800 px-4 py-2 text-sm hover:bg-surface-100-900"
        >
          Logout
        </a>
      {:else}
        <a
          data-sveltekit-reload
          href={resolve('/auth/github/login')}
          class="rounded-lg border border-primary-300-700 bg-primary-500 px-4 py-2 text-sm text-white hover:bg-primary-600"
        >
          Login with GitHub
        </a>
      {/if}
    </div>
  </div>

  <!-- Mobile-first two-column layout -->
  <div class="grid gap-6 {data.isAuthenticated ? 'lg:grid-cols-[320px_1fr]' : ''}">
    <!-- Left sidebar: Post list (only when authenticated) -->
    {#if data.isAuthenticated}
      <aside
        class="h-[400px] overflow-hidden rounded-lg border border-surface-200-800 bg-surface-50-950 p-4 lg:h-[calc(100vh-12rem)]"
      >
        <BlogPostList
          onSelectPost={handleSelectPost}
          {currentPath}
          hasDraft={lastSaved !== null}
          request={loggedFetch}
        />
      </aside>
    {/if}

    <!-- Right main content: Editor form -->
    <main class="min-w-0">
      {#if error}
        <div class="text-error-900-50 mb-4 rounded-lg bg-error-50-950 p-4">
          {error}
        </div>
      {/if}

      {#if success}
        <div class="text-success-900-50 mb-4 rounded-lg bg-success-50-950 p-4">
          {success}
        </div>
      {/if}

      <nav aria-label="Post type" class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {#each postTypes as type (type.type)}
          <button
            type="button"
            aria-pressed={postType === type.type}
            disabled={!!currentPath || submitting || uploadingImage}
            onclick={() => switchType(type.type)}
            class="rounded-lg border p-3 text-left disabled:opacity-60 {postType === type.type
              ? 'border-primary-500 bg-primary-50-950'
              : 'border-surface-200-800'}"
          >
            <span class="font-semibold">{type.name}</span>
          </button>
        {/each}
      </nav>
      <div class="mb-6 flex items-center justify-between gap-4">
        <p class="text-sm text-surface-600-400">
          {postTypes.find((type) => type.type === postType)?.description}
        </p>
        <button
          type="button"
          onclick={newPost}
          disabled={submitting || uploadingImage}
          class="shrink-0 text-sm underline">New post</button
        >
      </div>
      <form onsubmit={handleSubmit} class="space-y-6">
        {#if postType === 'bookmark'}
          <div>
            <label for="bookmark" class="mb-2 block text-sm font-medium">Bookmark URL</label>
            <input
              id="bookmark"
              type="url"
              required
              pattern="https?://.*"
              bind:value={bookmark}
              placeholder="https://example.com/something-worth-keeping"
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 py-3"
            />
          </div>
        {/if}
        {#if postType === 'photo'}
          <section
            aria-label="Photos"
            class="space-y-4 rounded-lg border border-surface-200-800 p-4"
          >
            <div class="flex items-center justify-between gap-4">
              <h2 class="font-semibold">Photos</h2>
              {@render imageUpload()}
            </div>
            <p class="text-sm text-surface-600-400">
              Upload an image, or add an image URL. Alt text describes the image for people who
              cannot see it.
            </p>
            {#each photos as photo, i (photo)}
              <div class="space-y-2">
                <label for={`photo-${i}`} class="block text-sm">Image URL {i + 1}</label>
                <input
                  id={`photo-${i}`}
                  type="url"
                  required
                  pattern="https?://.*"
                  bind:value={photo.value}
                  class="w-full rounded border border-surface-200-800 bg-surface-50-950 p-2"
                />
                <label for={`alt-${i}`} class="block text-sm">Alt text {i + 1}</label>
                <input
                  id={`alt-${i}`}
                  bind:value={photo.alt}
                  class="w-full rounded border border-surface-200-800 bg-surface-50-950 p-2"
                />
                <button type="button" onclick={() => photos.splice(i, 1)} class="text-sm underline"
                  >Remove image {i + 1}</button
                >
              </div>
            {/each}
            <button
              type="button"
              onclick={() => photos.push({ value: '', alt: '' })}
              class="text-sm underline">Add image URL</button
            >
          </section>
        {/if}
        {#if postType === 'article' || postType === 'bookmark'}
          <div>
            <label for="title" class="mb-2 block text-sm font-medium text-surface-700-300">
              {postType === 'article' ? 'Title *' : 'Link title (optional)'}
            </label>
            <input
              type="text"
              id="title"
              bind:value={title}
              required={postType === 'article'}
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 py-2 text-surface-950-50 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
            />
          </div>
        {/if}

        <div>
          <div class="mb-2 flex items-center justify-between">
            <label for="content" class="text-sm font-medium text-surface-700-300">
              {postType === 'note'
                ? 'What’s on your mind? *'
                : postType === 'bookmark'
                  ? 'Why save this? (optional)'
                  : postType === 'photo'
                    ? 'Caption (optional)'
                    : 'Content (Markdown) *'}
            </label>
            {#if postType !== 'photo'}{@render imageUpload()}{/if}
          </div>

          <!-- Tabs -->
          <div class="mb-2 flex gap-2 border-b border-surface-200-800">
            <button
              type="button"
              onclick={() => (activeTab = 'edit')}
              class="px-4 py-2 text-sm {activeTab === 'edit'
                ? 'border-b-2 border-primary-500 text-primary-500'
                : 'text-surface-600-400 hover:text-surface-700-300'}"
            >
              Edit
            </button>
            <button
              type="button"
              onclick={() => (activeTab = 'preview')}
              class="px-4 py-2 text-sm {activeTab === 'preview'
                ? 'border-b-2 border-primary-500 text-primary-500'
                : 'text-surface-600-400 hover:text-surface-700-300'}"
            >
              Preview {previewLoading ? '(loading...)' : ''}
            </button>
          </div>

          <!-- Edit mode -->
          {#if activeTab === 'edit'}
            <textarea
              id="content"
              bind:value={content}
              required={postType === 'article' || postType === 'note'}
              rows={postType === 'article' ? 20 : 6}
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 py-2 font-mono text-sm text-surface-950-50 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
            ></textarea>
          {/if}

          <!-- Preview mode -->
          {#if activeTab === 'preview'}
            <div
              class="prose prose-sm min-h-125 w-full rounded-lg border border-surface-200-800 bg-surface-50-950 p-4 dark:prose-invert"
            >
              {#if title && (postType === 'article' || postType === 'bookmark')}
                <h2>{title}</h2>
              {/if}
              {#if postType === 'bookmark' && /^https?:\/\//.test(bookmark)}
                <!-- External bookmark URL, not a SvelteKit route. -->
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                <a href={bookmark} target="_blank" rel="noreferrer">{bookmark}</a>
              {/if}
              {#if postType === 'photo'}
                {#each photos as photo (photo)}
                  {#if /^https?:\/\//.test(photo.value)}
                    <img
                      src={photo.value}
                      alt={photo.alt}
                      class="max-h-96 rounded object-contain"
                    />
                  {/if}
                {/each}
              {/if}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html previewHtml}
            </div>
          {/if}
        </div>

        <details open={postType === 'article'} class="space-y-4">
          <summary class="cursor-pointer text-sm font-medium">Post details</summary>
          <div>
            <label for="slug" class="mb-2 block text-sm font-medium text-surface-700-300">
              Slug (optional)
            </label>
            <div class="flex items-center gap-2">
              <input
                type="text"
                id="slug"
                bind:value={slug}
                disabled={autoSlug}
                class="flex-1 rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 py-2 text-surface-950-50 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none disabled:opacity-50"
              />
              <label class="flex items-center gap-2 text-sm text-surface-700-300">
                <input type="checkbox" bind:checked={autoSlug} class="rounded" />
                Auto-generate
              </label>
            </div>
          </div>

          <div>
            <label for="description" class="mb-2 block text-sm font-medium text-surface-700-300">
              Description
            </label>
            <input
              type="text"
              id="description"
              bind:value={description}
              placeholder="Short preview description"
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 py-2 text-surface-950-50 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
            />
          </div>

          <div>
            <label for="categories" class="mb-2 block text-sm font-medium text-surface-700-300">
              Categories
            </label>
            <input
              type="text"
              id="categories"
              bind:value={categories}
              placeholder="Comma-separated (e.g., ruby, rails, web)"
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 py-2 text-surface-950-50 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
            />
          </div>

          <div>
            <label for="published-at" class="mb-2 block text-sm font-medium text-surface-700-300">
              Publication date and time (local time)
            </label>
            <div class="flex items-center gap-2">
              <input
                type="datetime-local"
                id="published-at"
                bind:value={publishedAt}
                required
                step="any"
                class="min-w-0 flex-1 rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 py-2 text-surface-950-50 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
              />
              <button
                type="button"
                onclick={() => (publishedAt = localDateTime(new Date()))}
                class="rounded-lg border border-surface-200-800 px-4 py-2 text-sm text-surface-700-300 hover:bg-surface-100-900"
              >
                Now
              </button>
            </div>
          </div>
        </details>

        <div>
          <label class="flex items-center gap-2 text-sm font-medium text-surface-700-300">
            <input
              type="checkbox"
              bind:checked={published}
              class="rounded border-surface-200-800 text-primary-500 focus:ring-2 focus:ring-primary-500"
            />
            Published (uncheck to save as draft)
          </label>
        </div>

        <div class="flex justify-end gap-4">
          <a
            href={resolve('/')}
            class="rounded-lg border border-surface-200-800 px-6 py-2 text-surface-700-300 hover:bg-surface-100-900"
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={submitting || uploadingImage || (postType === 'photo' && !photos.length)}
            class="rounded-lg bg-primary-500 px-6 py-2 text-white hover:bg-primary-600 disabled:opacity-50"
          >
            {#if submitting}
              {currentPath ? 'Updating...' : 'Creating...'}
            {:else}
              {currentPath ? 'Update Post' : 'Create Post'}
            {/if}
          </button>
        </div>
      </form>
      <ActionLog {actions} onClear={() => (actions = [])} />
    </main>
  </div>
</div>
