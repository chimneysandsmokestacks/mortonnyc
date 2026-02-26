/* bg.js – fabric wave background for morton.nyc (mobile-optimised) */
(function () {
  'use strict';

  /* ── canvas ───────────────────────────────────────────────────────────── */
  var canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'z-index:-1;display:block;pointer-events:none;' +
    'filter:blur(1.5px);';   /* GPU-accelerated edge smoothing – zero JS cost */
  document.body.insertBefore(canvas, document.body.firstChild);
  var ctx = canvas.getContext('2d');

  var W, H;
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  /* ── colour: base teal #113d3d – pre-computed LUT, no allocs in loop ─── */
  var BR = 17, BG = 61, BB = 61;
  var LUT = [], LUT_OFF = 64;           /* covers delta range –64 … +63      */
  for (var i = 0; i < 128; i++) {
    var d = i - LUT_OFF;
    LUT[i] = 'rgb(' +
      Math.min(255, Math.max(0, BR + d)) + ',' +
      Math.min(255, Math.max(0, BG + d)) + ',' +
      Math.min(255, Math.max(0, BB + d)) + ')';
  }
  function rgb(d) { return LUT[Math.min(127, Math.max(0, (d | 0) + LUT_OFF))]; }

  /* ── wave: 2 harmonics, slow motion ──────────────────────────────────── */
  var AMP   = 0.48;
  var OMEGA = 0.28;
  var STRIPS = 55;
  var Z_NEAR = 0.5, Z_FAR = 18.0, X_HALF = 22;

  var K0 = (2 * Math.PI) / 4.5, PH0 = 0.00, OW0 = 1.00;
  var K1 = (2 * Math.PI) / 7.5, PH1 = 3.80, OW1 = 0.62, A1 = 0.55;
  var A_NORM = 1 / (1.00 + A1);

  /* compute height + slope together (reuses trig values) */
  function wave(wz, t) {
    var e   = Math.min(1.0, Math.max(0.0, (wz - Z_NEAR) / 3.2)); /* envelope */
    var s0  = K0 * wz + OMEGA * OW0 * t + PH0;
    var s1  = K1 * wz + OMEGA * OW1 * t + PH1;
    var f   = AMP * A_NORM * e;
    return {
      y:     f * (Math.sin(s0) + A1 * Math.sin(s1)),
      slope: f * (K0 * Math.cos(s0) + A1 * K1 * Math.cos(s1))
    };
  }

  /* ── lighting: linear approx – no sqrt in the render loop ────────────── */
  /* LIGHT = norm3({-0.6, 1.0, -0.4}), FLAT_D = dot({0,1,0}, LIGHT) ≈ 0.811
     d(diff)/d(slope) ≈ 0.325 (first-order Taylor)                          */
  var FLAT_D = 0.811, D_DS = 0.325, L_SCALE = 42;
  var BG_D   = (FLAT_D * L_SCALE) | 0;   /* ≈ 34 – background brightness   */

  function ldelta(slope) {
    return ((Math.min(1, Math.max(0, FLAT_D + D_DS * slope)) - FLAT_D) * L_SCALE) | 0;
  }

  /* ── camera (unchanged) ───────────────────────────────────────────────── */
  var eye = { x: -1.2, y: 3.8, z: -1.5 }, target = { x: 0.3, y: 0.0, z: 8.0 };
  var FOCAL = 1.4;
  function n3(v) { var l=Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z); return {x:v.x/l,y:v.y/l,z:v.z/l}; }
  function cx3(a,b) { return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x}; }
  var UW={x:0,y:1,z:0};
  var FWD=n3({x:target.x-eye.x,y:target.y-eye.y,z:target.z-eye.z});
  var RT=n3(cx3(UW,FWD)), UP=cx3(FWD,RT);

  function project(wx, wy, wz) {
    var dx=wx-eye.x, dy=wy-eye.y, dz=wz-eye.z;
    var cz=dx*FWD.x+dy*FWD.y+dz*FWD.z;
    if (cz < 0.01) return null;
    var s=FOCAL*H*0.5/cz;
    return { x:(dx*RT.x+dy*RT.y+dz*RT.z)*s+W*0.5,
             y:-(dx*UP.x+dy*UP.y+dz*UP.z)*s+H*0.5 };
  }

  /* ── sun ──────────────────────────────────────────────────────────────── */
  /* drawn before the fabric so the waves sit in front of it (behind smog)  */
  function drawSun() {
    var sx = W * 0.63;
    var sy = H * 0.19;
    var r  = Math.min(W, H) * 0.075;
    var gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    gr.addColorStop(0.00, 'rgba(255, 150, 45, 0.72)'); /* solid centre      */
    gr.addColorStop(0.70, 'rgba(255, 145, 40, 0.72)'); /* holds solid to 70%*/
    gr.addColorStop(0.88, 'rgba(240, 110, 28, 0.18)'); /* sharp mist drop   */
    gr.addColorStop(1.00, 'rgba(210,  80, 15, 0)');    /* fully gone at edge*/
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 6.2832);
    ctx.fill();
  }

  /* ── render loop ──────────────────────────────────────────────────────── */
  var t0 = performance.now(), dz = (Z_FAR - Z_NEAR) / STRIPS;

  function render() {
    var t = (performance.now() - t0) * 0.001;

    ctx.fillStyle = rgb(BG_D);
    ctx.fillRect(0, 0, W, H);

    drawSun();

    var prev = null;
    for (var i = 0; i <= STRIPS; i++) {
      var z  = Z_FAR - i * dz;
      var wv = wave(z, t);
      var pL = project(-X_HALF, wv.y, z);
      var pR = project( X_HALF, wv.y, z);
      var ld = ldelta(wv.slope);

      if (prev && pL && pR) {
        ctx.fillStyle = rgb(BG_D + ld);
        ctx.beginPath();
        ctx.moveTo(prev.L.x, prev.L.y);
        ctx.lineTo(prev.R.x, prev.R.y);
        ctx.lineTo(pR.x, pR.y);
        ctx.lineTo(pL.x, pL.y);
        ctx.closePath();
        ctx.fill();
      }

      if (pL && pR) prev = { L: pL, R: pR };
    }

    requestAnimationFrame(render);
  }

  render();
}());
