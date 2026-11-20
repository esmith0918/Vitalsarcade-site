(function () {
  'use strict';
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  /* Mobile menu */
  var menuBtn = document.querySelector('.menu-btn');
  var nav = document.getElementById('site-nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
    });
  }

  /* ===== Acid-Base Arcade web demo =====
     Game rules (unchanged from the original demo):
     - 30 second run, pH starts at 7.40
     - Each ion that reaches the pH zone shifts pH by 0.06 (acid down, base up)
     - pH drifts back toward 7.40 at 12% of the gap per second
     - Run ends at pH 6.80 or 7.80; surviving 30 seconds wins
     - 10 points per ion cleared; spawn interval max(0.42, 0.9 - elapsed * 0.018) s
     - Ion speed 70 to 120 px/s plus 3 px/s per elapsed second */
  var cv = document.getElementById('game');
  if (!cv) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = document.getElementById('stage');
  var phEl = document.getElementById('phVal'), stEl = document.getElementById('status');
  var scEl = document.getElementById('score'), tEl = document.getElementById('timeVal');
  var needle = document.getElementById('needle');
  var ov = document.getElementById('overlay'), ovK = document.getElementById('ovKicker');
  var ovT = document.getElementById('ovTitle'), ovX = document.getElementById('ovText');
  var startBtn = document.getElementById('startBtn'), fullBtn = document.getElementById('fullBtn');
  var eaBtn = document.getElementById('eaBtn'), muteBtn = document.getElementById('muteBtn');
  var bestEl = document.getElementById('bestVal'), newBest = document.getElementById('newBest');
  var ZONE = 64, G, S;

  /* Saved settings (high score and mute). Storage can fail in private mode, so every call is guarded. */
  function load(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  var best = parseInt(load('aba-best', '0'), 10) || 0;
  var muted = load('aba-muted', '0') === '1';
  if (bestEl) bestEl.textContent = best;

  /* Early Access link: paste the itch.io page link into data-url on #eaBtn in index.html.
     The button stays hidden while data-url is empty. */
  var eaUrl = eaBtn ? (eaBtn.getAttribute('data-url') || '').trim() : '';
  if (eaBtn && eaUrl) eaBtn.href = eaUrl;

  /* Sound effects, made with the Web Audio API (no audio files to download) */
  var AC = null;
  function audio() {
    if (muted) return null;
    if (!AC) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; AC = new C(); }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    var a = audio(); if (!a) return;
    var t0 = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var sfx = {
    pop: function (acid) { tone(acid ? 880 : 660, 0.09, 'square', 0.06, acid ? 1320 : 990); },
    leak: function (acid) { tone(acid ? 160 : 220, 0.18, 'sawtooth', 0.07, acid ? 90 : 330); },
    start: function () { [523, 659, 784].forEach(function (f, i) { tone(f, 0.1, 'square', 0.06, 0, i * 0.08); }); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.14, 'square', 0.07, 0, i * 0.1); }); },
    lose: function () { [392, 330, 262, 196].forEach(function (f, i) { tone(f, 0.18, 'triangle', 0.09, 0, i * 0.13); }); }
  };
  function setMute(m) {
    muted = m; save('aba-muted', m ? '1' : '0');
    if (!muteBtn) return;
    muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
    muteBtn.setAttribute('aria-label', m ? 'Turn sound on' : 'Mute sound');
    muteBtn.classList.toggle('is-muted', m);
    var lb = muteBtn.querySelector('.mute-label'); if (lb) lb.textContent = m ? 'Sound off' : 'Sound on';
  }
  if (muteBtn) { setMute(muted); muteBtn.addEventListener('click', function () { setMute(!muted); if (!muted) tone(784, 0.08, 'square', 0.05); }); }

  function fit() {
    var r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
    var c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0);
    G = { c: c, w: r.width, h: r.height };
  }
  function reset() { S = { on: false, ph: 7.40, score: 0, time: 30, ions: [], fx: [], spawn: 0, last: 0 }; }

  function status(ph) {
    if (ph < 7.35) return ['ACIDOSIS', '#FF6978'];
    if (ph > 7.45) return ['ALKALOSIS', '#55C9F4'];
    return ['NORMAL', '#39F4A1'];
  }
  function hud() {
    phEl.textContent = S.ph.toFixed(2);
    var s = status(S.ph); stEl.textContent = s[0]; stEl.style.color = s[1];
    scEl.textContent = S.score;
    tEl.textContent = Math.max(0, Math.ceil(S.time));
    var pct = Math.min(100, Math.max(0, (S.ph - 6.80) / 1.0 * 100));
    needle.style.left = pct + '%';
  }
  function spawn() {
    var acid = Math.random() < 0.5, elapsed = 30 - S.time;
    S.ions.push({ acid: acid, x: G.w + 20, y: 30 + Math.random() * (G.h - 60), r: acid ? 17 : 21,
      v: 70 + Math.random() * 50 + elapsed * 3, wob: Math.random() * 6 });
  }
  function clear(i) {
    var o = S.ions[i];
    S.fx.push({ kind: 'pop', x: o.x, y: o.y, t: 0, acid: o.acid });
    S.fx.push({ kind: 'text', x: o.x, y: o.y - 10, t: 0, txt: '+10', col: '#FFD166' });
    S.ions.splice(i, 1); S.score += 10; hud(); sfx.pop(o.acid);
  }
  function hitAt(x, y) {
    for (var i = S.ions.length - 1; i >= 0; i--) {
      var o = S.ions[i];
      if (Math.hypot(o.x - x, o.y + Math.sin(o.wob) * 6 - y) < o.r + 12) { clear(i); return; }
    }
  }
  function nearest(acid) {
    if (!S.on) return;
    var best = -1, bx = 1e9;
    S.ions.forEach(function (o, i) { if (o.acid === acid && o.x < bx) { bx = o.x; best = i; } });
    if (best >= 0) clear(best);
  }
  function flash(acid) {
    if (reduce) return;
    stage.classList.remove('hit-acid', 'hit-base'); void stage.offsetWidth;
    stage.classList.add(acid ? 'hit-acid' : 'hit-base');
  }
  function end(win) {
    S.on = false; ov.hidden = false; fullBtn.hidden = false;
    if (eaBtn) eaBtn.hidden = !eaUrl;
    var isBest = S.score > best;
    if (isBest) { best = S.score; save('aba-best', String(best)); if (bestEl) bestEl.textContent = best; }
    if (newBest) newBest.hidden = !isBest;
    ov.classList.add('ended');
    if (win) sfx.win(); else sfx.lose();
    ovK.textContent = win ? 'STAGE CLEAR' : 'GAME OVER';
    var inRange = S.ph >= 7.35 && S.ph <= 7.45;
    ovT.textContent = win ? (inRange ? 'Patient stable!' : 'You survived!') : (S.ph < 7.40 ? 'Severe acidosis' : 'Severe alkalosis');
    ovX.textContent = (win
      ? (inRange ? 'You kept the pH in the normal range. '
                 : 'pH ended at ' + S.ph.toFixed(2) + ' (' + status(S.ph)[0].toLowerCase() + '). Finish between 7.35 and 7.45 for a perfect run. ')
      : 'The pH left the survivable range. ') +
      'Final score: ' + S.score + '. The full VR game adds blasters, patient charts and ABGs.';
    startBtn.textContent = 'Play again';
    startBtn.focus();
  }
  function frame(ts) {
    if (!S.on) return;
    var dt = Math.min(0.05, (ts - (S.last || ts)) / 1000); S.last = ts;
    S.time -= dt; S.spawn -= dt;
    var rate = Math.max(0.42, 0.9 - (30 - S.time) * 0.018);
    if (S.spawn <= 0) { spawn(); S.spawn = rate; }
    S.ph += (7.40 - S.ph) * 0.12 * dt;
    for (var i = S.ions.length - 1; i >= 0; i--) {
      var o = S.ions[i]; o.x -= o.v * dt; o.wob += dt * 3;
      if (o.x - o.r < ZONE) {
        S.ph += o.acid ? -0.06 : 0.06;
        S.fx.push({ kind: 'text', x: ZONE + 34, y: o.y, t: 0, txt: o.acid ? '-0.06 pH' : '+0.06 pH', col: o.acid ? '#FF6978' : '#55C9F4' });
        flash(o.acid); sfx.leak(o.acid);
        S.ions.splice(i, 1);
      }
    }
    S.fx.forEach(function (f) { f.t += dt; });
    S.fx = S.fx.filter(function (f) { return f.t < (f.kind === 'pop' ? 0.35 : 0.7); });
    hud(); draw(ts);
    if (S.ph <= 6.80 || S.ph >= 7.80) return end(false);
    if (S.time <= 0) return end(true);
    requestAnimationFrame(frame);
  }
  function draw(ts) {
    var c = G.c, w = G.w, h = G.h, t = (ts || 0) / 1000;
    c.clearRect(0, 0, w, h);
    var g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1A0A12'); g.addColorStop(0.5, '#2A0F1C'); g.addColorStop(1, '#1A0A12');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    // vessel walls
    c.fillStyle = 'rgba(255,105,120,0.10)'; c.fillRect(0, 0, w, 10); c.fillRect(0, h - 10, w, 10);
    // drifting red blood cells (decor)
    c.fillStyle = 'rgba(255,105,120,0.08)';
    for (var k = 0; k < 8; k++) {
      var bx = ((k * 150 - (reduce ? 0 : t * 40)) % (w + 150) + w + 150) % (w + 150) - 75;
      c.beginPath(); c.ellipse(bx, 30 + (k * 67) % (h - 60), 24, 11, 0.4, 0, Math.PI * 2); c.fill();
    }
    // pH zone
    var s = status(S.ph);
    c.fillStyle = 'rgba(255,209,102,0.10)'; c.fillRect(0, 0, ZONE, h);
    c.strokeStyle = s[1]; c.lineWidth = 2; c.setLineDash([6, 6]);
    c.beginPath(); c.moveTo(ZONE, 0); c.lineTo(ZONE, h); c.stroke(); c.setLineDash([]);
    c.save(); c.translate(ZONE / 2 + 5, h / 2); c.rotate(-Math.PI / 2);
    c.fillStyle = '#FFD166'; c.font = '600 13px "IBM Plex Mono", monospace'; c.textAlign = 'center';
    c.fillText('pH ZONE', 0, 0); c.restore();
    // ions
    S.ions.forEach(function (o) {
      var y = o.y + Math.sin(o.wob) * 6;
      var rg = c.createRadialGradient(o.x - o.r * 0.35, y - o.r * 0.4, o.r * 0.2, o.x, y, o.r);
      if (o.acid) { rg.addColorStop(0, '#FFC2C8'); rg.addColorStop(0.5, '#FF6978'); rg.addColorStop(1, '#A3263A'); }
      else { rg.addColorStop(0, '#C9EEFF'); rg.addColorStop(0.5, '#55C9F4'); rg.addColorStop(1, '#1D6E93'); }
      c.fillStyle = rg; c.beginPath(); c.arc(o.x, y, o.r, 0, Math.PI * 2); c.fill();
      c.fillStyle = o.acid ? '#3A0A14' : '#082A3A';
      c.font = '700 ' + (o.acid ? 13 : 11) + 'px "IBM Plex Mono", monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(o.acid ? 'H+' : 'HCO3', o.x, y + 1);
    });
    // effects
    S.fx.forEach(function (f) {
      if (f.kind === 'pop') {
        var a = 1 - f.t / 0.35;
        c.strokeStyle = f.acid ? 'rgba(255,105,120,' + a + ')' : 'rgba(85,201,244,' + a + ')';
        c.lineWidth = 3; c.beginPath(); c.arc(f.x, f.y, 18 + f.t * 80, 0, Math.PI * 2); c.stroke();
      } else {
        c.globalAlpha = 1 - f.t / 0.7; c.fillStyle = f.col;
        c.font = '700 15px "IBM Plex Mono", monospace'; c.textAlign = 'center';
        c.fillText(f.txt, f.x, f.y - f.t * 30); c.globalAlpha = 1;
      }
    });
    // timer bar
    c.fillStyle = 'rgba(241,248,250,0.12)'; c.fillRect(ZONE + 10, h - 6, w - ZONE - 20, 3);
    c.fillStyle = '#39F4A1'; c.fillRect(ZONE + 10, h - 6, (w - ZONE - 20) * Math.max(0, S.time) / 30, 3);
  }
  function start() {
    reset(); hud(); S.on = true; ov.hidden = true; fullBtn.hidden = true;
    if (eaBtn) eaBtn.hidden = true;
    if (newBest) newBest.hidden = true;
    sfx.start();
    /* On phones, bring the whole cabinet into view so the pads are on screen */
    if (window.innerWidth < 700 && stage.scrollIntoView) {
      var cab = stage.closest('.cabinet') || stage;
      cab.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
    requestAnimationFrame(function (t) { S.last = t; frame(t); });
  }

  startBtn.addEventListener('click', start);
  cv.addEventListener('pointerdown', function (e) {
    if (!S.on) return;
    var r = cv.getBoundingClientRect(); hitAt(e.clientX - r.left, e.clientY - r.top);
  });
  /* Pads fire on pointerdown so fast taps on phones register right away (click is a fallback for keyboard users) */
  ['padA', 'padB'].forEach(function (id) {
    var el = document.getElementById(id), acid = id === 'padA', fired = false;
    el.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse' && e.button !== 0) return; fired = true; setTimeout(function () { fired = false; }, 700); nearest(acid); });
    el.addEventListener('click', function () { if (fired) { fired = false; return; } nearest(acid); });
  });
  document.addEventListener('keydown', function (e) {
    if (!S.on || e.target.closest('input, textarea')) return;
    var k = e.key.toLowerCase();
    if (k === 'a') { nearest(true); e.preventDefault(); }
    if (k === 'b') { nearest(false); e.preventDefault(); }
  });
  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt); rt = setTimeout(function () { fit(); if (!S.on) draw(0); }, 120);
  });
  reset(); fit(); hud(); draw(0);
})();
