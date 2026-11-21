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
     - Each run has a patient case that sets how often acid vs base spawns
     - After the run the player reads the patient's ABG and picks the diagnosis
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
  var quiz = document.getElementById('quiz'), quizAbg = document.getElementById('quizAbg');
  var quizOpts = document.getElementById('quizOpts'), quizExp = document.getElementById('quizExp');
  var legend = ov.querySelector('.legend');
  /* Optional art from Meshy renders in assets/demo/. Anything missing falls back to drawn shapes. */
  var IMG = {};
  ['lungs', 'kidneys', 'acid', 'base', 'co2', 'rbc'].forEach(function (n) {
    var im = new Image(); im.onload = function () { IMG[n] = im; if (!S || !S.on) draw(0); }; im.src = 'assets/demo/' + n + '.png';
  });
  function sprite(c, n, x, y, size) {
    var im = IMG[n]; if (!im) return false;
    var k = size / Math.max(im.width, im.height);
    c.drawImage(im, x - im.width * k / 2, y - im.height * k / 2, im.width * k, im.height * k);
    return true;
  }
  var padA = document.getElementById('padA'), padB = document.getElementById('padB');
  var ZONE = 64, G, S;

  /* Patient cases. ABG values match the VR game and check out with the Henderson-Hasselbalch equation.
     acid = share of incoming ions that are acid (the rest are base). */
  var DX = ['Metabolic acidosis', 'Metabolic alkalosis', 'Respiratory acidosis', 'Respiratory alkalosis'];
  var CASES = [
    { who: '19-year-old, type 1 diabetes',
      story: 'Missed insulin for 2 days. Fruity breath and deep, rapid breathing.',
      acid: 0.8, abg: [7.24, 24, 10], dx: 0, lung: 0.15, kid: 3, batch: 4, breath: 0.9,
      why: 'pH 7.24 is low, so it is acidosis. HCO3 10 is low too, moving the same way as pH, so it is metabolic (ROME: Metabolic Equal). Ketoacids from DKA used up the bicarbonate. You saw the lungs racing: that deep, fast Kussmaul breathing blows off CO2, which is why PaCO2 is low.' },
    { who: '68-year-old with COPD',
      story: 'Drowsy and confused. Slow, shallow breathing. SpO2 86%.',
      acid: 0.75, abg: [7.29, 58, 26], dx: 2, lung: 0.8, kid: 3, batch: 4, breath: 0.15, weakLungs: true,
      why: 'pH 7.29 is low, so it is acidosis. PaCO2 58 is high, moving opposite to pH, so it is respiratory (ROME: Respiratory Opposite). You felt it: the lungs were slow, so CO2 stayed in and turned into acid. The kidneys help, but they take hours to days.' },
    { who: '45-year-old, vomiting for 3 days',
      story: 'NG tube to suction. Muscle cramps, potassium is low.',
      acid: 0.25, abg: [7.51, 47, 36], dx: 1, lung: 0.15, kid: 2.6, batch: 6, breath: 0.2,
      why: 'pH 7.51 is high, so it is alkalosis. HCO3 36 is high too, moving the same way as pH, so it is metabolic. Losing stomach acid leaves extra bicarbonate. Only the kidneys can get rid of bicarbonate, and dehydration and low potassium make them hold on to it. The lungs breathe a little slower to keep CO2, which is why PaCO2 is slightly high.' },
    { who: '58-year-old with kidney disease',
      story: 'Missed dialysis. Swollen ankles, potassium is high.',
      acid: 0.8, abg: [7.26, 30, 13], dx: 0, lung: 0.15, kid: 5, batch: 3, breath: 0.45, weakKidneys: true,
      why: 'pH 7.26 is low, so it is acidosis. HCO3 13 is low too, moving the same way as pH, so it is metabolic. You saw the kidneys struggle: failing kidneys cannot get rid of acid or make new bicarbonate. The lungs did extra work, which is why PaCO2 is low.' }
  ];
  var caseIdx = Math.floor(Math.random() * CASES.length), CS = CASES[caseIdx], answered = true;
  function abgText(c) { return 'ABG when the patient arrived: pH ' + c.abg[0].toFixed(2) + ' | PaCO2 ' + c.abg[1] + ' | HCO3 ' + c.abg[2]; }
  function tall(on) { stage.classList.toggle('quiz-open', on); fit(); draw(0); ov.scrollTop = 0; }
  function showIntro() {
    reset(); hud(); tall(false);
    ovK.textContent = 'NEW PATIENT';
    ovT.textContent = CS.who;
    ovX.textContent = CS.story + ' Use the lungs and kidneys to keep pH in range for 30 seconds.';
    if (legend) legend.hidden = false;
    if (quiz) quiz.hidden = true;
    startBtn.textContent = 'Start'; startBtn.hidden = false;
    fullBtn.hidden = true; if (eaBtn) eaBtn.hidden = true; if (newBest) newBest.hidden = true;
  }
  function nextCase() { caseIdx = (caseIdx + 1) % CASES.length; CS = CASES[caseIdx]; }

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
  var AC = null, MASTER = null;
  function audio() {
    if (muted) return null;
    if (!AC) {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      AC = new C(); MASTER = AC.createGain(); MASTER.gain.value = 0.45; MASTER.connect(AC.destination);
    }
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
    o.connect(g); g.connect(MASTER); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function vary(f) { return f * (0.94 + Math.random() * 0.12); }
  var sfx = {
    /* Acid is a low thunk, base is a high ping, with a little pitch variation so repeats don't grate */
    pop: function (acid) {
      if (acid) { var f = vary(210); tone(f, 0.14, 'triangle', 0.16, f * 0.5); tone(vary(95), 0.1, 'sine', 0.12); }
      else { var p = vary(1400); tone(p, 0.22, 'sine', 0.07); tone(p * 2, 0.12, 'sine', 0.02); }
    },
    /* An ion slipping through: acid drags down, base zips up */
    leak: function (acid) { if (acid) tone(170, 0.2, 'triangle', 0.08, 90); else tone(700, 0.18, 'sine', 0.05, 1200); },
    /* Lub-dub heartbeat (pitched high enough to hear on phone speakers) */
    heart: function () { tone(120, 0.11, 'triangle', 0.2, 70); tone(100, 0.1, 'triangle', 0.14, 60, 0.16); },
    /* Calm chime while pH is in the normal range */
    chime: function () { tone(784, 0.6, 'sine', 0.035); tone(1175, 0.7, 'sine', 0.025, 0, 0.12); },
    start: function () { [523, 659, 784].forEach(function (f, i) { tone(f, 0.12, 'sine', 0.06, 0, i * 0.09); }); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.18, 'sine', 0.06, 0, i * 0.11); }); },
    lose: function () { [392, 330, 262, 196].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.07, 0, i * 0.14); }); },
    right: function () { tone(880, 0.15, 'sine', 0.05); tone(1320, 0.25, 'sine', 0.05, 0, 0.1); },
    wrong: function () { tone(220, 0.25, 'triangle', 0.06, 180); }
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
  function reset() { S = { on: false, ph: 7.40, score: 0, time: 30, ions: [], fx: [], spawn: 0, last: 0, hb: 0, chimeT: 5, inRange: true, lungCd: 0, kid: 0 }; }

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
    var acid = Math.random() < CS.acid, elapsed = 30 - S.time;
    S.ions.push({ acid: acid, x: G.w + 20, y: 30 + Math.random() * (G.h - 60), r: acid ? 17 : 21,
      v: 70 + Math.random() * 50 + elapsed * 3, wob: Math.random() * 6 });
  }
  /* Organs: lungs (fast, acid only, as CO2) and kidneys (slow, filter a batch of acid and base) */
  function lungPos() { return { x: ZONE / 2, y: G.h * 0.24 }; }
  function kidPos() { return { x: ZONE / 2, y: G.h * 0.76 }; }
  function kidReady() { return S.kid >= CS.kid; }
  function remove(i, organ) {
    var o = S.ions[i], p = organ === 'lungs' ? lungPos() : kidPos();
    S.fx.push({ kind: 'pop', x: o.x, y: o.y, t: 0, acid: o.acid });
    S.fx.push({ kind: organ === 'lungs' ? 'co2' : 'filt', x: o.x, y: o.y, tx: p.x, ty: p.y, t: 0, acid: o.acid });
    S.ions.splice(i, 1); S.score += 10;
  }
  function useLungs(i) {
    if (S.lungCd > 0) { note('Lungs catching their breath', lungPos()); return; }
    remove(i, 'lungs'); S.lungCd = CS.lung; hud(); sfx.pop(true);
  }
  function useKidneys(first) {
    if (!kidReady()) { note('Kidneys still filtering', kidPos()); return; }
    var order = S.ions.map(function (o, i) { return i; })
      .sort(function (a, b) { return (S.ions[a].acid - S.ions[b].acid) || (S.ions[a].x - S.ions[b].x); });
    if (first >= 0) order = [first].concat(order.filter(function (i) { return i !== first; }));
    var pick = order.slice(0, CS.batch).sort(function (a, b) { return b - a; });
    if (!pick.length) return;
    var anyBase = pick.some(function (i) { return !S.ions[i].acid; });
    pick.forEach(function (i) { remove(i, 'kidneys'); });
    S.kid = 0; hud(); sfx.pop(!anyBase);
    var k = kidPos(); S.fx.push({ kind: 'text', x: k.x + 70, y: k.y, t: 0, txt: 'Filtered x' + pick.length, col: '#FFD166' });
  }
  function note(txt, p) {
    if (S.fx.some(function (f) { return f.kind === 'text' && f.txt === txt && f.t < 0.5; })) return;
    S.fx.push({ kind: 'text', x: p.x + 90, y: p.y, t: 0, txt: txt, col: '#9CB4BD', small: true });
  }
  function hitAt(x, y) {
    for (var i = S.ions.length - 1; i >= 0; i--) {
      var o = S.ions[i];
      if (Math.hypot(o.x - x, o.y + Math.sin(o.wob) * 6 - y) < o.r + 12) {
        if (o.acid && S.lungCd <= 0) useLungs(i);
        else if (o.acid && !kidReady()) note('Lungs catching their breath', lungPos());
        else useKidneys(i);
        return;
      }
    }
  }
  function lungsPad() {
    if (!S.on) return;
    var best = -1, bx = 1e9;
    S.ions.forEach(function (o, i) { if (o.acid && o.x < bx) { bx = o.x; best = i; } });
    if (best >= 0) useLungs(best);
  }
  function kidneysPad() { if (S.on) useKidneys(-1); }
  function flash(acid) {
    if (reduce) return;
    stage.classList.remove('hit-acid', 'hit-base'); void stage.offsetWidth;
    stage.classList.add(acid ? 'hit-acid' : 'hit-base');
  }
  function end(win) {
    S.on = false; ov.hidden = false;
    var isBest = S.score > best;
    if (isBest) { best = S.score; save('aba-best', String(best)); if (bestEl) bestEl.textContent = best; }
    if (newBest) newBest.hidden = !isBest;
    ov.classList.add('ended');
    if (win) sfx.win(); else sfx.lose();
    var inRange = S.ph >= 7.35 && S.ph <= 7.45;
    ovK.textContent = win ? (inRange ? 'STAGE CLEAR' : 'TIME UP') : 'GAME OVER';
    ovT.textContent = win ? (inRange ? 'Patient stable!' : 'Still ' + (S.ph < 7.35 ? 'too acidic' : 'too alkaline'))
                          : (S.ph < 7.40 ? 'Severe acidosis' : 'Severe alkalosis');
    ovX.textContent = (win
      ? (inRange ? 'pH ended in range. ' : 'pH ended at ' + S.ph.toFixed(2) + '. Finish between 7.35 and 7.45 to stabilize. ')
      : 'Critical pH. Values this extreme are often fatal. ') + 'Score: ' + S.score + '.';
    askQuiz();
  }
  /* After each run: read the patient's ABG and pick the problem */
  function askQuiz() {
    answered = false;
    startBtn.hidden = true; fullBtn.hidden = true; if (eaBtn) eaBtn.hidden = true;
    quizAbg.textContent = abgText(CS);
    quizExp.hidden = true; quizExp.textContent = '';
    quizOpts.innerHTML = '';
    DX.forEach(function (label, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'quiz-opt'; b.textContent = label;
      b.addEventListener('click', function () { answer(i); });
      quizOpts.appendChild(b);
    });
    quiz.hidden = false; tall(true);
    var first = quizOpts.querySelector('button'); if (first) first.focus();
  }
  function answer(i) {
    if (answered) return;
    answered = true;
    var right = i === CS.dx, btns = quizOpts.querySelectorAll('button');
    btns.forEach(function (b, k) {
      b.disabled = true;
      if (k === CS.dx) b.classList.add('is-right');
      else if (k === i) b.classList.add('is-wrong');
    });
    if (right) sfx.right(); else sfx.wrong();
    quizExp.textContent = (right ? 'Correct! ' : 'Not quite. It is ' + DX[CS.dx].toLowerCase() + '. ') + CS.why;
    quizExp.hidden = false;
    startBtn.textContent = 'Next patient'; startBtn.hidden = false;
    fullBtn.hidden = false; if (eaBtn) eaBtn.hidden = !eaUrl;
    startBtn.focus();
  }
  function frame(ts) {
    if (!S.on) return;
    var dt = Math.min(0.05, (ts - (S.last || ts)) / 1000); S.last = ts;
    S.time -= dt; S.spawn -= dt;
    var rate = Math.max(0.42, 0.9 - (30 - S.time) * 0.018);
    if (S.spawn <= 0) { spawn(); S.spawn = rate; }
    S.ph += (7.40 - S.ph) * 0.12 * dt;
    S.lungCd = Math.max(0, S.lungCd - dt); S.kid = Math.min(CS.kid, S.kid + dt);
    if (padB) padB.style.setProperty('--charge', Math.round(S.kid / CS.kid * 100) + '%');
    if (padA) padA.style.setProperty('--charge', Math.round((1 - S.lungCd / Math.max(0.01, CS.lung)) * 100) + '%');
    soundscape(dt);
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
    S.fx = S.fx.filter(function (f) { return f.t < (f.kind === 'pop' ? 0.35 : f.kind === 'text' ? 0.9 : 0.75); });
    hud(); draw(ts);
    if (S.ph <= 6.80 || S.ph >= 7.80) return end(false);
    if (S.time <= 0) return end(true);
    requestAnimationFrame(frame);
  }
  /* Heartbeat speeds up the further pH leaves 7.35 to 7.45; a calm chime plays while it stays in range */
  function soundscape(dt) {
    var inR = S.ph >= 7.35 && S.ph <= 7.45;
    if (inR) {
      if (!S.inRange) { sfx.chime(); S.chimeT = 5; }
      S.chimeT -= dt; if (S.chimeT <= 0) { sfx.chime(); S.chimeT = 5; }
      S.hb = 0;
    } else {
      var d = S.ph < 7.35 ? (7.35 - S.ph) / 0.55 : (S.ph - 7.45) / 0.35;
      var bpm = 80 + 100 * Math.min(1, d);
      S.hb -= dt; if (S.hb <= 0) { sfx.heart(); S.hb = 60 / bpm; }
    }
    S.inRange = inR;
  }
  function drawOrgans(c, t) {
    var L = lungPos(), K = kidPos();
    // lungs breathe at the patient's rate; weak lungs look gray
    var br = 1 + 0.08 * Math.sin(t * Math.PI * 2 * (CS.breath || 0.3));
    var lc = CS.weakLungs ? '#8A7E86' : '#FF8FA0';
    c.save(); c.translate(L.x, L.y); c.scale(br, br);
    if (CS.weakLungs) c.globalAlpha = 0.55;
    if (sprite(c, 'lungs', 0, 2, 46)) { c.restore(); } else {
    c.fillStyle = lc;
    c.beginPath(); c.ellipse(-8, 4, 8, 14, -0.15, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(8, 4, 8, 14, 0.15, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#F1F8FA'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(0, -16); c.lineTo(0, -6); c.moveTo(0, -6); c.lineTo(-6, 0); c.moveTo(0, -6); c.lineTo(6, 0); c.stroke();
    c.restore(); }
    ring(c, L.x, L.y + 2, 22, CS.lung > 0.3 ? 1 - S.lungCd / CS.lung : 1, lc);
    // kidneys; weak kidneys look dim
    var kc = CS.weakKidneys ? '#7A5A52' : '#C8553D';
    c.globalAlpha = CS.weakKidneys ? 0.55 : 1;
    if (!sprite(c, 'kidneys', K.x, K.y, 44)) {
    c.fillStyle = kc;
    [-8, 8].forEach(function (dx) {
      c.beginPath(); c.ellipse(K.x + dx, K.y, 7, 12, dx < 0 ? 0.2 : -0.2, 0, Math.PI * 2); c.fill();
    });
    c.fillStyle = '#08151C';
    c.beginPath(); c.arc(K.x - 3, K.y, 3, 0, Math.PI * 2); c.arc(K.x + 3, K.y, 3, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    ring(c, K.x, K.y, 22, S.kid / CS.kid, kidReady() ? '#FFD166' : kc);
    c.font = '600 10px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.fillStyle = '#C9D8DD';
    c.fillText('LUNGS', L.x, L.y + 32); c.fillText('KIDNEYS', K.x, K.y + 32);
  }
  function ring(c, x, y, r, frac, col) {
    c.strokeStyle = 'rgba(241,248,250,0.12)'; c.lineWidth = 3;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = col; c.beginPath(); c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, frac))); c.stroke();
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
      if (IMG.rbc) { c.globalAlpha = 0.35; sprite(c, 'rbc', bx, 30 + (k * 67) % (h - 60), 50); c.globalAlpha = 1; }
      else { c.beginPath(); c.ellipse(bx, 30 + (k * 67) % (h - 60), 24, 11, 0.4, 0, Math.PI * 2); c.fill(); }
    }
    // pH zone
    var s = status(S.ph);
    c.fillStyle = 'rgba(255,209,102,0.10)'; c.fillRect(0, 0, ZONE, h);
    c.strokeStyle = s[1]; c.lineWidth = 2; c.setLineDash([6, 6]);
    c.beginPath(); c.moveTo(ZONE, 0); c.lineTo(ZONE, h); c.stroke(); c.setLineDash([]);
    c.save(); c.translate(ZONE / 2 + 5, h / 2); c.rotate(-Math.PI / 2);
    c.fillStyle = '#FFD166'; c.font = '600 12px "IBM Plex Mono", monospace'; c.textAlign = 'center';
    c.fillText('pH ZONE', 0, 0); c.restore();
    drawOrgans(c, t);
    // ions
    S.ions.forEach(function (o) {
      var y = o.y + Math.sin(o.wob) * 6;
      if (sprite(c, o.acid ? 'acid' : 'base', o.x, y, o.r * 2.5)) {
        c.font = '700 11px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = o.acid ? '#FFC2C8' : '#C9EEFF'; c.fillText(o.acid ? 'H+' : 'HCO3-', o.x, y + o.r + 12);
        return;
      }
      var rg = c.createRadialGradient(o.x - o.r * 0.35, y - o.r * 0.4, o.r * 0.2, o.x, y, o.r);
      if (o.acid) { rg.addColorStop(0, '#FFC2C8'); rg.addColorStop(0.5, '#FF6978'); rg.addColorStop(1, '#A3263A'); }
      else { rg.addColorStop(0, '#C9EEFF'); rg.addColorStop(0.5, '#55C9F4'); rg.addColorStop(1, '#1D6E93'); }
      c.fillStyle = rg; c.beginPath(); c.arc(o.x, y, o.r, 0, Math.PI * 2); c.fill();
      c.fillStyle = o.acid ? '#3A0A14' : '#082A3A';
      c.font = '700 ' + (o.acid ? 13 : 11) + 'px "IBM Plex Mono", monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(o.acid ? 'H+' : 'HCO3-', o.x, y + 1);
    });
    // effects
    S.fx.forEach(function (f) {
      if (f.kind === 'pop') {
        var a = 1 - f.t / 0.35;
        c.strokeStyle = f.acid ? 'rgba(255,105,120,' + a + ')' : 'rgba(85,201,244,' + a + ')';
        c.lineWidth = 3; c.beginPath(); c.arc(f.x, f.y, 18 + f.t * 80, 0, Math.PI * 2); c.stroke();
      } else if (f.kind === 'co2' || f.kind === 'filt') {
        var e = Math.min(1, f.t / 0.6), q = 1 - Math.pow(1 - e, 3);
        var x = f.x + (f.tx - f.x) * q, y = f.y + (f.ty - f.y) * q;
        c.globalAlpha = 1 - Math.max(0, (f.t - 0.6) / 0.15);
        if (f.kind === 'co2' && sprite(c, 'co2', x, y, 30)) { /* Meshy CO2 */ }
        else if (f.kind === 'co2') {
          c.fillStyle = '#B8C2C6'; c.beginPath(); c.arc(x, y, 12, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#26343A'; c.font = '700 10px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText('CO2', x, y + 1);
        } else {
          c.fillStyle = f.acid ? '#FF6978' : '#55C9F4'; c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill();
          c.fillStyle = 'rgba(255,209,102,0.6)'; c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill();
        }
        c.globalAlpha = 1;
      } else {
        c.globalAlpha = 1 - f.t / 0.9; c.fillStyle = f.col;
        c.font = '700 ' + (f.small ? 12 : 15) + 'px "IBM Plex Mono", monospace'; c.textAlign = 'center';
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
    if (quiz) quiz.hidden = true;
    sfx.start();
    /* On phones, bring the whole cabinet into view so the pads are on screen */
    if (window.innerWidth < 700 && stage.scrollIntoView) {
      var cab = stage.closest('.cabinet') || stage;
      cab.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
    requestAnimationFrame(function (t) { S.last = t; frame(t); });
  }

  startBtn.addEventListener('click', function () {
    if (answered && ov.classList.contains('ended')) { nextCase(); ov.classList.remove('ended'); showIntro(); return; }
    start();
  });
  cv.addEventListener('pointerdown', function (e) {
    if (!S.on) return;
    var r = cv.getBoundingClientRect(); hitAt(e.clientX - r.left, e.clientY - r.top);
  });
  /* Pads fire on pointerdown so fast taps on phones register right away (click is a fallback for keyboard users) */
  [[padA, lungsPad], [padB, kidneysPad]].forEach(function (pair) {
    var el = pair[0], act = pair[1], fired = false;
    el.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse' && e.button !== 0) return; fired = true; setTimeout(function () { fired = false; }, 700); act(); });
    el.addEventListener('click', function () { if (fired) { fired = false; return; } act(); });
  });
  document.addEventListener('keydown', function (e) {
    if (!S.on || e.target.closest('input, textarea')) return;
    var k = e.key.toLowerCase();
    if (k === 'a') { lungsPad(); e.preventDefault(); }
    if (k === 'b') { kidneysPad(); e.preventDefault(); }
  });
  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt); rt = setTimeout(function () { fit(); if (!S.on) draw(0); }, 120);
  });
  reset(); fit(); hud(); draw(0); showIntro();
})();
