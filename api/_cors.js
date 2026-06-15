// Shared CORS utilities for all API endpoints. Single source of truth for origin allowlist.

export function originAllowed(req) {
  const src = req.headers.origin || req.headers.referer || '';
  if (!src) return false;
  try {
    const host = new URL(src).hostname;
    return (
      host === 'yapoleonscourt.com' ||
      host.endsWith('.yapoleonscourt.com') ||
      host.endsWith('.vercel.app') ||
      host === 'localhost' ||
      host === '127.0.0.1'
      || src.startsWith('capacitor://localhost')
    );
  } catch {
    return false;
  }
}

export function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  if (origin && originAllowed(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}
