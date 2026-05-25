// Client-rendered app (data is fetched at runtime from the local API), but
// we still prerender the route shells so each path (e.g. /anomalies) is a
// real static file served with HTTP 200 on GitHub Pages instead of relying
// on the 404.html SPA fallback. ssr=false keeps component logic client-only.
export const prerender = true;
export const ssr = false;
