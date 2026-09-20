import { error } from '@sveltejs/kit';
import { getAccessToken } from './token-store';

/** Explicit protocol credentials take precedence over the editor session. */
export function requireMicropubToken(
  request: Request,
  locals: App.Locals,
  url: URL,
  bodyToken?: unknown,
  requiredScope?: string
): string {
  const header = request.headers.get('authorization');
  const queryToken = url.searchParams.get('access_token');
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
