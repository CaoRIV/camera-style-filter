// MediaPipe Hand landmark indices (21 points)
//   0 wrist
//   1-4   thumb  (cmc, mcp, ip, tip)
//   5-8   index  (mcp, pip, dip, tip)
//   9-12  middle (mcp, pip, dip, tip)
//   13-16 ring   (mcp, pip, dip, tip)
//   17-20 pinky  (mcp, pip, dip, tip)

const WRIST = 0;
const INDEX_MCP = 5; // index knuckle
const INDEX_TIP = 8;
const PALM = 9; // middle-finger MCP ≈ palm centre

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// A non-thumb finger is "extended" when its tip is farther from the wrist
// than its PIP joint. Orientation-independent — works in any hand pose,
// including when the hand points sideways.
function fingerExtended(lm, tip, pip) {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.04;
}

// How much the gesture must lean horizontal before it counts as a left/right
// point: |dx| must beat |dy| by this factor, and span at least MIN_SPAN of the
// frame width. Tuned so a relaxed sideways point triggers but an upward "1
// finger" pose does not.
const HORIZ_RATIO = 1.15;
const MIN_SPAN = 0.05;

/**
 * Classify a single hand's gesture from its landmarks.
 *
 * Everything here is computed in SCREEN space (the view is mirrored, so
 * screenX = 1 - landmarkX). That way "point toward the right edge of the
 * screen" always means `right`, regardless of how the camera mirrors you.
 *
 * @returns {{name:string, cursor:{x:number,y:number}}}
 *   name ∈ "left" | "right" | "point" | "open" | "none"
 *   cursor is in normalized [0..1] coords of the ORIGINAL (un-mirrored) frame.
 */
export function detectGesture(lm) {
  const index = fingerExtended(lm, INDEX_TIP, 6);
  const middle = fingerExtended(lm, 12, 10);
  const ring = fingerExtended(lm, 16, 14);
  const pinky = fingerExtended(lm, 20, 18);

  // 🖐️ Open hand (index + middle + ring + pinky out) → "reset to normal feed".
  if (index && middle && ring && pinky) {
    return { name: "open", cursor: lm[PALM] };
  }

  // ☝️ Index out, middle folded → a pointer. Decide left / right / neutral
  // from the finger's direction (knuckle → tip) in screen space.
  if (index && !middle) {
    const tipX = 1 - lm[INDEX_TIP].x; // mirror to screen space
    const knX = 1 - lm[INDEX_MCP].x;
    const dx = tipX - knX;
    const dy = lm[INDEX_TIP].y - lm[INDEX_MCP].y;

    if (Math.abs(dx) > Math.abs(dy) * HORIZ_RATIO && Math.abs(dx) > MIN_SPAN) {
      return { name: dx > 0 ? "right" : "left", cursor: lm[INDEX_TIP] };
    }
    // Pointing up/down or straight at the camera — a neutral pointer.
    return { name: "point", cursor: lm[INDEX_TIP] };
  }

  return { name: "none", cursor: lm[INDEX_TIP] };
}
