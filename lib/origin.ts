// Derive the request's origin from the Host header rather than
// `new URL(request.url).origin`, which Next normalizes to "localhost" in dev
// even when the user is on 127.0.0.1. Redirecting to the wrong host drops
// host-scoped auth cookies, so this keeps sign-in/out on the user's actual host.
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}
