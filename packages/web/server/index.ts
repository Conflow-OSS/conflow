import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8787";
const API_TOKEN = process.env.API_TOKEN;
const PORT = Number(process.env.PORT ?? 4000);

if (!API_TOKEN) {
  throw new Error("API_TOKEN is required — the BFF needs it to authenticate to the backend");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");

const app = express();

const injectToken = {
  proxyReq: (proxyReq: import("http").ClientRequest) => {
    proxyReq.setHeader("Authorization", `Bearer ${API_TOKEN}`);
  },
};

// Express's app.use(mountPath, ...) strips the mount path from req.url
// *before* the middleware ever sees it — so inside a handler mounted at
// "/api", a request for "/api/stats" arrives as "/stats", not "/api/stats".
// pathRewrite regexes like "^/api" would never match at that point (the
// "/api" is already gone), so the rewrite has to work on the *stripped*
// path instead — hence the function form below, not an "^/api" pattern.

// The backend's health check deliberately lives outside /v1 (no auth
// required there) — registered before the general /api handler below since
// Express matches routes in registration order and this is the more
// specific path. Everything under this mount is one fixed endpoint, so the
// rewrite is unconditional.
app.use(
  "/api/health",
  createProxyMiddleware({
    target: BACKEND_URL,
    pathRewrite: () => "/health",
    on: injectToken,
  }),
);

/**
 * The one job this server has otherwise: forward the request as-is,
 * mutating nothing but the Authorization header. No changeOrigin (the
 * backend never uses Host for anything) and no cookie handling — Cookie/
 * Set-Cookie pass through untouched by default, which is exactly right,
 * since session cookies, when they exist, are entirely the backend's
 * concern, not this proxy's.
 */
app.use(
  "/api",
  createProxyMiddleware({
    target: BACKEND_URL,
    pathRewrite: (strippedPath) => `/v1${strippedPath}`,
    on: injectToken,
  }),
);

app.use(express.static(distDir));

// SPA fallback: anything not /api/* and not a real static file is a
// client-side route — hand it index.html and let React Router take over.
// Express 5 dropped the bare "*" wildcard (path-to-regexp v6+); it now
// requires a named wildcard parameter like "/*splat".
app.get("/*splat", (_req, res) => {
  res.sendFile(join(distDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`BFF listening on http://127.0.0.1:${PORT} -> ${BACKEND_URL}`);
});
