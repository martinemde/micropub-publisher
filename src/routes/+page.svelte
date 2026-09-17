<script lang="ts">
  import { resolve } from '$app/paths';
</script>

<main class="mx-auto max-w-2xl px-6 py-16">
  <h1 class="text-3xl font-semibold">Micropub Publisher</h1>
  <p class="mt-4 text-surface-600-400">
    This service publishes Markdown and media to GitHub through Micropub.
  </p>
  <a class="mt-8 inline-block underline" href={resolve('/editor')}>Open the editor</a>
</main>
