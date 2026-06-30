// Realtime restyling via fal-ai/flux-2/klein/realtime.
//
// The key never touches the browser — the local server adds it (see server.js),
// so the fal client is pointed at our `/api/fal/proxy`. Only the short realtime
// auth-token request goes through the proxy; the WebSocket then connects
// straight to fal.
import { fal } from "https://esm.sh/@fal-ai/client@1";

fal.config({ proxyUrl: "/api/fal/proxy" });

// fal's default (proxy-based) token provider is deprecated, so we mint tokens
// from our own endpoint (server.js → /api/fal/token) and hand them to the
// realtime client. The WebSocket then connects straight to fal with the token.
async function tokenProvider(app) {
  const parts = String(app).split("/").filter(Boolean);
  const alias = parts[1] || parts[0]; // fal-ai/flux-2/klein/realtime → flux-2
  const res = await fetch("/api/fal/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowed_apps: [alias] }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`token request failed (${res.status}) ${detail}`.trim());
  }
  return res.json(); // fal returns the token as a JSON string
}

// [name, prompt] pairs. The FIRST entry is the raw camera (prompt = null) — no
// model call, instant, free. Every other prompt is framed as a transformation
// ("Turn this into…") so the model restyles your camera instead of inventing a
// new scene. Edit / reorder freely.
export const STYLES = [
  ["Normal feed", null],
  ["Claymation", "Turn this into claymation — handmade plasticine clay, stop-motion look, soft studio light"],
  ["Pixar 3D", "Turn this into a 3D animated movie still, Pixar style, soft global illumination"],
  ["Anime", "Turn this into anime, clean cel shading, vibrant colors, crisp linework"],
  ["Oil painting", "Repaint this as a thick oil painting, bold visible brushstrokes, impasto"],
  ["Watercolor", "Turn this into a loose watercolor painting, soft washes, textured paper"],
  ["Pencil sketch", "Turn this into a detailed graphite pencil sketch, fine cross-hatching"],
  ["Pixel art", "Turn this into retro 16-bit pixel art, limited palette, sharp pixels"],
  ["Cyberpunk neon", "Restyle this with cyberpunk neon lighting, rain-soaked, moody, cinematic"],
  ["LEGO bricks", "Rebuild this out of LEGO plastic bricks and minifigures, glossy toy photography"],
  ["Ukiyo-e", "Turn this into a Japanese ukiyo-e woodblock print, flat colors, bold outlines"],
];

const MAX_PENDING = 8; // keep the GPU pipeline full (matches the desktop tool)

/**
 * Wraps a single realtime connection. The app drives it with callbacks:
 *   getFrame()    → a JPEG data-URI to send, or null to skip this tick
 *   getPrompt()   → the current transformation prompt (string)
 *   getSettings() → { endpoint, imageSize, steps, feedback, sendFps }
 *   onImage(url)  → a freshly styled frame arrived
 *   onStats({fps, lat}) / onState(text, cls) → UI updates
 */
export class Styler {
  constructor(opts) {
    this.opts = opts;
    this.connection = null;
    this.running = false; // streaming frames right now?
    this.pending = []; // timestamps of in-flight frames (backpressure)
    this.lastResult = 0;
    this.frameTimes = [];
    this.sendTimer = null;
    this.watchdogTimer = null;
    this.lastObjUrl = null;
  }

  // Open the realtime connection (idempotent).
  open() {
    if (this.connection) return;
    const { endpoint } = this.opts.getSettings();
    this.opts.onState?.("connecting", "warn");
    this.connection = fal.realtime.connect(endpoint, {
      connectionKey: "camera-style",
      throttleInterval: 0,
      maxBuffering: MAX_PENDING,
      tokenProvider,
      onResult: (r) => this._onResult(r),
      onError: (err) => {
        console.error(err);
        this.opts.onState?.("error — see console", "err");
      },
    });
    this.opts.onState?.("streaming", "on");
  }

