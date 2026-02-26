/* bg.js – animated 3-D wave background for morton.nyc */
(function () {
  'use strict';

  /* ── canvas ───────────────────────────────────────────────────────── */
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

  /* ── colour – base teal #113d3d ───────────────────────────────────── */
  var BR = 17, BG = 61, BB = 61;
  function shade(v) {
    var f = v * 3.2;
    return (
      'rgb(' +
      (Math.min(255, (BR * f) | 0)) + ',' +
      (Math.min(255, (BG * f) | 0)) + ',' +
      (Math.min(255, (BB * f) | 0)) + ')'
    );
  }

  /* ── wave parameters ──────────────────────────────────────────────── */
  var AMP    = 0.50;                   /* amplitude (world units)        */
  var K      = (2 * Math.PI) / 4.5;   /* wave number (2π / λ)           */
  var OMEGA  = 0.65;                   /* angular frequency (rad/s)      */
  var STRIPS = 80;                     /* horizontal rendering slices    */
  var Z_NEAR = 0.8;
  var Z_FAR  = 16.0;
  var X_HALF = 15;                     /* half-width of wave plane       */

  /* ── camera: slightly above and to the left ───────────────────────── */
  var eye    = { x: -1.2, y: 3.8, z: -1.5 };
  var target = { x:  0.3, y:  0.0, z:  8.0 };
  var FOCAL  = 1.4;                    /* higher = narrower FOV          */

  /* ── single diffuse light source: upper-left ──────────────────────── */
  var LIGHT = norm3({ x: -0.6, y: 1.0, z: -0.4 });

  /* ── vector helpers ───────────────────────────────────────────────── */
  function norm3(v) {
    var l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }
  function dot3(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }
  function cross3(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  /* ── camera basis (computed once) ────────────────────────────────── */
  var W_UP  = { x: 0, y: 1, z: 0 };
  var FWD   = norm3({
    x: target.x - eye.x,
    y: target.y - eye.y,
    z: target.z - eye.z
  });
  var RIGHT = norm3(cross3(W_UP, FWD));
  var UP    = cross3(FWD, RIGHT);       /* already unit length            */

  /* ── perspective projection ───────────────────────────────────────── */
  function project(wx, wy, wz) {
    var dx = wx - eye.x, dy = wy - eye.y, dz = wz - eye.z;
    var cx = dx * RIGHT.x + dy * RIGHT.y + dz * RIGHT.z;
    var cy = dx * UP.x    + dy * UP.y    + dz * UP.z;
    var cz = dx * FWD.x   + dy * FWD.y  + dz * FWD.z;
    if (cz < 0.01) return null;
    var s = FOCAL * H * 0.5 / cz;
    return { x: cx * s + W * 0.5, y: -cy * s + H * 0.5 };
  }

  /* ── render loop ──────────────────────────────────────────────────── */
  var t0 = performance.now();

  function render() {
    var t  = (performance.now() - t0) * 0.001;
    var dz = (Z_FAR - Z_NEAR) / STRIPS;

    /* sky / below-horizon fill */
    ctx.fillStyle = shade(0.08);
    ctx.fillRect(0, 0, W, H);

    var prev = null;

    /* paint strips far → near (painter's algorithm) */
    for (var i = 0; i <= STRIPS; i++) {
      var z = Z_FAR - i * dz;              /* Z_FAR first → Z_NEAR last  */

      /* + sign makes the wave travel toward the viewer */
      var y = AMP * Math.sin(K * z + OMEGA * t);

      var pL = project(-X_HALF, y, z);
      var pR = project( X_HALF, y, z);

      if (prev && pL && pR) {
        /* surface normal: y(z) = AMP·sin(K·z + Ω·t)
           ∂y/∂z = AMP·K·cos(K·z + Ω·t)
           n = normalize(0, 1, −∂y/∂z)                                  */
        var midZ  = z + dz * 0.5;
        var slope = AMP * K * Math.cos(K * midZ + OMEGA * t);
        var n     = norm3({ x: 0, y: 1, z: -slope });
        var diff  = Math.max(0, dot3(n, LIGHT));
        var col   = shade(0.12 + 0.88 * diff);

        ctx.beginPath();
        ctx.moveTo(prev.L.x, prev.L.y);
        ctx.lineTo(prev.R.x, prev.R.y);
        ctx.lineTo(pR.x,     pR.y    );
        ctx.lineTo(pL.x,     pL.y    );
        ctx.closePath();
        ctx.fillStyle   = col;
        ctx.strokeStyle = col;   /* thin stroke seals any sub-pixel gap  */
        ctx.lineWidth   = 0.5;
        ctx.fill();
        ctx.stroke();
      }

      if (pL && pR) prev = { L: pL, R: pR };
    }

    requestAnimationFrame(render);
  }

  render();
}());
