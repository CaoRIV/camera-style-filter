import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
import { detectGesture } from "./gestures.js";
import { STYLES, Styler } from "./styler.js";
import { PointFilter } from "./filters.js";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

// --- Tuning ---
const CAP = 704; // square sent to the model (endpoint resizes to 768/1024 anyway)
const INF_W = 480; // hand tracking runs on a small canvas → cheap inference
const HOLD_FRAMES = 4; // consecutive frames a direction must hold before it fires
const SWITCH_COOLDOWN_MS = 750; // min gap between style switches (hold to cycle)
const JPEG_Q = 0.5; // smaller upload = lower latency
const FILTER_OPTS = { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 };

// ---------- DOM ----------
const stage = document.getElementById("stage");
const video = document.getElementById("video");
const outImg = document.getElementById("out");
const overlay = document.getElementById("overlay");
const octx = overlay.getContext("2d");
const badge = document.getElementById("badge");
const hint = document.getElementById("hint");
const toast = document.getElementById("toast");
const strip = document.getElementById("strip");
const splash = document.getElementById("splash");
const splashNote = document.getElementById("splashNote");
const startBtn = document.getElementById("startBtn");

const stateDot = document.getElementById("state");
const stateLabel = document.getElementById("stateLabel");
const fpsEl = document.getElementById("fps");
const latEl = document.getElementById("lat");
const cfg = {
  endpoint: document.getElementById("endpoint"),
  imageSize: document.getElementById("imageSize"),
  steps: document.getElementById("steps"),
  feedback: document.getElementById("feedback"),
  sendFps: document.getElementById("sendFps"),
};

// ---------- State ----------
const cursorFilter = new PointFilter(FILTER_OPTS);
const infCanvas = document.createElement("canvas");
const ictx = infCanvas.getContext("2d");
const cap = document.createElement("canvas");
cap.width = cap.height = CAP;
const cctx = cap.getContext("2d", { alpha: false });

let handLandmarker = null;
let running = false;
let lastVideoTime = -1;

let styleIndex = 0; // 0 = Normal feed (raw camera)
let awaitingFirst = false; // waiting for the first styled frame after a switch

// pointing debounce
let lastDir = null;
let dirFrames = 0;
let lastSwitchAt = 0;

// ---------- Styler ----------
const styler = new Styler({
  getFrame,
  getPrompt: () => STYLES[styleIndex][1],
  getSettings: () => ({
    endpoint: cfg.endpoint.value.trim(),
    imageSize: cfg.imageSize.value,
    steps: cfg.steps.value,
    feedback: cfg.feedback.value,
    sendFps: cfg.sendFps.value,
  }),
  onImage(url) {
    outImg.src = url;
    if (awaitingFirst) {
      awaitingFirst = false;
      outImg.classList.add("show");
      setBadge();
    }
  },
  onStats({ fps, lat }) {
    if (fps != null) fpsEl.textContent = fps.toFixed(1);
    if (lat != null) latEl.textContent = lat;
  },
  onState(text, clsName) {
    stateLabel.textContent = text;
    stateDot.className = "dot " + (clsName || "");
  },
});

// ---------- Capture ----------
// Largest centered SQUARE of the webcam, drawn MIRRORED so the styled output
// matches the mirrored on-screen preview (selfie view). The endpoint output is
// square, so a square input maps 1:1 — no letterbox, no distortion.
function drawSquare() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return false;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2, sy = (vh - side) / 2;
  cctx.save();
  cctx.translate(CAP, 0);
  cctx.scale(-1, 1);
  cctx.drawImage(video, sx, sy, side, side, 0, 0, CAP, CAP);
  cctx.restore();
  return true;
}

function getFrame() {
  if (styleIndex === 0) return null; // Normal feed → nothing to send
  if (!drawSquare()) return null;
  try { return cap.toDataURL("image/jpeg", JPEG_Q); } catch { return null; }
}

// ---------- Style selection ----------
function buildStrip() {
  STYLES.forEach(([name], i) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (i === 0 ? " active" : "");
    chip.textContent = name;
    chip.dataset.index = String(i);
    chip.addEventListener("click", () => setStyle(i));
    strip.appendChild(chip);
  });
}

function syncStrip() {
  [...strip.children].forEach((chip, i) => {
    chip.classList.toggle("active", i === styleIndex);
  });
  const active = strip.children[styleIndex];
  active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
}

function setStyle(i) {
  const n = STYLES.length;
  styleIndex = ((i % n) + n) % n; // wrap-around cycling
  syncStrip();
  flashTitle(STYLES[styleIndex][0]);

  if (styleIndex === 0) {
    // Raw camera: hide the styled layer, stop streaming (no idle billing).
    awaitingFirst = false;
    outImg.classList.remove("show");
    styler.stop();
  } else {
    // Mark that we're waiting for this style's first frame (drives the
    // "stylizing…" badge). We deliberately DON'T hide the styled layer here:
    // coming from Normal it's already hidden and fades in on the first frame;
    // coming from another style we keep the old frame visible until the new one
    // replaces it — no raw-camera flash between styles.
    awaitingFirst = true;
    styler.start();
  }
  setBadge();
}

function switchStyle(delta) {
  setStyle(styleIndex + delta);
}