  // Begin streaming frames at the target FPS.
  start() {
    if (this.running) return;
    this.running = true;
    this.pending = [];
    this.lastResult = 0;
    this.frameTimes = [];
    this.open();
    this._startTimer();
    this._watchdog();
  }

  // Stop streaming but keep nothing alive (called when switching to the raw
  // feed or stopping the camera). Closes the connection to avoid idle billing.
  stop() {
    this.running = false;
    clearInterval(this.sendTimer);
    this.sendTimer = null;
    clearTimeout(this.watchdogTimer);
    try { this.connection?.close?.(); } catch {}
    this.connection = null;
    this.pending = [];
    this.opts.onState?.("idle", "");
  }

  // Re-read the send FPS (call after the settings change while running).
  refreshTimer() {
    if (this.running) this._startTimer();
  }

  _startTimer() {
    clearInterval(this.sendTimer);
    const { sendFps } = this.opts.getSettings();
    const fps = Math.max(1, Math.min(30, parseInt(sendFps, 10) || 16));
    this.sendTimer = setInterval(() => this._sendFrame(), Math.floor(1000 / fps));
  }

  _sendFrame() {
    if (!this.running || !this.connection) return;
    const now = performance.now();
    this.pending = this.pending.filter((t) => now - t < 2000); // drop stale
    if (this.pending.length >= MAX_PENDING) return;            // backpressure
    const dataUri = this.opts.getFrame();
    if (!dataUri) return; // no frame ready (or paused)
    const s = this.opts.getSettings();
    try {
      this.connection.send({
        prompt: this.opts.getPrompt() || "a photo",
        image_url: dataUri,
        image_size: s.imageSize,
        num_inference_steps: parseInt(s.steps, 10) || 3,
        seed: 42,
        output_feedback_strength: parseFloat(s.feedback),
        schedule_mu: 2.3,
        enable_interpolation: false,
      });
      this.pending.push(now);
    } catch (e) {
      console.error("send failed", e);
    }
  }

  _onResult(result) {
    this.pending.shift(); // a frame came back → free a pipeline slot
    const imgs = result && result.images;
    if (!imgs || !imgs.length) return;
    const img = imgs[imgs.length - 1];
    let url = null;
    if (img.content instanceof Uint8Array) {
      url = URL.createObjectURL(new Blob([img.content], { type: img.content_type || "image/jpeg" }));
    } else if (typeof img.content === "string") {
      url = `data:${img.content_type || "image/jpeg"};base64,${img.content}`;
    } else if (img.url) {
      url = img.url;
    }
    if (!url) return;

    this.opts.onImage?.(url);
    if (this.lastObjUrl && this.lastObjUrl.startsWith("blob:")) URL.revokeObjectURL(this.lastObjUrl);
    this.lastObjUrl = url;

    const now = performance.now();
    let fps = null;
    if (this.lastResult) {
      this.frameTimes.push(now - this.lastResult);
      if (this.frameTimes.length > 12) this.frameTimes.shift();
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      fps = 1000 / avg;
    }
    const lat = result.timings && typeof result.timings.total === "number"
      ? Math.round(result.timings.total * 1000)
      : null;
    this.opts.onStats?.({ fps, lat });
    this.lastResult = now;
  }

  // The endpoint drops the session roughly every 30s (billing re-check). If
  // results stop arriving, reconnect — a brief hitch, then it resumes.
  _watchdog() {
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      const tick = () => {
        if (!this.running) return;
        const stalled = this.lastResult && performance.now() - this.lastResult > 6000;
        if (stalled) {
          console.log("[watchdog] stalled → reconnecting");
          try { this.connection?.close?.(); } catch {}
          this.connection = null;
          this.pending = [];
          this.open();
          this.lastResult = performance.now();
        }
        this.watchdogTimer = setTimeout(tick, 3000);
      };
      tick();
    }, 6000);
  }
}
