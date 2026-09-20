// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    interface Platform {
      env: {
        PUBLISHER_STATE?: { getMap<T>(name: string): Map<string, T> };
      };
    }
    interface Error {
      error?: string;
      scope?: string;
    }
    interface Locals {
      user?: {
        id: number;
        login: string;
        name: string | null;
        avatar_url: string;
      };
      githubToken?: string;
    }
  }
}

export {};
