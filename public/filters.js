// One-Euro filter: the standard technique for suppressing hand-tracking jitter
// with low latency. Strong smoothing during slow motion, low latency during
// fast motion (the cutoff frequency rises with speed).
// Ref: Casiez et al., "1€ Filter" (CHI 2012).

class LowPass {
  constructor() {
    this.y = null;
  }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  reset() {
    this.y = null;
  }
}

export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.tPrev = null;
    this.xLP = new LowPass();
    this.dxLP = new LowPass();
  }
  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, tMs) {
    if (this.tPrev === null) {
      this.tPrev = tMs;
      this.xPrev = x;
      this.xLP.y = x;
      return x;
    }
    let dt = (tMs - this.tPrev) / 1000;
    if (dt <= 0 || dt > 1) dt = 1 / 30;
    this.tPrev = tMs;

    const dx = (x - this.xPrev) / dt;
    this.xPrev = x;
    const edx = this.dxLP.filter(dx, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xLP.filter(x, this.alpha(cutoff, dt));
  }
  reset() {
    this.xPrev = null;
    this.tPrev = null;
    this.xLP.reset();
    this.dxLP.reset();
  }
}

// Filters the x and y axes of a 2D point together.
export class PointFilter {
  constructor(opts) {
    this.fx = new OneEuro(opts);
    this.fy = new OneEuro(opts);
  }
  filter(p, tMs) {
    return { x: this.fx.filter(p.x, tMs), y: this.fy.filter(p.y, tMs) };
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
}
