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
     - Ion speed 70 to 120 px/s plus 3 px/s per elapsed second
     ABG panel (ABA-BAB, ATI ranges: pH 7.35-7.45, PaCO2 35-45, HCO3 22-26):
     - pH = 7.40 + m - r, where HCO3 = 24 x 10^m and PaCO2 = 40 x 10^r.
       This is Henderson-Hasselbalch (pH = 6.1 + log(HCO3 / (0.03 x PaCO2))) centered on 24 and 40,
       so every ion still moves pH by exactly 0.06 and the balance above is unchanged.
     - Acid that slips through uses up HCO3 (metabolic cases) or stays as CO2 (respiratory cases).
       Base that slips through raises HCO3.
     - The pH drift back toward 7.40 is compensation by the OTHER organ:
       metabolic problem -> lungs change PaCO2; respiratory problem -> kidneys change HCO3.
       (Real kidney compensation takes hours to days; the game compresses it into seconds.) */
  var cv = document.getElementById('game');
  if (!cv) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = document.getElementById('stage');
  var phEl = document.getElementById('phVal'), stEl = document.getElementById('status');
  var scEl = document.getElementById('score'), tEl = document.getElementById('timeVal');
  var abgChartEl = document.getElementById('abgChart'), abgRead = document.getElementById('abgRead');
  var quizChartEl = document.getElementById('quizChart'), quizStep = document.getElementById('quizStep'), quizQ = document.getElementById('quizQ');
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
      why: 'pH 7.24 is on the A side: acidosis. HCO3 10 is below 22, also on its A side, so HCO3 matches pH: metabolic. PaCO2 24 is below 35, on its B side, so the lungs are fighting back: partially compensated. Ketoacids from DKA used up the bicarbonate, and the deep, fast Kussmaul breathing you saw blew off CO2.' },
    { who: '68-year-old with COPD',
      story: 'Drowsy and confused. Slow, shallow breathing. SpO2 86%.',
      acid: 0.75, abg: [7.29, 58, 26], dx: 2, lung: 0.8, kid: 3, batch: 4, breath: 0.15, weakLungs: true, resp: true,
      why: 'pH 7.29 is on the A side: acidosis. PaCO2 58 is above 45, on its A side, so PaCO2 matches pH: respiratory. HCO3 26 is still inside 22 to 26, so the kidneys have not caught up yet: uncompensated. The slow, weak lungs kept CO2 in, and CO2 turns into acid. The kidneys can raise HCO3, but in real life that takes hours to days.' },
    { who: '45-year-old, vomiting for 3 days',
      story: 'NG tube to suction. Muscle cramps, potassium is low.',
      acid: 0.25, abg: [7.51, 47, 36], dx: 1, lung: 0.15, kid: 2.6, batch: 6, breath: 0.2,
      why: 'pH 7.51 is on the B side: alkalosis. HCO3 36 is above 26, on its B side, so HCO3 matches pH: metabolic. PaCO2 47 is above 45, on its A side, so the lungs are fighting back by breathing slower to hold CO2: partially compensated. Losing stomach acid left extra bicarbonate, and low potassium and dehydration make the kidneys hold on to it.' },
    { who: '58-year-old with kidney disease',
      story: 'Missed dialysis. Swollen ankles, potassium is high.',
      acid: 0.8, abg: [7.26, 30, 13], dx: 0, lung: 0.15, kid: 5, batch: 3, breath: 0.45, weakKidneys: true,
      why: 'pH 7.26 is on the A side: acidosis. HCO3 13 is below 22, on its A side, so HCO3 matches pH: metabolic. PaCO2 30 is below 35, on its B side, so the lungs are fighting back: partially compensated. Failing kidneys cannot get rid of acid or make new bicarbonate, so the lungs did the extra work you saw.' }
  ];
  /* ===== ABA-BAB =====
     Each row has a low side, a normal zone and a high side. Reading the letters down the low side gives A-B-A,
     down the high side B-A-B. PaCO2 is flipped because more CO2 means more acid. */
  var ROWS = [
    { k: 'ph', name: 'pH', lo: 7.35, hi: 7.45, mid: 7.40, min: 6.80, max: 7.80, L: 'A', R: 'B', dp: 2 },
    { k: 'co2', name: 'PaCO2', lo: 35, hi: 45, mid: 40, min: 15, max: 80, L: 'B', R: 'A', dp: 0 },
    { k: 'hco3', name: 'HCO3', lo: 22, hi: 26, mid: 24, min: 6, max: 50, L: 'A', R: 'B', dp: 0 }
  ];
  /* Normal zone fills the middle 40-60% of each bar; each side scales on its own so the zone stays centered */
  function pct(R, v) {
    if (v < R.lo) return Math.max(0, (v - R.min) / (R.lo - R.min) * 40);
    if (v > R.hi) return Math.min(100, 60 + (v - R.hi) / (R.max - R.hi) * 40);
    return 40 + (v - R.lo) / (R.hi - R.lo) * 20;
  }
  function side(R, v) { return v < R.lo ? R.L : v > R.hi ? R.R : 'N'; }
  /* Classify an ABG with ABA-BAB. Values are the rounded numbers the player sees. */
  function classify(ph, co2, hco3) {
    var sp = side(ROWS[0], ph), sc = side(ROWS[1], co2), sh = side(ROWS[2], hco3);
    var out = { sides: { ph: sp, co2: sc, hco3: sh }, match: null, cause: '', kind: '', comp: '', label: '' };
    var letter = sp;
    if (sp === 'N') {
      if (sc === 'N' && sh === 'N') { out.label = 'Normal'; return out; }
      if (ph === 7.40) { out.label = 'pH 7.40, right on the center line'; return out; }
      letter = ph < 7.40 ? 'A' : 'B'; /* full compensation: the side of 7.40 tells you the original problem */
    }
    var mc = sc === letter, mh = sh === letter;
    if (mc && mh) { out.match = 'both'; out.label = 'Combined respiratory and metabolic ' + (letter === 'A' ? 'acidosis' : 'alkalosis'); return out; }
    if (!mc && !mh) { out.label = 'Not a clear pattern yet'; return out; }
    out.match = mc ? 'co2' : 'hco3';
    out.cause = mc ? 'Respiratory' : 'Metabolic';
    out.kind = letter === 'A' ? 'acidosis' : 'alkalosis';
    var other = mc ? sh : sc;
    out.comp = sp === 'N' ? 'Fully compensated' : other === 'N' ? 'Uncompensated' : 'Partially compensated';
    out.label = out.comp + ' ' + out.cause.toLowerCase() + ' ' + out.kind;
    return out;
  }
  function makeChart(el) {
    if (!el) return null;
    var rows = {};
    ROWS.forEach(function (R) {
      var row = document.createElement('div'); row.className = 'abg-row';
      var lc = R.L === 'A' ? 'var(--acid)' : 'var(--base)', rc = R.R === 'A' ? 'var(--acid)' : 'var(--base)';
      row.innerHTML = '<span class="abg-name">' + R.name + '</span>' +
        '<span class="abg-l abg-' + R.L.toLowerCase() + '">' + R.L + '</span>' +
        '<div class="abg-bar" style="--lc:' + lc + ';--rc:' + rc + '"><div class="abg-norm"></div><div class="abg-mid"></div><div class="abg-mark"></div><span class="abg-tag"></span></div>' +
        '<span class="abg-r abg-' + R.R.toLowerCase() + '">' + R.R + '</span>' +
        '<span class="abg-val"></span>';
      el.appendChild(row);
      rows[R.k] = { el: row, mark: row.querySelector('.abg-mark'), val: row.querySelector('.abg-val'),
        l: row.querySelector('.abg-l'), r: row.querySelector('.abg-r'), tag: row.querySelector('.abg-tag'), timer: 0 };
    });
    return {
      rows: rows,
      set: function (v) { /* v = { ph, co2, hco3 } as displayed (rounded) numbers */
        ROWS.forEach(function (R) {
          var o = rows[R.k], x = v[R.k];
          o.mark.style.left = pct(R, x) + '%';
          o.val.textContent = x.toFixed(R.dp);
          o.l.classList.toggle('on', x < R.lo); o.r.classList.toggle('on', x > R.hi);
        });
      },
      flash: function (k, txt, col) {
        var o = rows[k]; if (!o) return;
        o.tag.textContent = txt; o.tag.style.color = col || 'var(--highlight)';
        o.el.classList.add('pulse'); clearTimeout(o.timer);
        o.timer = setTimeout(function () { o.el.classList.remove('pulse'); }, 650);
      },
      match: function (k) { ROWS.forEach(function (R) { rows[R.k].el.classList.toggle('match', k === R.k || (k === 'both' && R.k !== 'ph')); }); }
    };
  }
  var LIVE = makeChart(abgChartEl), QCH = makeChart(quizChartEl);
  /* Live blood values from the two levers: m (metabolic, kidneys) and r (respiratory, lungs) */
  function liveVals() {
    return { ph: Math.round(S.ph * 100) / 100, co2: Math.round(40 * Math.pow(10, S.r)), hco3: Math.round(24 * Math.pow(10, S.m)) };
  }
  /* How far compensation can push each value. Breathing can drop PaCO2 to about 15, but slowing breathing
     only raises it to about 55 before low oxygen stops it. Kidneys can move HCO3 to about 6 or 50. */
  var LIM = { rLo: Math.log10(15 / 40), rHi: Math.log10(55 / 40), mLo: Math.log10(6 / 24), mHi: Math.log10(50 / 24) };
  /* Move v by d but never past a limit (and never snap back if v is already past it) */
  function step(v, d, lo, hi) {
    var n = v + d;
    if (d > 0 && n > hi) n = Math.max(v, hi);
    if (d < 0 && n < lo) n = Math.min(v, lo);
    return n;
  }
  /* Compensation: move pH back toward 7.40 by d using the organ that is NOT the problem.
     If that organ is at its limit, the rest goes to the other one, so total drift matches the original game. */
  function compensate(d) {
    if (CS.resp) {
      var m2 = step(S.m, d, LIM.mLo, LIM.mHi), left = d - (m2 - S.m); S.m = m2;
      if (left) S.r = step(S.r, -left, LIM.rLo, LIM.rHi);
    } else {
      var r2 = step(S.r, -d, LIM.rLo, LIM.rHi), rest = d + (r2 - S.r); S.r = r2;
      if (rest) S.m = step(S.m, rest, LIM.mLo, LIM.mHi);
    }
    S.ph = 7.40 + S.m - S.r;
  }
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
  function reset() { S = { on: false, ph: 7.40, m: 0, r: 0, score: 0, time: 30, ions: [], fx: [], spawn: 0, last: 0, hb: 0, chimeT: 5, inRange: true, lungCd: 0, kid: 0 }; }

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
    var v = liveVals();
    if (LIVE) LIVE.set(v);
    if (abgRead) {
      var c = classify(v.ph, v.co2, v.hco3);
      var txt = 'ABA-BAB read: ' + c.label;
      if (abgRead.textContent !== txt) abgRead.textContent = txt;
    }
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
    if (LIVE) LIVE.flash('co2', 'CO2 breathed off', '#39F4A1');
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
    if (LIVE) LIVE.flash('hco3', 'Kidneys filtered', '#FFD166');
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
  /* After each run: read the patient's arrival ABG with ABA-BAB in three steps:
     1. which value matches the pH, 2. the problem, 3. how compensated it is. */
  var COMP = ['Uncompensated', 'Partially compensated', 'Fully compensated'];
  var Q = null;
  function askQuiz() {
    answered = false;
    startBtn.hidden = true; fullBtn.hidden = true; if (eaBtn) eaBtn.hidden = true;
    quizAbg.textContent = abgText(CS);
    var c = classify(CS.abg[0], CS.abg[1], CS.abg[2]);
    if (QCH) { QCH.set({ ph: CS.abg[0], co2: CS.abg[1], hco3: CS.abg[2] }); QCH.match(null); }
    var R = { co2: ROWS[1], hco3: ROWS[2] }, pl = c.sides.ph;
    function sideWord(L) { return L === 'A' ? 'A side' : 'B side'; }
    var mk = c.match, mv = mk === 'co2' ? CS.abg[1] : CS.abg[2], mn = mk === 'co2' ? 'PaCO2' : 'HCO3';
    var ok = mk === 'co2' || mk === 'hco3';
    Q = { i: 0, right: 0, steps: [] };
    if (ok) Q.steps.push({
      q: 'Which value matches the pH?', opts: ['PaCO2', 'HCO3'], ans: mk === 'co2' ? 0 : 1, cls: 'two', keepCase: true,
      fb: 'pH ' + CS.abg[0].toFixed(2) + ' is on the ' + sideWord(pl) + '. ' + mn + ' ' + mv + ' is on its ' + sideWord(c.sides[mk]) +
          ' too, so ' + mn + ' matches: ' + c.cause.toLowerCase() + '.',
      after: function () { if (QCH) QCH.match(mk); }
    });
    Q.steps.push({ q: "What is this patient's problem?", opts: DX, ans: CS.dx, cls: '',
      fb: ok ? 'pH on the ' + sideWord(pl === 'N' ? (CS.abg[0] < 7.40 ? 'A' : 'B') : pl) + ' means ' + c.kind + ', and ' + mn + ' matching makes it ' + c.cause.toLowerCase() + '.' : '' });
    if (ok) Q.steps.push({
      q: 'How compensated is it?', opts: COMP, ans: COMP.indexOf(c.comp), cls: 'three',
      fb: c.comp === 'Uncompensated' ? 'The other value is still in its normal zone, so nothing is fighting back yet.'
        : c.comp === 'Partially compensated' ? 'The other value has left its normal zone to fight back, but pH is still out of range.'
        : 'Both values are out of range but pH made it back into 7.35 to 7.45.'
    });
    quizExp.hidden = true; quizExp.textContent = '';
    quiz.hidden = false; tall(true);
    showStep();
  }
  function showStep() {
    var st = Q.steps[Q.i];
    if (quizStep) quizStep.textContent = 'ABA-BAB · STEP ' + (Q.i + 1) + ' OF ' + Q.steps.length;
    if (quizQ) quizQ.textContent = st.q;
    quizOpts.className = 'quiz-opts' + (st.cls ? ' ' + st.cls : '');
    quizOpts.innerHTML = '';
    st.opts.forEach(function (label, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'quiz-opt'; b.textContent = label;
      b.addEventListener('click', function () { answer(i); });
      quizOpts.appendChild(b);
    });
    var first = quizOpts.querySelector('button'); if (first) first.focus();
  }
  function answer(i) {
    if (answered) return;
    var st = Q.steps[Q.i];
    if (st.done) return; st.done = true;
    var right = i === st.ans, btns = quizOpts.querySelectorAll('.quiz-opt');
    btns.forEach(function (b, k) {
      b.disabled = true;
      if (k === st.ans) b.classList.add('is-right');
      else if (k === i) b.classList.add('is-wrong');
    });
    if (right) { sfx.right(); Q.right++; } else sfx.wrong();
    if (st.after) st.after();
    var last = Q.i === Q.steps.length - 1;
    var want = st.keepCase ? st.opts[st.ans] : st.opts[st.ans].toLowerCase();
    var lead = right ? 'Correct! ' : 'Not quite. It is ' + want + '. ';
    quizExp.textContent = lead + (last ? CS.why + ' You read ' + Q.right + ' of ' + Q.steps.length + ' steps right.' : st.fb);
    quizExp.hidden = false;
    if (last) {
      answered = true;
      startBtn.textContent = 'Next patient'; startBtn.hidden = false;
      fullBtn.hidden = false; if (eaBtn) eaBtn.hidden = !eaUrl;
      startBtn.focus();
      return;
    }
    var nx = document.createElement('button');
    nx.type = 'button'; nx.className = 'btn btn-yellow quiz-next'; nx.textContent = 'Next step';
    nx.addEventListener('click', function () { Q.i++; quizExp.hidden = true; showStep(); });
    quizOpts.appendChild(nx); nx.focus();
  }
  function frame(ts) {
    if (!S.on) return;
    var dt = Math.min(0.05, (ts - (S.last || ts)) / 1000); S.last = ts;
    S.time -= dt; S.spawn -= dt;
    var rate = Math.max(0.42, 0.9 - (30 - S.time) * 0.018);
    if (S.spawn <= 0) { spawn(); S.spawn = rate; }
    compensate((7.40 - S.ph) * 0.12 * dt);
    S.lungCd = Math.max(0, S.lungCd - dt); S.kid = Math.min(CS.kid, S.kid + dt);
    if (padB) padB.style.setProperty('--charge', Math.round(S.kid / CS.kid * 100) + '%');
    if (padA) padA.style.setProperty('--charge', Math.round((1 - S.lungCd / Math.max(0.01, CS.lung)) * 100) + '%');
    soundscape(dt);
    for (var i = S.ions.length - 1; i >= 0; i--) {
      var o = S.ions[i]; o.x -= o.v * dt; o.wob += dt * 3;
      if (o.x - o.r < ZONE) {
        if (o.acid && CS.resp) { S.r += 0.06; if (LIVE) LIVE.flash('co2', 'CO2 retained', '#FF6978'); }
        else if (o.acid) { S.m -= 0.06; if (LIVE) LIVE.flash('hco3', 'HCO3 used up', '#FF6978'); }
        else { S.m += 0.06; if (LIVE) LIVE.flash('hco3', 'HCO3 added', '#55C9F4'); }
        S.ph = 7.40 + S.m - S.r;
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
