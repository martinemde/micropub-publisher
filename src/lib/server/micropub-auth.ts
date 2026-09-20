import { error } from '@sveltejs/kit';
import { getAccessToken } from './token-store';

/** Explicit protocol credentials take precedence over the editor session. */
export function requireMicropubToken(
  request: Request,
  locals: App.Locals,
  url: URL,
  bodyToken?: unknown,
  requiredScope?: string
): string | Response {
  const header = request.headers.get('authorization');
  const queryToken = url.searchParams.get('access_token');
  // RFC 6750 forbids supplying the token via more than one transport.
  // An empty 400 body also avoids ambiguous OAuth error vocabulary.
  if ([header !== null, queryToken !== null, bodyToken !== undefined].filter(Boolean).length > 1) {
    return new Response(null, { status: 400 });
  }
  let tokenId: string | null;

  if (header !== null) {
    tokenId = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? '';
  } else if (queryToken !== null) {
    tokenId = queryToken;
  } else if (bodyToken !== undefined) {
    tokenId = typeof bodyToken === 'string' ? bodyToken : '';
  } else if (locals.githubToken) {
    // The server hook exposes sessions here only for the same-origin editor.
    return locals.githubToken;
  } else {
    tokenId = null;
  }

  const token = tokenId ? getAccessToken(tokenId) : null;
  if (!token) {
    error(401, { message: 'Unauthorized', error: 'unauthorized' });
  }
  if (requiredScope && !token.scope.split(' ').includes(requiredScope)) {
    error(401, {
      message: `Token requires ${requiredScope} scope`,
      error: 'insufficient_scope',
      scope: requiredScope
    });
  }
  return token.githubToken;
}
