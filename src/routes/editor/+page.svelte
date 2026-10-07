<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import remarkHtml from 'remark-html';
  import remarkParse from 'remark-parse';
  import type { PageData } from './$types';
  import { ImagePlus, Menu, X, Plus, Eye, PenLine, ChevronDown, LogOut } from 'lucide-svelte';
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
    summary?: string;
    description?: string; // Older local drafts
    featured?: string;
    updatedAt?: string;
    visibility?: string;
    categories: string;
    published: boolean;
    publishedAt?: string;
    savedPublishedAt?: string;
    autoSlug: boolean;
    savedAt: string;
    currentPath: string;
  }

  // Form state
  function localDateTime(date: Date): string {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1);
  }

  function normalizedDateTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : localDateTime(date);
  }

  function sameLocalDateTime(first: string, second: string): boolean {
    // datetime-local inputs may remove zero seconds or fractional trailing zeros.
    return new Date(first).getTime() === new Date(second).getTime();
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
  let summary = $state('');
  let featured = $state('');
  let updatedAt = $state('');
  let visibility = $state('');
  let categories = $state('');
  let published = $state(false);
  let publishedAt = $state(localDateTime(new Date()));
  let savedPublishedAt = $state('');
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
      summary,
      featured,
      // datetime-local inputs normalize zero seconds and trailing fractional zeros.
      // Compare equivalent timestamps rather than their displayed strings.
      updatedAt: normalizedDateTime(updatedAt),
      visibility,
      categories,
      published,
      publishedAt: normalizedDateTime(publishedAt),
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
  let contentField: HTMLTextAreaElement | undefined = $state();
  let localImages = $state<Record<string, string>>({});
  const markdown = unified().use(remarkParse).use(remarkHtml);
  type MarkdownNode = ReturnType<typeof markdown.parse>;
  function contentImages(text: string): Photo[] {
    const tree = markdown.parse(text);
    const images: Photo[] = [];
    function visit(node: MarkdownNode | (typeof tree.children)[number]) {
      if (node.type === 'image' && /^https?:\/\//.test(node.url))
        images.push({ value: node.url, alt: node.alt ?? '' });
      if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
    return images;
  }
  const inlineImages = $derived(contentImages(content));
  function imageSource(url: string) {
    return localImages[url] ?? url;
  }
  onDestroy(() => {
    Object.values(localImages).forEach((url) => URL.revokeObjectURL(url));
  });

  // Auto-save state
  let saveStatus: 'idle' | 'saving' | 'saved' = $state('idle');
  let lastSaved = $state<Date | null>(null);

  // Layout state
  let drawerOpen = $state(false);
  let detailsOpen = $state(false);
  let detailsSection: HTMLDivElement | undefined = $state();
  let menuButton: HTMLButtonElement | undefined = $state();
  let titleField: HTMLTextAreaElement | undefined = $state();
  let drawerStart: HTMLButtonElement | undefined = $state();
  let opening = $state(false);
  let listLoaded = false;
  let viewportWidth = $state(0);

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
        summary = draft.summary ?? draft.description ?? '';
        featured = draft.featured ?? '';
        updatedAt = draft.updatedAt ?? '';
        visibility = draft.visibility ?? '';
        categories = draft.categories;
        published = draft.published ?? false;
        publishedAt = draft.publishedAt ?? localDateTime(new Date());
        savedPublishedAt = draft.savedPublishedAt ?? '';
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
        summary,
        featured,
        updatedAt,
        visibility,
        categories,
        published,
        publishedAt,
        savedPublishedAt,
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
    summary = draft?.summary ?? draft?.description ?? '';
    featured = draft?.featured ?? '';
    updatedAt = draft?.updatedAt ?? '';
    visibility = draft?.visibility ?? '';
    categories = draft?.categories ?? '';
    published = draft?.published ?? false;
    publishedAt = draft?.publishedAt ?? localDateTime(new Date());
    savedPublishedAt = draft?.savedPublishedAt ?? '';
    autoSlug = draft?.autoSlug ?? true;
    currentPath = '';
    error = '';
    success = '';
    activeTab = 'edit';
  }

  function newPost() {
    if (submitting || uploadingImage) return;
    if (hasUnsavedChanges() && !confirm('Discard unsubmitted changes and start a new post?'))
      return;
    delete drafts[postType];
    restoreComposer(postType);
    savedPost = JSON.stringify(postState());
    clearDraft();
    closeDrawer();
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

  // Load a blog post from the API. The automatic open of the latest post
  // yields to anything the writer started while the list was loading.
  async function loadPost(path: string, onlyIfPristine = false) {
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
      if (onlyIfPristine && (currentPath || hasUnsavedChanges())) return;

      // Populate form
      const source = frontmatter.micropub?.properties;
      postType = inferPostType(
        source ?? { ...frontmatter, name: frontmatter.name ?? frontmatter.title },
        postContent
      );
      bookmark = source?.['bookmark-of']?.[0] ?? '';
      photos = (source?.photo ?? []).map((photo: string | Photo) =>
        typeof photo === 'string' ? { value: photo, alt: '' } : { ...photo }
      );
      title = source ? (source.name?.[0] ?? '') : frontmatter.title || '';
      slug = frontmatter.slug || '';
      summary = source?.summary?.[0] ?? frontmatter.description ?? '';
      featured = source?.featured?.[0] ?? frontmatter.image ?? '';
      const originalUpdated = source?.updated?.[0] ?? frontmatter.updated;
      updatedAt = originalUpdated ? localDateTime(new Date(originalUpdated)) : '';
      visibility = source?.visibility?.[0] ?? frontmatter.visibility ?? '';
      published = frontmatter.published ?? false;
      const filenameDate = path
        .split('/')
        .pop()
        ?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      publishedAt = localDateTime(new Date(frontmatter.date || filenameDate || Date.now()));
      savedPublishedAt = publishedAt;
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
    // The draft and an unchanged open post are already in the editor.
    if (isDraft || (path === currentPath && !hasUnsavedChanges())) {
      closeDrawer();
      return;
    }

    // Check if there are unsaved changes
    if (hasUnsavedChanges()) {
      const confirmed = confirm(
        'You have unsaved changes. Loading a different post will discard these changes. Continue?'
      );
      if (!confirmed) {
        return;
      }
    }

    closeDrawer();
    await loadPost(path);
  }

  // Most sessions continue the latest post, so open it unless a local draft exists.
  function handlePostsLoaded(posts: { path: string }[]) {
    if (listLoaded) return;
    listLoaded = true;
    const latest = posts[0];
    if (!latest || currentPath || lastSaved || hasUnsavedChanges()) return;
    opening = true;
    loadPost(latest.path, true).finally(() => (opening = false));
  }

  function openDrawer() {
    drawerOpen = true;
    tick().then(() => drawerStart?.focus());
  }

  function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    menuButton?.focus();
  }

  async function togglePreview() {
    activeTab = activeTab === 'edit' ? 'preview' : 'edit';
    if (activeTab === 'edit') {
      await tick();
      contentField?.focus();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && drawerOpen) {
      e.preventDefault();
      closeDrawer();
    } else if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === 'e'
    ) {
      e.preventDefault();
      togglePreview();
    }
  }

  // Reveal collapsed metadata fields when the browser rejects one of them.
  function handleInvalid(e: Event) {
    if (detailsSection?.contains(e.target as Node)) detailsOpen = true;
  }

  // Grow the title and editor with their text so the page, not a field, scrolls.
  function fitHeight(field: HTMLTextAreaElement | undefined) {
    if (!field) return;
    const scroll = window.scrollY;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
    if (window.scrollY !== scroll) window.scrollTo(0, scroll);
  }
  $effect(() => {
    void [content, activeTab, postType, viewportWidth];
    fitHeight(contentField);
  });
  $effect(() => {
    void [title, postType, viewportWidth];
    fitHeight(titleField);
  });

  function formatPublishedAt(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'No date'
      : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  const detailsSummary = $derived(
    [
      formatPublishedAt(publishedAt),
      slug ? `/${slug}` : 'slug from title',
      categories.trim() || null,
      visibility && visibility !== 'public' ? visibility : null,
      summary ? 'summary' : null
    ]
      .filter(Boolean)
      .join(' · ')
  );

  function editorStatus(): string {
    if (opening) return 'Opening latest post…';
    if (submitting) return currentPath ? 'Updating on the blog…' : 'Creating on the blog…';
    if (uploadingImage) return 'Uploading image…';
    if (hasUnsavedChanges()) {
      if (saveStatus === 'saving') return 'Backing up…';
      return lastSaved ? `Unsaved · backed up ${formatRelativeTime(lastSaved)}` : 'Unsaved changes';
    }
    return currentPath ? 'Saved to the blog' : 'New post';
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
      summary,
      featured,
      updatedAt,
      visibility,
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

      // src/content/blog/2026-07-21-slug.md is published at /2026/07/21/slug
      const postUrl = currentPath
        ? `${data.siteUrl}/${currentPath
            .split('/')
            .pop()!
            .replace(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/, '$1/$2/$3/$4')}`
        : '';
      const properties = {
        ...(postType === 'article' || postType === 'bookmark'
          ? { name: title ? [title] : [] }
          : {}),
        content: content ? [content] : [],
        slug: slug ? [slug] : [],
        ...(postType === 'bookmark' ? { 'bookmark-of': [bookmark] } : {}),
        ...(postType === 'photo' ? { photo: $state.snapshot(photos) } : {}),
        summary: summary ? [summary] : [],
        featured: featured ? [featured] : [],
        updated: updatedAt ? [new Date(updatedAt).toISOString()] : [],
        visibility: visibility ? [visibility] : [],
        // Remove the old property when migrating an existing post to summary.
        ...(currentPath ? { description: [] } : {}),
        category: categories ? categories.split(',').map((c) => c.trim()) : [],
        // The read API serializes legacy YAML dates as UTC timestamps. Leaving
        // an unchanged date out preserves its stored date-only meaning (and
        // avoids reinterpreting an unchanged local time across a DST overlap).
        ...(!currentPath || !sameLocalDateTime(publishedAt, savedPublishedAt)
          ? { published: [postDate] }
          : {}),
        'post-status': [published ? 'published' : 'draft']
      };
      if (currentPath && !savedPublishedAt) {
        // Backups from before date baselines were saved need a fresh comparison.
        // Build the payload first so edits made during this read stay unsaved.
        const original = await loggedFetch(
          `/api/posts/read?path=${encodeURIComponent(currentPath)}`
        );
        if (!original.ok) throw new Error('Failed to read the original publication date');
        const { frontmatter } = await original.json();
        const filenameDate = currentPath
          .split('/')
          .pop()
          ?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        const baseline = frontmatter.date || filenameDate;
        if (!baseline) throw new Error('Original publication date is missing');
        savedPublishedAt = localDateTime(new Date(baseline));
        if (sameLocalDateTime(submittedPost.publishedAt, savedPublishedAt))
          delete properties.published;
      }
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
        // A create, or an update that moved the permalink, answers 201 with the new URL.
        if (response.status === 201) {
          // The Location permalink /2026/07/21/slug names the stored file.
          const [year, month, day, createdSlug] = new URL(location).pathname.split('/').slice(-4);
          if (slug === submittedPost.slug) slug = createdSlug;
          autoSlug = false;
          currentPath = `src/content/blog/${year}-${month}-${day}-${createdSlug}.md`;
          submittedPost.slug = createdSlug;
          submittedPost.currentPath = currentPath;
        }
        savedPost = JSON.stringify(submittedPost);
        savedPublishedAt = submittedPost.publishedAt;
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
    await uploadImages(Array.from(input.files ?? []), postType === 'photo');
    input.value = '';
  }

  function handleImageDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = uploadingImage || submitting ? 'none' : 'copy';
    }
  }

  async function handleImageDrop(e: DragEvent) {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    await uploadImages(Array.from(e.dataTransfer.files), false);
  }

  async function uploadImages(files: File[], asPhotos: boolean) {
    if (!files.length || uploadingImage || submitting) return;
    if (files.some((file) => !/^image\/(jpeg|png|gif|webp|avif)$/.test(file.type))) {
      error = 'Choose a PNG, JPEG, GIF, WebP, or AVIF image.';
      return;
    }
    uploadingImage = true;
    error = '';
    let start = contentField?.selectionStart ?? content.length;
    let end = contentField?.selectionEnd ?? start;
    try {
      for (const [index, file] of files.entries()) {
        const beforeUpload = content;
        const formData = new FormData();
        formData.append('file', file);
        const response = await loggedFetch('/micropub/media', { method: 'POST', body: formData });
        if (!response.ok) throw new Error(await response.text());
        const imageUrl = response.headers.get('Location');
        if (!imageUrl || !/^https?:\/\//.test(imageUrl))
          throw new Error('The media endpoint did not return an image URL.');
        if (typeof URL.createObjectURL === 'function') {
          if (localImages[imageUrl]) URL.revokeObjectURL(localImages[imageUrl]);
          localImages[imageUrl] = URL.createObjectURL(file);
        }
        if (asPhotos) {
          photos.push({ value: imageUrl, alt: '' });
        } else {
          // If the draft changed during upload, use its current caret and keep the edits.
          if (content !== beforeUpload) {
            start = contentField?.selectionStart ?? content.length;
            end = contentField?.selectionEnd ?? start;
          }
          const alt = file.name.replace(/[\\[\]]/g, '\\$&');
          const imageMd = `${index ? '\n\n' : ''}![${alt}](${imageUrl})`;
          content = content.slice(0, start) + imageMd + content.slice(end);
          start += imageMd.length;
          end = start;
          await tick();
          contentField?.focus();
          contentField?.setSelectionRange(start, end);
        }
      }
    } catch (err) {
      error = `Failed to upload image: ${err instanceof Error ? err.message : 'Unknown error'}`;
    } finally {
      uploadingImage = false;
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
      const result = await markdown.process(content);
      // Use the uploaded bytes until the blog deploy makes the public URL available.
      const template = document.createElement('template');
      template.innerHTML = String(result);
      template.content.querySelectorAll('img').forEach((image) => {
        image.src = imageSource(image.getAttribute('src') ?? '');
      });
      previewHtml = template.innerHTML;
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

{#snippet imageUpload(label: string)}
  <label
    class="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-surface-700-300 hover:bg-surface-100-900 has-disabled:cursor-not-allowed has-disabled:opacity-50"
    title="Upload images (or drop them into the editor)"
  >
    <ImagePlus class="size-4" aria-hidden="true" />
    <span class={label === 'icon' ? 'sr-only' : ''}
      >{uploadingImage ? 'Uploading...' : 'Upload Image'}</span
    >
    <input
      type="file"
      accept="image/*"
      multiple
      onchange={handleImageUpload}
      disabled={uploadingImage || submitting}
      class="hidden"
    />
  </label>
{/snippet}

<svelte:head>
  <title>Publisher - Martin Emde</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} bind:innerWidth={viewportWidth} />

{#if data.isAuthenticated}
  <!-- Pointer convenience; Escape and the close button handle keyboard users. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-30 bg-surface-950/40 transition-opacity {drawerOpen
      ? 'opacity-100'
      : 'pointer-events-none opacity-0'}"
    onclick={closeDrawer}
  ></div>
  <aside
    id="post-drawer"
    aria-label="Posts"
    inert={!drawerOpen}
    class="fixed inset-y-0 left-0 z-40 flex w-80 max-w-[85vw] flex-col border-r border-surface-200-800 bg-surface-50-950 shadow-xl transition-transform duration-200 {drawerOpen
      ? 'translate-x-0'
      : '-translate-x-full'}"
  >
    <div class="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
      <span class="font-semibold">Publisher</span>
      <button
        type="button"
        onclick={closeDrawer}
        aria-label="Close posts"
        class="rounded-lg p-2 hover:bg-surface-100-900"
      >
        <X class="size-5" aria-hidden="true" />
      </button>
    </div>
    <div class="px-3 pb-3">
      <button
        type="button"
        bind:this={drawerStart}
        onclick={newPost}
        disabled={submitting || uploadingImage}
        class="flex w-full items-center gap-2 rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
      >
        <Plus class="size-4" aria-hidden="true" />
        New post
      </button>
    </div>
    <div class="min-h-0 flex-1 border-t border-surface-200-800 px-3 pt-3">
      <BlogPostList
        onSelectPost={handleSelectPost}
        onLoad={handlePostsLoaded}
        {currentPath}
        hasDraft={!currentPath && hasUnsavedChanges()}
        hasUnsavedChanges={hasUnsavedChanges()}
        request={loggedFetch}
      />
    </div>
    {#if data.user}
      <div class="flex items-center gap-3 border-t border-surface-200-800 px-4 py-3">
        {#if data.user.avatar_url}
          <img src={data.user.avatar_url} alt="" class="size-7 rounded-full" />
        {/if}
        <span class="min-w-0 flex-1 truncate text-sm text-surface-700-300">
          {data.user.name || data.user.login}
        </span>
        <a
          data-sveltekit-reload
          href={resolve('/auth/github/logout')}
          class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-surface-600-400 hover:bg-surface-100-900"
        >
          <LogOut class="size-4" aria-hidden="true" />
          Logout
        </a>
      </div>
    {/if}
  </aside>
{/if}

<header
  class="sticky top-0 z-20 flex h-14 items-center gap-1 border-b border-surface-200-800 bg-surface-50-950/90 px-2 backdrop-blur sm:gap-2 sm:px-3"
>
  {#if data.isAuthenticated}
    <button
      type="button"
      bind:this={menuButton}
      onclick={openDrawer}
      aria-label="Posts"
      aria-expanded={drawerOpen}
      aria-controls="post-drawer"
      class="rounded-lg p-2 hover:bg-surface-100-900"
    >
      <Menu class="size-5" aria-hidden="true" />
    </button>
  {/if}
  <p class="min-w-0 flex-1 truncate px-1 text-sm text-surface-600-400" aria-live="polite">
    {editorStatus()}
  </p>
  {#if postType !== 'photo' && activeTab === 'edit'}{@render imageUpload('icon')}{/if}
  <div
    class="flex rounded-lg border border-surface-200-800 p-0.5 text-sm"
    role="group"
    aria-label="View"
  >
    <button
      type="button"
      onclick={() => activeTab === 'preview' && togglePreview()}
      aria-pressed={activeTab === 'edit'}
      title="Edit (Ctrl/⌘ E)"
      class="flex items-center gap-1.5 rounded-md px-2 py-1 {activeTab === 'edit'
        ? 'bg-surface-200-800 text-surface-950-50'
        : 'text-surface-600-400 hover:text-surface-950-50'}"
    >
      <PenLine class="size-4" aria-hidden="true" />
      <span class="sr-only sm:not-sr-only">Edit</span>
    </button>
    <button
      type="button"
      onclick={() => activeTab === 'edit' && togglePreview()}
      aria-pressed={activeTab === 'preview'}
      title="Preview (Ctrl/⌘ E)"
      class="flex items-center gap-1.5 rounded-md px-2 py-1 {activeTab === 'preview'
        ? 'bg-surface-200-800 text-surface-950-50'
        : 'text-surface-600-400 hover:text-surface-950-50'}"
    >
      <Eye class="size-4" aria-hidden="true" />
      <span class="sr-only sm:not-sr-only">Preview</span>
    </button>
  </div>
  {#if data.isAuthenticated}
    <button
      type="submit"
      form="post-form"
      disabled={submitting || uploadingImage || opening || (postType === 'photo' && !photos.length)}
      class="rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-primary-600 disabled:opacity-50 sm:px-4"
    >
      {#if submitting}
        {currentPath ? 'Updating...' : 'Creating...'}
      {:else}
        {currentPath ? 'Update Post' : 'Create Post'}
      {/if}
    </button>
  {:else}
    <a
      data-sveltekit-reload
      href={resolve('/auth/github/login')}
      class="rounded-lg bg-primary-500 px-3 py-1.5 text-sm whitespace-nowrap text-white hover:bg-primary-600"
    >
      Login with GitHub
    </a>
  {/if}
</header>

<main class="mx-auto w-full max-w-3xl px-5 pt-6 pb-24 sm:px-8 sm:pt-10">
  {#if error}
    <div role="alert" class="text-error-900-50 mb-6 rounded-lg bg-error-50-950 px-4 py-3 text-sm">
      {error}
    </div>
  {/if}

  {#if success}
    <div
      role="status"
      class="text-success-900-50 mb-6 flex items-start justify-between gap-3 rounded-lg bg-success-50-950 px-4 py-3 text-sm"
    >
      <span class="min-w-0 break-words">{success}</span>
      <button type="button" onclick={() => (success = '')} aria-label="Dismiss">
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>
  {/if}

  <form id="post-form" onsubmit={handleSubmit} oninvalidcapture={handleInvalid}>
    <nav aria-label="Post type" class="mb-4 flex flex-wrap gap-1 text-sm">
      {#each postTypes as type (type.type)}
        <button
          type="button"
          aria-pressed={postType === type.type}
          disabled={!!currentPath || submitting || uploadingImage}
          onclick={() => switchType(type.type)}
          title={type.description}
          class="rounded-full px-3 py-1 disabled:cursor-default disabled:opacity-100 {postType ===
          type.type
            ? 'bg-primary-500 text-white'
            : currentPath
              ? 'hidden'
              : 'text-surface-600-400 hover:bg-surface-100-900'}"
        >
          {type.name}
        </button>
      {/each}
    </nav>

    {#if postType === 'bookmark'}
      <label for="bookmark" class="sr-only">Bookmark URL</label>
      <input
        id="bookmark"
        type="url"
        required
        pattern="https?://.*"
        bind:value={bookmark}
        placeholder="https://example.com/something-worth-keeping"
        class="mb-3 w-full rounded-lg border border-surface-200-800 bg-surface-100-900 px-3 py-2 font-mono text-sm"
      />
    {/if}

    {#if postType === 'article' || postType === 'bookmark'}
      <label for="title" class="sr-only">
        {postType === 'article' ? 'Title *' : 'Link title (optional)'}
      </label>
      <!-- A wrapping single-line title: Enter moves on to the body. -->
      <textarea
        id="title"
        bind:this={titleField}
        bind:value={title}
        rows="1"
        required={postType === 'article'}
        placeholder={postType === 'article' ? 'Title' : 'Link title (optional)'}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            contentField?.focus();
          }
        }}
        class:hidden={activeTab === 'preview'}
        class="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-3xl leading-tight font-bold text-surface-950-50 placeholder:text-surface-400-600 focus:ring-0 sm:text-4xl"
      ></textarea>
    {/if}

    <div
      class="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-surface-200-800 pb-3"
    >
      <label class="flex items-center gap-2 py-1 text-sm text-surface-700-300">
        <input
          type="checkbox"
          bind:checked={published}
          class="rounded border-surface-300-700 text-primary-500 focus:ring-2 focus:ring-primary-500"
        />
        Published
      </label>
      <button
        type="button"
        onclick={() => (detailsOpen = !detailsOpen)}
        aria-expanded={detailsOpen}
        aria-controls="post-details"
        title="Post details"
        class="flex min-w-0 flex-1 basis-60 items-center gap-1.5 rounded py-1 text-left text-sm text-surface-600-400 hover:text-surface-950-50"
      >
        <ChevronDown
          class="size-4 shrink-0 transition-transform {detailsOpen ? 'rotate-180' : ''}"
          aria-hidden="true"
        />
        <span class="sr-only">Post details:</span>
        <span class="truncate">{detailsSummary}</span>
      </button>
      <div
        id="post-details"
        bind:this={detailsSection}
        hidden={!detailsOpen}
        role="group"
        aria-label="Post details"
        class="w-full"
      >
        <div class="mt-1 mb-2 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 [&>*]:min-w-0">
          <div>
            <label for="slug" class="mb-1 block font-medium text-surface-700-300">Slug</label>
            <div class="flex items-center gap-3">
              <input
                type="text"
                id="slug"
                bind:value={slug}
                disabled={autoSlug}
                class="min-w-0 flex-1 rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1.5 disabled:opacity-50"
              />
              <label class="flex items-center gap-1.5 text-surface-700-300">
                <input type="checkbox" bind:checked={autoSlug} class="rounded" />
                Auto
              </label>
            </div>
          </div>
          <div>
            <label for="categories" class="mb-1 block font-medium text-surface-700-300"
              >Categories</label
            >
            <input
              type="text"
              id="categories"
              bind:value={categories}
              placeholder="ruby, rails, web"
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1.5"
            />
          </div>
          <div>
            <label for="published-at" class="mb-1 block font-medium text-surface-700-300">
              Publication date (local time)
            </label>
            <div class="flex items-center gap-2">
              <input
                type="datetime-local"
                id="published-at"
                bind:value={publishedAt}
                required
                step="any"
                class="min-w-0 flex-1 rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1.5"
              />
              <button
                type="button"
                onclick={() => (publishedAt = localDateTime(new Date()))}
                class="rounded-lg border border-surface-200-800 px-3 py-1.5 hover:bg-surface-100-900"
              >
                Now
              </button>
            </div>
          </div>
          <div>
            <label for="updated-at" class="mb-1 block font-medium text-surface-700-300"
              >Updated (optional, local time)</label
            >
            <input
              id="updated-at"
              type="datetime-local"
              step="any"
              bind:value={updatedAt}
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1.5"
            />
            <div class="mt-1 flex gap-3 text-xs">
              <button
                type="button"
                onclick={() => (updatedAt = localDateTime(new Date()))}
                class="underline">Set updated to now</button
              >
              <button type="button" onclick={() => (updatedAt = '')} class="underline"
                >Clear updated time</button
              >
            </div>
          </div>
          <div class="sm:col-span-2">
            <label for="summary" class="mb-1 block font-medium text-surface-700-300">Summary</label>
            <input
              type="text"
              id="summary"
              bind:value={summary}
              placeholder="Short summary for previews"
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1.5"
            />
          </div>
          <div>
            <label for="featured" class="mb-1 block font-medium text-surface-700-300"
              >Featured image URL</label
            >
            <input
              id="featured"
              type="url"
              pattern="https?://.*"
              bind:value={featured}
              placeholder="https://example.com/cover.jpg"
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1.5"
            />
            <p class="mt-1 text-xs text-surface-600-400">
              A cover image, separate from photos in the content.
            </p>
          </div>
          <div>
            <label for="visibility" class="mb-1 block font-medium text-surface-700-300"
              >Visibility</label
            >
            <select
              id="visibility"
              bind:value={visibility}
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1.5"
            >
              <option value="">Default (public)</option>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
              {#if visibility && !['public', 'unlisted', 'private'].includes(visibility)}
                <option value={visibility}>{visibility} (existing value)</option>
              {/if}
            </select>
            <p class="mt-1 text-xs text-surface-600-400">
              The blog leaves unlisted and private posts unpublished. This does not protect files in
              the repository.
            </p>
          </div>
        </div>
      </div>
    </div>

    {#if postType === 'photo'}
      <section aria-label="Photos" class="mt-6 space-y-4">
        <div class="flex items-center justify-between gap-4">
          <h2 class="font-semibold">Photos</h2>
          {@render imageUpload('text')}
        </div>
        <p class="text-sm text-surface-600-400">
          Upload an image, or add an image URL. Alt text describes the image for people who cannot
          see it.
        </p>
        {#each photos as photo, i (photo)}
          <div class="grid gap-2 rounded-lg border border-surface-200-800 p-3 text-sm">
            {#if /^https?:\/\//.test(photo.value)}
              <img
                src={imageSource(photo.value)}
                alt={photo.alt}
                class="max-h-48 rounded object-contain"
              />
            {/if}
            <label for={`photo-${i}`}>Image URL {i + 1}</label>
            <input
              id={`photo-${i}`}
              type="url"
              required
              pattern="https?://.*"
              bind:value={photo.value}
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1.5"
            />
            <label for={`alt-${i}`}>Alt text {i + 1}</label>
            <input
              id={`alt-${i}`}
              bind:value={photo.alt}
              class="w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-1.5"
            />
            <button
              type="button"
              onclick={() => photos.splice(i, 1)}
              class="justify-self-start underline">Remove image {i + 1}</button
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

    {#if activeTab === 'edit'}
      <label for="content" class="sr-only">
        {postType === 'note'
          ? 'What’s on your mind? *'
          : postType === 'bookmark'
            ? 'Why save this? (optional)'
            : postType === 'photo'
              ? 'Caption (optional)'
              : 'Content (Markdown) *'}
      </label>
      <textarea
        id="content"
        bind:this={contentField}
        bind:value={content}
        ondragover={handleImageDragOver}
        ondrop={handleImageDrop}
        required={postType === 'article' || postType === 'note'}
        rows={postType === 'article' ? 20 : 6}
        placeholder={postType === 'note'
          ? 'What’s on your mind?'
          : postType === 'bookmark'
            ? 'Why save this?'
            : postType === 'photo'
              ? 'Caption'
              : 'Write in Markdown. Drop images anywhere.'}
        class="mt-6 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 font-mono text-sm leading-7 text-surface-950-50 placeholder:text-surface-400-600 focus:ring-0 sm:text-[15px] {postType ===
        'article'
          ? 'min-h-[60vh]'
          : 'min-h-40'}"></textarea>
      {#if uploadingImage}
        <p class="mt-2 text-sm text-surface-600-400">Uploading images…</p>
      {/if}
      {#if inlineImages.length}
        <section
          aria-label="Content images"
          class="mt-6 flex flex-wrap gap-3 border-t border-surface-200-800 pt-4"
        >
          {#each inlineImages as image, i (i)}
            <figure class="max-w-40">
              <img
                src={imageSource(image.value)}
                alt={image.alt}
                class="h-24 w-40 rounded object-contain"
              />
              <figcaption class="mt-1 truncate text-xs text-surface-600-400">
                {image.alt || 'Image'}
              </figcaption>
            </figure>
          {/each}
        </section>
      {/if}
    {:else}
      <article
        aria-label="Post preview"
        class="prose mt-6 max-w-none sm:prose-lg dark:prose-invert"
      >
        {#if title && (postType === 'article' || postType === 'bookmark')}
          <h1>{title}</h1>
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
                src={imageSource(photo.value)}
                alt={photo.alt}
                class="max-h-96 rounded object-contain"
              />
            {/if}
          {/each}
        {/if}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html previewHtml}
        {#if previewLoading}<p class="text-surface-600-400">Rendering…</p>{/if}
      </article>
    {/if}
  </form>

  <ActionLog {actions} onClear={() => (actions = [])} />
</main>