// ---------- Gesture → action ----------
function onGesture(name, now) {
  if (name === "right" || name === "left") {
    if (name === lastDir) dirFrames++;
    else { lastDir = name; dirFrames = 1; }
    if (dirFrames >= HOLD_FRAMES && now - lastSwitchAt >= SWITCH_COOLDOWN_MS) {
      switchStyle(name === "right" ? 1 : -1);
      lastSwitchAt = now;
    }
    return;
  }
  lastDir = null;
  dirFrames = 0;
  // Open hand → jump back to the raw feed.
  if (name === "open" && styleIndex !== 0 && now - lastSwitchAt >= SWITCH_COOLDOWN_MS) {
    setStyle(0);
    lastSwitchAt = now;
  }
}

// ---------- UI ----------
function setBadge() {
  const name = STYLES[styleIndex][0];
  if (styleIndex === 0) {
    badge.textContent = "📷 " + name;
    badge.className = "badge";
  } else if (awaitingFirst) {
    badge.textContent = "✨ " + name + " — stylizing…";
    badge.className = "badge live";
  } else {
    badge.textContent = "✨ " + name;
    badge.className = "badge live";
  }
}

function flashTitle(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(flashTitle._t);
  flashTitle._t = setTimeout(() => toast.classList.remove("show"), 900);
}

function toScreen(nx, ny) {
  return { x: (1 - nx) * overlay.width, y: ny * overlay.height }; // mirrored
}

function renderOverlay(name, p) {
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!p) return;

  // Fingertip dot.
  octx.beginPath();
  octx.arc(p.x, p.y, 7, 0, Math.PI * 2);
  octx.fillStyle = "rgba(91,140,255,0.9)";
  octx.fill();
  octx.lineWidth = 2;
  octx.strokeStyle = "rgba(255,255,255,0.9)";
  octx.stroke();

  // Direction arrow + hold progress when pointing sideways.
  if (name === "left" || name === "right") {
    const dir = name === "right" ? 1 : -1;
    const prog = Math.min(1, dirFrames / HOLD_FRAMES);
    const len = 60;
    const ax = p.x + dir * 34;
    octx.strokeStyle = "rgba(255,255,255,0.95)";
    octx.lineWidth = 5;
    octx.beginPath();
    octx.moveTo(ax, p.y);
    octx.lineTo(ax + dir * len * prog, p.y);
    octx.stroke();
    // arrow head
    const hx = ax + dir * len * prog;
    octx.beginPath();
    octx.moveTo(hx, p.y);
    octx.lineTo(hx - dir * 12, p.y - 9);
    octx.lineTo(hx - dir * 12, p.y + 9);
    octx.closePath();
    octx.fillStyle = "rgba(255,255,255,0.95)";
    octx.fill();
  }
}

function resizeOverlay() {
  overlay.width = Math.round(stage.clientWidth);
  overlay.height = Math.round(stage.clientHeight);
}

// ---------- Core loop ----------
function loop() {
  if (!running) return;
  try {
    const now = performance.now();
    if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
      lastVideoTime = video.currentTime;
      ictx.drawImage(video, 0, 0, infCanvas.width, infCanvas.height);
      const result = handLandmarker.detectForVideo(infCanvas, now);
      if (result.landmarks && result.landmarks.length > 0) {
        const g = detectGesture(result.landmarks[0]);
        const f = cursorFilter.filter(g.cursor, now);
        onGesture(g.name, now);
        renderOverlay(g.name, toScreen(f.x, f.y));
      } else {
        lastDir = null;
        dirFrames = 0;
        cursorFilter.reset();
        renderOverlay("none", null);
      }
    }
  } catch (e) {
    console.error("loop error (ignored):", e);
  }
  requestAnimationFrame(loop);
}

// ---------- Startup ----------
async function init() {
  startBtn.disabled = true;
  splashNote.textContent = "Loading hand-tracking model…";
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const make = (delegate) =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        numHands: 1,
        runningMode: "VIDEO",
        minHandDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      handLandmarker = await make("GPU");
    } catch (gpuErr) {
      console.warn("GPU delegate failed, falling back to CPU", gpuErr);
      handLandmarker = await make("CPU");
    }
  } catch (err) {
    console.error(err);
    splashNote.textContent = "Failed to load model. Check your internet connection.";
    startBtn.disabled = false;
    return;
  }

  splashNote.textContent = "Starting camera…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        aspectRatio: { ideal: 16 / 9 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    console.error(err);
    splashNote.textContent = "Camera permission denied or no camera found.";
    startBtn.disabled = false;
    return;
  }

  await new Promise((r) => {
    if (video.videoWidth) return r();
    video.onloadedmetadata = () => r();
  });
  const vw = video.videoWidth, vh = video.videoHeight;
  infCanvas.width = INF_W;
  infCanvas.height = Math.max(1, Math.round((INF_W * vh) / vw));
  resizeOverlay();

  splash.classList.add("hidden");
  running = true;
  setStyle(0);
  setBadge();
  loop();
}

// ---------- Events ----------
startBtn.addEventListener("click", init);
window.addEventListener("resize", () => { if (running) resizeOverlay(); });
cfg.sendFps.addEventListener("change", () => styler.refreshTimer());

// Keyboard fallback: ← / → step through styles (handy for testing the styling
// round-trip without relying on hand tracking). Ignored while typing in the
// Settings inputs; shares the gesture cooldown so the two can't fight.
window.addEventListener("keydown", (e) => {
  if (!running) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  if (e.key === "ArrowRight") switchStyle(1);
  else if (e.key === "ArrowLeft") switchStyle(-1);
  else return;
  lastSwitchAt = performance.now();
  e.preventDefault();
});

buildStrip();
