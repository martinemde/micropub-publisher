import { defineEnvVars } from '@sveltejs/kit/env';

/** Variables a route reads only when it needs them, so local tools can omit them. */
const optional = (description: string) => ({
  description,
  schema: (value: string | undefined) => value || undefined
});

export const variables = defineEnvVars({
  PUBLIC_APP_URL: { public: true, ...optional('Origin where this publisher is deployed.') },
  PUBLIC_SITE_URL: {
    public: true,
    ...optional('Origin of the published blog: the IndieAuth identity and post/media origin.')
  },
  GITHUB_CLIENT_ID: optional('GitHub App client ID for user authorization.'),
  GITHUB_CLIENT_SECRET: optional('GitHub App client secret for user authorization.'),
  GITHUB_OWNER: optional('Owner of the repository posts are committed to.'),
  GITHUB_REPO: optional('Repository posts are committed to.'),
  SESSION_SECRET: optional('Session cookie encryption secret, at least 32 characters.'),
  MICROPUB_BACKEND: {
    description: 'Storage backend; unset selects file in development and github otherwise.',
    schema: (value) => {
      if (!value) return undefined;
      if (value === 'github' || value === 'file' || value === 'test') return value;
      throw new Error('MICROPUB_BACKEND must be github, file, or test');
    }
  },
  PUBLISHER_RUNTIME: optional('Set to cloudflare where a Durable Object must own state.')
});
