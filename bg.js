/* bg.js – smooth fabric wave background for morton.nyc */
(function () {
  'use strict';

  /* ── canvas ───────────────────────────────────────────────────────────── */
  var canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'z-index:-1;display:block;pointer-events:none;';
  document.body.insertBefore(canvas, document.body.firstChild);
  var ctx = canvas.getContext('2d');

  var W, H;
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  /* ── colour: base teal #113d3d ────────────────────────────────────────── */
  var BR = 17, BG = 61, BB = 61;
  function rgb(d) {
    return 'rgb(' +
      Math.min(255, Math.max(0, (BR + d) | 0)) + ',' +
      Math.min(255, Math.max(0, (BG + d) | 0)) + ',' +
      Math.min(255, Math.max(0, (BB + d) | 0)) + ')';
  }

  /* ── wave parameters ──────────────────────────────────────────────────── */
  var AMP    = 0.48;
  var OMEGA  = 0.28;   /* slow motion — period ~22 s for main wave          */
  var STRIPS = 100;    /* gradient fills make strip edges invisible          */
  var Z_NEAR = 0.5;
  var Z_FAR  = 18.0;
  var X_HALF = 22;     /* wide enough that X-edges project off-screen        */

  /* overlapping harmonics → interference creates air-pocket fabric texture */
  var WAVES = [
    { k: (2 * Math.PI) / 4.5, a: 1.00, ph: 0.00, ow: 1.00 },
    { k: (2 * Math.PI) / 7.5, a: 0.55, ph: 3.80, ow: 0.62 },
    { k: (2 * Math.PI) / 2.8, a: 0.28, ph: 1.55, ow: 1.45 },
    { k: (2 * Math.PI) / 10,  a: 0.35, ph: 5.20, ow: 0.38 },
  ];
  var A_SUM = 1.00 + 0.55 + 0.28 + 0.35; /* normalisation denominator      */

  /* near-edge envelope: zero at camera, full amplitude ~3 world-units out  */
  function env(wz) {
    return Math.min(1.0, Math.max(0.0, (wz - Z_NEAR) / 3.2));
  }

  function waveY(wz, t) {
    var y = 0;
    for (var i = 0; i < WAVES.length; i++) {
      var w = WAVES[i];
      y += w.a * Math.sin(w.k * wz + OMEGA * w.ow * t + w.ph);
    }
    return AMP * (y / A_SUM) * env(wz);
  }

  function waveSlope(wz, t) {
    var dy = 0;
    for (var i = 0; i < WAVES.length; i++) {
      var w = WAVES[i];
      dy += w.a * w.k * Math.cos(w.k * wz + OMEGA * w.ow * t + w.ph);
    }
    return AMP * (dy / A_SUM) * env(wz);
  }

  /* ── camera ───────────────────────────────────────────────────────────── */
  var eye    = { x: -1.2, y: 3.8, z: -1.5 };
  var target = { x:  0.3, y:  0.0, z:  8.0 };
  var FOCAL  = 1.4;

  function norm3(v) {
    var l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }
  function dot3(a, b)  { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross3(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  var UP_W  = { x: 0, y: 1, z: 0 };
  var FWD   = norm3({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  var RIGHT = norm3(cross3(UP_W, FWD));
  var UP    = cross3(FWD, RIGHT);   /* already unit length                   */

  /* single diffuse light: upper-left                                        */
  var LIGHT   = norm3({ x: -0.6, y: 1.0, z: -0.4 });
  var FLAT_D  = Math.max(0, dot3({ x: 0, y: 1, z: 0 }, LIGHT)); /* ≈ 0.811 */
  var L_SCALE = 42;                            /* peak brightness swing      */
  var BG_D    = (FLAT_D * L_SCALE) | 0;        /* background brightness ≈ 34 */

  function project(wx, wy, wz) {
    var dx = wx - eye.x, dy = wy - eye.y, dz = wz - eye.z;
    var cx = dx * RIGHT.x + dy * RIGHT.y + dz * RIGHT.z;
    var cy = dx * UP.x    + dy * UP.y    + dz * UP.z;
    var cz = dx * FWD.x   + dy * FWD.y  + dz * FWD.z;
    if (cz < 0.01) return null;
    var s = FOCAL * H * 0.5 / cz;
    return { x: cx * s + W * 0.5, y: -cy * s + H * 0.5 };
  }

  /* brightness delta relative to flat surface (can be negative = shadow)   */
  function lightDelta(wz, t) {
    var slope = waveSlope(wz, t);
    var n     = norm3({ x: 0, y: 1, z: -slope });
    return ((Math.max(0, dot3(n, LIGHT)) - FLAT_D) * L_SCALE) | 0;
  }

  /* ── render loop ──────────────────────────────────────────────────────── */
  var t0 = performance.now();

  function render() {
    var t  = (performance.now() - t0) * 0.001;
    var dz = (Z_FAR - Z_NEAR) / STRIPS;

    /* fill with flat-fabric ambient so the far horizon blends seamlessly    */
    ctx.fillStyle = rgb(BG_D);
    ctx.fillRect(0, 0, W, H);

    var prev = null;

    /* paint strips far → near (painter's algorithm)                         */
    for (var i = 0; i <= STRIPS; i++) {
      var z  = Z_FAR - i * dz;
      var y  = waveY(z, t);
      var pL = project(-X_HALF, y, z);
      var pR = project( X_HALF, y, z);
      var ld = lightDelta(z, t);

      if (prev && pL && pR) {
        /* gradient spans the screen-Y extent of this trapezoid              */
        var sy0 = Math.min(prev.L.y, prev.R.y);
        var sy1 = Math.max(pL.y,     pR.y    );

        if (sy1 > sy0) {
          /* top color matches bottom of previous strip → seamless           */
          var grad = ctx.createLinearGradient(0, sy0, 0, sy1);
          grad.addColorStop(0, rgb(BG_D + prev.ld));
          grad.addColorStop(1, rgb(BG_D + ld));

          ctx.beginPath();
          ctx.moveTo(prev.L.x, prev.L.y);
          ctx.lineTo(prev.R.x, prev.R.y);
          ctx.lineTo(pR.x,     pR.y);
          ctx.lineTo(pL.x,     pL.y);
          ctx.closePath();
          ctx.fillStyle   = grad;
          ctx.strokeStyle = grad;
          ctx.lineWidth   = 0.8;   /* seals any sub-pixel gap between strips */
          ctx.fill();
          ctx.stroke();
        }
      }

      if (pL && pR) prev = { L: pL, R: pR, ld: ld };
    }

    requestAnimationFrame(render);
  }

  render();
}());
