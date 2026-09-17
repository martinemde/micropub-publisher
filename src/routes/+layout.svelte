<script lang="ts">
  import '../app.css';
  import { env } from '$env/dynamic/public';

  let { children } = $props();
</script>

<svelte:head>
  <title>Micropub Publisher</title>
  <meta name="description" content="A standalone Micropub and media publisher backed by GitHub." />
  <link rel="authorization_endpoint" href={`${env.PUBLIC_APP_URL}/auth/indieauth/authorize`} />
  <link rel="token_endpoint" href={`${env.PUBLIC_APP_URL}/auth/indieauth/token`} />
  <link rel="micropub" href={`${env.PUBLIC_APP_URL}/micropub`} />
</svelte:head>

{@render children()}
