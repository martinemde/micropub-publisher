<script lang="ts">
  import '../app.css';
  import { PUBLIC_APP_URL } from '$app/env/public';

  let { children } = $props();
</script>

<svelte:head>
  <title>Micropub Publisher</title>
  <meta name="description" content="A standalone Micropub and media publisher backed by GitHub." />
  <link rel="authorization_endpoint" href={`${PUBLIC_APP_URL}/auth/indieauth/authorize`} />
  <link rel="token_endpoint" href={`${PUBLIC_APP_URL}/auth/indieauth/token`} />
  <link rel="micropub" href={`${PUBLIC_APP_URL}/micropub`} />
</svelte:head>

{@render children()}
