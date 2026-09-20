import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

export const revision = 'eeac57ad4b38e6a6cc0a31d6a4fe2bca2794f791';
export const archiveSha256 = '5f5595935516b631b4f35fd35b370671f9a4d63ab1847be4f7dd4c07c730edb4';

const escapeHTML = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

// Render only the literal template expressions used by this pinned revision.
// Requests and assertions stay in upstream's unmodified scripts and common.js.
// Unknown expressions fail closed instead of silently omitting test content.
export async function renderTest(directory, number, endpoint, token, fixtureOrigin) {
  let source = await readFile(join(directory, `views/server-tests/${number}.php`), 'utf8');
  const values = {};
  for (const match of source.matchAll(/'([a-z_]+)'\s*=>\s*'((?:\\.|[^'\\])*)'/gs)) {
    values[match[1]] = match[2].replace(/\\(['\\])/g, '$1');
  }
  for (const match of source.matchAll(/'([a-z_]+)'\s*=>\s*(\d+)/g)) values[match[1]] = match[2];
  const query = new URL(endpoint);
  if (values.q) query.searchParams.set('q', values.q);
  if (values.url) query.searchParams.set('url', values.url);
  const properties = source.match(/'properties'\s*=>\s*\[([^\]]+)\]/);
  if (properties) {
    for (const match of properties[1].matchAll(/'([^']+)'/g))
      query.searchParams.append('properties[]', match[1]);
  }
  values.query_url = escapeHTML(query.href);
  const partial = source.match(/\$this->insert\('(partials\/[a-z-]+)'/);
  if (partial) source = await readFile(join(directory, `views/${partial[1]}.php`), 'utf8');
  source = source.replace(/<\?php[\s\S]*?(?:\?>|$)/g, '');
  return source.replace(/<\?=\s*([\s\S]*?)\s*\?>/g, (_, expression) => {
    if (expression === '$test->id') return String(number);
    if (expression === '$endpoint->id') return '1';
    if (expression === '$endpoint->micropub_endpoint') return endpoint;
    if (expression === '$endpoint->access_token') return token;
    if (expression === '$endpoint->access_token."\\n"') return `${token}\n`;
    if (expression === 'Config::$base') return `${fixtureOrigin}/`;
    if (expression === "urlencode(Config::$base . 'media/sunset.jpg')")
      return encodeURIComponent(`${fixtureOrigin}/media/sunset.jpg`);
    if (expression === "e($test->number . ': ' . $test->name)") return `Micropub.rocks ${number}`;
    const icon = expression.match(/^result_icon\(0, '([a-z_]+)'\)$/);
    if (icon) return `<span id="${icon[1]}" class="ui circular label"></span>`;
    const literal = expression.match(/^htmlspecialchars\('([^']*)'\)$/);
    if (literal) return escapeHTML(literal[1]);
    if (expression === 'htmlspecialchars($description)')
      return escapeHTML(values.description ?? '');
    const ternary = expression.match(/^\(?\$content_type == 'json' \? '([^']*)' : '([^']*)'\)?$/);
    if (ternary) return values.content_type === 'json' ? ternary[1] : ternary[2];
    const variable = expression.match(/^\$([a-z_]+)$/);
    if (variable && Object.hasOwn(values, variable[1])) return values[variable[1]];
    throw new Error(`Unrecognized upstream template expression: ${expression}`);
  });
}

export async function runTest({
  directory,
  number,
  endpoint,
  tokens,
  fixtureOrigin,
  localFetch,
  judge
}) {
  const html = await renderTest(directory, number, endpoint, tokens.create, fixtureOrigin);
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => errors.push(err.message));
  const dom = new JSDOM(html, {
    url: `${fixtureOrigin}/server-tests/${number}`,
    runScripts: 'outside-only',
    virtualConsole
  });
  const { window } = dom;
  const requests = [];
  const judgments = [];
  let verdict = 0;
  const pending = new Set();
  try {
    window.eval(await readFile(join(directory, 'public/assets/jquery-1.11.3.min.js'), 'utf8'));
    const $ = window.$;
    // This replaces ServerTests.php's HTTP proxy and report persistence only.
    $.post = (path, params, callback) => {
      if (path === '/server-tests/store-result') {
        verdict = Number(params.passed);
        return;
      }
      if (path === '/implementation-report/store-result') return;
      const task = (async () => {
        let response;
        if (path === '/server-tests/media-check') {
          try {
            const result = await localFetch(params.url);
            response = {
              code: result.status,
              http: `HTTP ${result.status}`,
              content_type: result.headers.get('content-type')
            };
          } catch (err) {
            response = { code: 0, http: err.message, content_type: null };
          }
        } else if (path === '/server-tests/micropub') {
          const headers = new Headers();
          // Upstream 802 describes body-only authentication but omits skipauth.
          // Correct that transport error; keep its source/token assertions intact.
          if (!params.skipauth && !(number === 802 && params.method === 'post'))
            headers.set('Authorization', `Bearer ${params.access_token ?? tokens.create}`);
          const init = {
            method: params.method === 'get' ? 'GET' : 'POST',
            headers,
            redirect: 'manual'
          };
          let url = endpoint;
          if (params.method === 'get') {
            url = params.url;
            headers.set('Accept', 'application/json');
          } else if (params.method === 'post' || params.method === 'postjson') {
            headers.set(
              'Content-Type',
              params.method === 'post' ? 'application/x-www-form-urlencoded' : 'application/json'
            );
            if (params.method === 'postjson') headers.set('Accept', 'application/json');
            init.body = params.body;
          } else if (params.method === 'multipart') {
            url = params.url || endpoint;
            const form = new FormData();
            for (const [key, value] of Object.entries(params.params ?? {})) form.append(key, value);
            for (const [key, value] of Object.entries(params.files)) {
              const names = Array.isArray(value) ? value : [value];
              for (const name of names) {
                if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid upstream fixture filename');
                const mime = name.endsWith('.jpg')
                  ? 'image/jpeg'
                  : name.endsWith('.png')
                    ? 'image/png'
                    : 'image/gif';
                form.append(
                  names.length === 1 ? key : `${key}[]`,
                  new Blob([await readFile(join(directory, 'public/media', name))], { type: mime }),
                  name
                );
              }
            }
            init.body = form;
          } else throw new Error(`Unknown upstream request method: ${params.method}`);
          const result = await localFetch(url, init);
          const body = await result.text();
          const contentType = result.headers.get('content-type') ?? '';
          response = {
            code: result.status,
            location: result.headers.get('location') || false,
            content_type: contentType.includes('application/json')
              ? 'application/json'
              : contentType,
            headers: Object.fromEntries(result.headers),
            body,
            json: null,
            debug: `HTTP ${result.status}\n${body}`
          };
          if (body.startsWith('{') && response.content_type === 'application/json') {
            try {
              response.json = JSON.parse(body);
            } catch {
              /* Upstream treats invalid JSON as null. */
            }
          }
        } else throw new Error(`Unexpected upstream AJAX path: ${path}`);
        requests.push({ path, request: params, response });
        callback?.(response);
      })().catch((err) => errors.push(err.stack ?? String(err)));
      pending.add(task);
      void task.finally(() => pending.delete(task));
    };
    const common = await readFile(join(directory, 'public/assets/common.js'), 'utf8');
    const scripts = [...window.document.querySelectorAll('script')].map(
      (script) => script.textContent
    );
    // Bun's jsdom VM loses top-level function declarations. A shared lexical
    // scope preserves the unchanged scripts and their callback closures.
    window.eval(`(function () {\n${[common, ...scripts].join('\n')}\n})();`);
    await new Promise((resolve) => $(resolve));
    if (number === 804) $('#access-token-input').val(tokens.restricted).trigger('change');
    const clicked = new Set();
    for (let stage = 0; stage < 10; stage++) {
      const button = [...window.document.querySelectorAll('button[id^="run"]')].find(
        (el) => !clicked.has(el.id) && !el.closest('.hidden') && !el.classList.contains('disabled')
      );
      const prompt =
        judge &&
        [...window.document.querySelectorAll('.prompt')].find(
          (el) => !clicked.has(el.id) && !el.closest('.hidden')
        );
      if (!button && !prompt) break;
      if (button) {
        clicked.add(button.id);
        $(button).trigger('click');
      } else {
        clicked.add(prompt.id);
        try {
          const evidence = await judge({ number, id: prompt.id, requests });
          judgments.push({ check: prompt.id, passed: true, evidence });
          $(prompt).trigger('click');
        } catch (err) {
          judgments.push({ check: prompt.id, passed: false, evidence: err.message });
          $(prompt).addClass('red');
          verdict = -1;
          break;
        }
      }
      while (pending.size) await Promise.all([...pending]);
      // Media tests register the second click handler from a ready callback.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const failedChecks = [...window.document.querySelectorAll('.result-list .red')].map((el) =>
      el.parentElement.textContent.trim()
    );
    const manualChecks = [...window.document.querySelectorAll('.prompt')].map((el) =>
      el.parentElement.textContent.trim()
    );
    const status = errors.length
      ? 'error'
      : verdict === -1 || failedChecks.length
        ? 'fail'
        : verdict === 1
          ? 'pass'
          : 'pending';
    return {
      number,
      status,
      failedChecks,
      manualChecks,
      judgments,
      errors,
      requests,
      html: dom.serialize()
    };
  } finally {
    window.close();
  }
}
