/* bg.js – fabric wave background for morton.nyc (mobile-optimised) */
(function () {
  'use strict';

  /* base URL of this script file – works whether loaded from root or /nyc/ */
  var _base = (document.currentScript || {src: ''}).src.replace(/[^/]*$/, '');

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
  var Z_NEAR = 0.5, Z_FAR = 18.0, X_L = 24, X_R = 36; /* asymmetric: camera is left-offset */
  var dz = (Z_FAR - Z_NEAR) / STRIPS;

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
  /* LIGHT = norm3({0.5, 1.0, 0.4}) ≈ {0.421, 0.842, 0.337}               */
  /* matches sun position: upper-right, ahead in the scene                  */
  /* FLAT_D = LIGHT.y ≈ 0.842  |  D_DS = -LIGHT.z ≈ -0.337 (negative:     */
  /* forward sun brightens wave fronts, not backs)                           */
  var FLAT_D = 0.842, D_DS = -0.337, L_SCALE = 42;
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
    gr.addColorStop(0.00, 'rgba(255, 192, 129, 0.9)'); /* solid centre      */
    gr.addColorStop(0.60, 'rgba(255, 192, 129, 0.9)'); /* solid centre      */
   // gr.addColorStop(0.00, 'rgba(255, 150, 45, 0.72)'); /* solid centre      */
    gr.addColorStop(0.70, 'rgba(255, 145, 40, 0.72)'); /* holds solid to 70%*/
    gr.addColorStop(0.88, 'rgba(240, 110, 28, 0.24)'); /* sharp mist drop   */
    gr.addColorStop(1.00, 'rgba(210,  80, 15, 0)');    /* fully gone at edge*/
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 6.2832);
    ctx.fill();
  }

  /* ── rubber ducks ─────────────────────────────────────────────────────── */
  var _rs = Date.now() & 0xffffffff;
  function rng() { _rs = (_rs * 1664525 + 1013904223) >>> 0; return _rs / 4294967296; }

  /* 6 duck varieties (no duck-d)                                            */
  var DUCK_NAMES = ['duck-a','duck-b','duck-d','duck-e','duck-f','duck-g'];
  var DUCK_IMGS  = [];
  for (var ii = 0; ii < DUCK_NAMES.length; ii++) {
    var im = new Image();
    im.src = _base + DUCK_NAMES[ii] + '.png';
    DUCK_IMGS.push(im);
  }

  /* sparse layout: small tight clusters (2-5) + occasional singles          */
  var CLUSTERS = [
    /* near – close to viewer */
    { cx:  1.0, cz:  1.8, r: 0.4, n: 2 },   /* very close centre            */
    { cx: -3.0, cz:  2.2, r: 0,   n: 1 },   /* single, close left           */
    { cx:  3.5, cz:  2.5, r: 0.5, n: 3 },   /* close right cluster          */
    { cx: -6.0, cz:  2.8, r: 0,   n: 1 },   /* single, far left near        */
    { cx:  0.0, cz:  3.0, r: 0,   n: 1 },   /* single, close centre         */
    { cx:  4.5, cz:  3.2, r: 0.4, n: 2 },
    { cx: -4.5, cz:  3.6, r: 0.5, n: 2 },   /* left cluster                 */
    { cx:  2.0, cz:  3.8, r: 0,   n: 1 },   /* single                       */
    { cx: -1.0, cz:  4.0, r: 0,   n: 1 },   /* single, centre near          */
    { cx:  6.5, cz:  4.2, r: 0.4, n: 2 },   /* right cluster                */
    { cx: -2.5, cz:  4.8, r: 0.5, n: 3 },   /* centre-left cluster          */
    { cx:  8.0, cz:  4.5, r: 0,   n: 1 },   /* single, far right near       */

    /* mid-distance, spread wide */
    { cx: -9.5, cz:  5.5, r: 0,   n: 1 },   /* single, hard left            */
    { cx:  0.5, cz:  5.0, r: 0,   n: 1 },   /* single                       */
    { cx: -2.5, cz:  6.2, r: 0.6, n: 3 },
    { cx:  9.0, cz:  6.5, r: 0.5, n: 2 },   /* right cluster                */
    { cx:  4.0, cz:  6.8, r: 0,   n: 1 },   /* single                       */
    { cx: -8.0, cz:  7.8, r: 0.5, n: 2 },   /* left cluster                 */
    { cx:-13.0, cz:  7.5, r: 0,   n: 1 },   /* single, far left             */
    { cx: -0.5, cz:  8.0, r: 0.7, n: 4 },
    { cx:  7.0, cz:  8.8, r: 0,   n: 1 },   /* single, right                */
    { cx: 14.0, cz:  8.5, r: 0.5, n: 2 },   /* far right cluster            */
    { cx:  3.5, cz:  9.2, r: 0,   n: 1 },   /* single                       */
    { cx: -4.5, cz:  9.8, r: 0.5, n: 2 },
    { cx:-10.5, cz: 10.5, r: 0,   n: 1 },   /* single, hard left            */
    { cx: 13.0, cz: 10.2, r: 0,   n: 1 },   /* single, far right            */
    { cx: -15.0,cz: 10.8, r: 0.6, n: 3 },   /* far left cluster             */
    { cx:  1.5, cz: 11.0, r: 0.8, n: 5 },
    { cx: 10.0, cz: 11.5, r: 0.6, n: 3 },   /* right cluster                */
    { cx: -2.0, cz: 12.0, r: 0,   n: 1 },   /* single                       */
    { cx:  5.5, cz: 12.5, r: 0.6, n: 3 },
    { cx: -8.5, cz: 12.8, r: 0,   n: 1 },   /* single, left                 */
    { cx: 16.0, cz: 12.2, r: 0,   n: 1 },   /* single, far right            */
    { cx:-14.5, cz: 13.0, r: 0.5, n: 2 },   /* far left cluster             */
    { cx: -1.0, cz: 13.8, r: 0.5, n: 2 },
    { cx:  8.5, cz: 14.0, r: 0.5, n: 2 },   /* right cluster                */
    { cx: 15.0, cz: 14.2, r: 0.6, n: 3 },   /* far right cluster            */
    { cx:  2.5, cz: 14.5, r: 0,   n: 1 },   /* single                       */
    { cx: -4.0, cz: 15.5, r: 0.7, n: 4 },
    { cx:-13.5, cz: 15.0, r: 0,   n: 1 },   /* single, far left             */
    { cx: 13.0, cz: 15.8, r: 0.5, n: 2 },   /* far right cluster            */

    /* far – distant horizon */
    { cx:-16.0, cz: 16.0, r: 0.6, n: 3 },   /* far left cluster             */
    { cx: -7.0, cz: 16.2, r: 0,   n: 1 },   /* single                       */
    { cx:  3.0, cz: 16.5, r: 0.6, n: 3 },
    { cx: 17.0, cz: 16.3, r: 0,   n: 1 },   /* single, far right            */
    { cx:-12.0, cz: 17.0, r: 0,   n: 1 },   /* single, far left             */
    { cx: -1.5, cz: 17.0, r: 0,   n: 1 },   /* single                       */
    { cx:  7.5, cz: 17.3, r: 0.5, n: 2 },
    { cx: 15.5, cz: 17.2, r: 0.6, n: 3 },   /* far right cluster            */
  ];

  var DUCKS = [];
  for (var ci = 0; ci < CLUSTERS.length; ci++) {
    var cl = CLUSTERS[ci];
    for (var di = 0; di < cl.n; di++) {
      var ang = rng() * 6.2832;
      var rad = cl.r > 0 ? Math.sqrt(rng()) * cl.r : 0;
      DUCKS.push({
        wx:   cl.cx + Math.cos(ang) * rad,
        wz:   cl.cz + Math.sin(ang) * rad,
        img:  Math.floor(rng() * DUCK_NAMES.length),
        flip: rng() > 0.5                  /* face left ~half the time        */
      });
    }
  }
  DUCKS.sort(function(a, b) { return b.wz - a.wz; });

  /* bin ducks into wave strips for painter's-algorithm occlusion.
     Near ducks (wz < 4.5) are exempt: dynamic wave crests can move between
     camera and a near duck mid-animation, causing jarring pop-behind.
     Drawing them last keeps them always visible in the foreground.        */
  var STRIP_DUCKS = [], NEAR_DUCKS = [];
  for (var ki = 0; ki <= STRIPS; ki++) STRIP_DUCKS.push([]);
  for (var ki = 0; ki < DUCKS.length; ki++) {
    var dk = DUCKS[ki];
    if (dk.wz < 4.5) { NEAR_DUCKS.push(dk); continue; }
    var si = Math.max(1, Math.min(STRIPS, Math.ceil((Z_FAR - dk.wz) / dz)));
    STRIP_DUCKS[si].push(dk);
  }

  var DUCK_SZ = 0.38;

  function drawOneDuck(dk, t) {
    var img = DUCK_IMGS[dk.img];
    if (!img.complete || !img.naturalWidth) return;
    var wv  = wave(dk.wz, t);
    var wy  = wv.y + 0.06;
    var p   = project(dk.wx, wy, dk.wz);
    if (!p) return;
    var ddx = dk.wx - eye.x, ddy = wy - eye.y, ddz = dk.wz - eye.z;
    var cz  = ddx * FWD.x + ddy * FWD.y + ddz * FWD.z;
    if (cz < 0.01) return;
    var sz = Math.max(4, DUCK_SZ * FOCAL * H * 0.5 / cz * (cz > 5.0 ? Math.pow(5.0 / cz, 0.3) : 1.0));
    var w  = sz * img.naturalWidth / img.naturalHeight;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(wv.slope * 0.45);
    if (dk.flip) ctx.scale(-1, 1);       /* mirror horizontally             */
    ctx.drawImage(img, -w * 0.5, -sz * 0.5, w, sz);
    ctx.restore();
  }

  /* ── render loop ──────────────────────────────────────────────────────── */
  var t0 = performance.now();

  function render() {
    var t = (performance.now() - t0) * 0.001;

    ctx.fillStyle = rgb(BG_D);
    ctx.fillRect(0, 0, W, H);

    drawSun();

    var prev = null;
    for (var i = 0; i <= STRIPS; i++) {
      var z  = Z_FAR - i * dz;
      var wv = wave(z, t);
      var pL = project(-X_L, wv.y, z);
      var pR = project( X_R, wv.y, z);
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

      /* draw ducks in this depth slice – nearer strips will paint over them  */
      var sd = STRIP_DUCKS[i];
      for (var j = 0; j < sd.length; j++) drawOneDuck(sd[j], t);
    }

    /* near ducks always on top – exempt from wave occlusion                 */
    for (var j = 0; j < NEAR_DUCKS.length; j++) drawOneDuck(NEAR_DUCKS[j], t);

    requestAnimationFrame(render);
  }

  render();
}());
