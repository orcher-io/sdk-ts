import type { TlsConfig } from './types';

/**
 * The TLS setting to use for a server URL.
 *
 * The native driver speaks TLS only when handed a `tls` object; given none
 * it dials in plaintext whatever the URL says. Against an `https://`
 * endpoint that fails at the handshake, silently and forever: the worker
 * reports itself connected and never completes a poll. Nobody writing
 * `https://` means plaintext, so the scheme decides the default. An explicit
 * setting always wins, which is how a private CA or client certificate is
 * supplied. `http://` gets no TLS.
 */
export function tlsForUrl(serverUrl: string, explicit?: TlsConfig): TlsConfig | undefined {
  if (explicit !== undefined) {
    return explicit;
  }
  return /^https:\/\//i.test(serverUrl.trim()) ? {} : undefined;
}
