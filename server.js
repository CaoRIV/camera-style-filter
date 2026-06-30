// Minimal static server + fal proxy for CameraRealtimeStyle.
//
// The browser must NOT hold your FAL_KEY, so the fal client is pointed at
// `/api/fal/proxy` (see public/styler.js). This server adds your key from the
// FAL_KEY env var and forwards to fal. Only the short realtime *token* request
// goes through here; the realtime WebSocket then connects directly to fal.
//
// Run:  FAL_KEY=your-key-id:your-key-secret npm start
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tiny zero-dependency .env loader (so `cp .env.example .env` then `npm start`
// works). Inline `FAL_KEY=... npm start` keeps working too — real env wins.
try {
  for (const line of readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith("#")) {
      const key = m[1];
      const val = m[2].replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  }
} catch { /* no .env file — fine */ }

const PORT = process.env.PORT || 3000;
const FAL_KEY = process.env.FAL_KEY;

if (!FAL_KEY) {
  console.warn(
    "\n[!] FAL_KEY is not set. The app will load but styling will fail.\n" +
      "    Start with:  FAL_KEY=your-key-id:your-key-secret npm start\n" +
      "    Get a key at https://fal.ai/dashboard/keys\n"
  );
}

const app = express();

// fal's proxy protocol: the real target URL arrives in `x-fal-target-url`;
// we attach the key and forward. Buffer the body (responses here are small
// JSON — auth tokens, etc.). Accept any content type and all methods.
const rawBody = express.raw({ type: "*/*", limit: "30mb" });

async function proxyHandler(req, res) {
  const targetUrl = req.header("x-fal-target-url");
  if (!targetUrl) {
    return res.status(400).json({ error: "Missing x-fal-target-url header" });
  }
  let host;
  try {
    host = new URL(targetUrl).host;
  } catch {
    return res.status(400).json({ error: "Invalid target URL" });
  }
  if (!(host === "fal.run" || host.endsWith(".fal.run") || host === "fal.ai" || host.endsWith(".fal.ai"))) {
    return res.status(403).json({ error: `Target host not allowed: ${host}` });
  }

  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];
  delete headers["x-fal-target-url"];
  headers["authorization"] = `Key ${FAL_KEY}`;

  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD" && req.body && req.body.length) {
    init.body = req.body;
  }

  try {
    const upstream = await fetch(targetUrl, init);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k === "content-encoding" || k === "transfer-encoding" || k === "content-length") return;
      res.setHeader(key, value);
    });
    res.send(buf);
  } catch (err) {
    console.error("[proxy] error:", err);
    res.status(502).json({ error: "Upstream request failed", detail: String(err) });
  }
}

app.all("/api/fal/proxy", rawBody, proxyHandler);
app.all("/api/fal/proxy/*", rawBody, proxyHandler);

// Realtime token endpoint. The fal client's default (proxy-based) token
// provider is deprecated, so we mint short-lived tokens here and hand them to
// the browser via a custom tokenProvider (see public/styler.js). The token
// authorizes the realtime WebSocket; the FAL_KEY itself never leaves the server.
app.post("/api/fal/token", express.json(), async (req, res) => {
  if (!FAL_KEY) {
    return res.status(500).json({ error: "FAL_KEY is not set on the server." });
  }
  const apps =
    Array.isArray(req.body?.allowed_apps) && req.body.allowed_apps.length
      ? req.body.allowed_apps
      : ["flux-2"];
  try {
    const r = await fetch("https://rest.alpha.fal.ai/tokens/", {
      method: "POST",
      headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_apps: apps, token_expiration: 300 }),
    });
    const text = await r.text(); // fal returns the token as a JSON string
    res.status(r.status).type("application/json").send(text);
  } catch (err) {
    console.error("[token] error:", err);
    res.status(502).json({ error: "Token request failed", detail: String(err) });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`\n  ▶  CameraRealtimeStyle  →  http://localhost:${PORT}`);
  console.log(`     FAL_KEY: ${FAL_KEY ? "set ✓" : "MISSING ✗"}\n`);
});
