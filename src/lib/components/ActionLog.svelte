<script lang="ts">
  export interface Action {
    id: number;
    time: string;
    method: string;
    url: string;
    explanation: string;
    request: string;
    response?: string;
    status?: number;
    error?: string;
  }
  let { actions, onClear }: { actions: Action[]; onClear: () => void } = $props();
</script>

<details class="group mt-16 border-t border-surface-200-800 pt-4 text-sm">
  <summary class="cursor-pointer text-surface-600-400 hover:text-surface-950-50">
    Request log{actions.length ? ` (${actions.length})` : ''}
  </summary>
  <section aria-label="Action log" class="mt-3 min-w-0">
    <div class="flex items-center justify-between gap-4">
      <p class="text-surface-600-400">
        Actual requests from this editor, in order. Session credentials are omitted; logs stay here
        until you clear or leave the page.
      </p>
      <button type="button" onclick={onClear} class="shrink-0 underline">Clear log</button>
    </div>
    {#if !actions.length}
      <p class="mt-4 text-surface-600-400">
        Create a post or upload an image to see Micropub in action.
      </p>
    {/if}
    <ol class="mt-4 space-y-3">
      {#each actions as action (action.id)}
        <li>
          <details class="rounded border border-surface-200-800 p-3">
            <summary class="cursor-pointer font-mono break-all">
              {action.method}
              {action.url} → {action.error ? 'Network error' : (action.status ?? 'Pending…')}
            </summary>
            <p class="mt-3">{action.explanation}</p>
            <p class="mt-1 text-xs text-surface-600-400">{action.time}</p>
            <h3 class="mt-3 font-semibold">Request</h3>
            <pre
              class="mt-1 max-h-96 overflow-auto rounded bg-surface-100-900 p-3 text-xs break-all whitespace-pre-wrap">{action.request}</pre>
            <h3 class="mt-3 font-semibold">Response</h3>
            <pre
              class="mt-1 max-h-96 overflow-auto rounded bg-surface-100-900 p-3 text-xs break-all whitespace-pre-wrap">{action.error ??
                action.response ??
                'Waiting for the server…'}</pre>
          </details>
        </li>
      {/each}
    </ol>
  </section>
</details>
