/* ProtoTwin 3D — modèle de carte, import CSV/Netlist, solveur nodal temps réel, thermique, émulateur MCU */
(function (global) {
  'use strict';
  const PT = global.ProtoTwin = global.ProtoTwin || {};
  const seq = (n) => Array.from({ length: n }, (_, i) => String(i + 1));

  // Boîtiers : broches, résistance thermique RθJA (°C/W), puissance max (W), hauteur (mm)
  const PKG = {
    '0603':    { pins: ['1', '2'], rth: 250, pmax: 0.10, h: 0.45 },
    '0805':    { pins: ['1', '2'], rth: 200, pmax: 0.125, h: 0.55 },
    'LED0805': { pins: ['1', '2'], rth: 220, pmax: 0.12, h: 0.8 },
    'LQFP32':  { pins: seq(32), rth: 60, pmax: 0.6, h: 1.6 },
    'SOIC8':   { pins: seq(8), rth: 120, pmax: 0.4, h: 1.75 },
    'SOT23':   { pins: ['1', '2', '3'], rth: 250, pmax: 0.3, h: 1.1 },
    'TO252':   { pins: ['1', '2', '3'], rth: 50, pmax: 1.5, h: 2.3 },
    'TACT6':   { pins: ['1', '2', '3', '4'], rth: 40, pmax: 5, h: 4.8 },
    'POT':     { pins: ['1', '2', '3'], rth: 100, pmax: 0.25, h: 5.3 },
    'USBC':    { pins: ['VBUS', 'GND', 'SH'], rth: 30, pmax: 5, h: 3.2 },
    'TERM2':   { pins: ['1', '2'], rth: 30, pmax: 5, h: 10 },
    'ELEC':    { pins: ['1', '2'], rth: 60, pmax: 1, h: 7.7 },
    'TP':      { pins: ['1'], rth: 30, pmax: 5, h: 0.1 },
    'BOX':     { pins: ['1', '2'], rth: 80, pmax: 1, h: 1.5 }
  };
  const GND_RE = /^(GND|AGND|DGND|PGND|VSS|0|GNDREF)$/i;
  const RS_PSU = 0.05;

  function parseValue(s, dflt) {
    if (typeof s === 'number') return s;
    const m = /^\s*([0-9]*\.?[0-9]+)\s*([pnuµmkKMRrGg]?)\s*([0-9]*)/.exec(String(s || ''));
    if (!m) return dflt;
    const mult = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, R: 1, r: 1, G: 1e9, g: 1e9, '': 1 }[m[2]];
    const v = m[3] && m[2] ? parseFloat(m[1] + '.' + m[3]) : parseFloat(m[1]);   // notation 4k7
    return v * mult;
  }

  // ------------------------------------------------------------------ Carte de démonstration
  function demoBoard() {
    const c = (ref, kind, pkg, value, x, y, rot, pins, params) =>
      ({ ref, kind, pkg, value, x, y, rot: rot || 0, side: 'top', pins, params: params || {} });
    const board = {
      name: 'ProtoTwin DEMO — Rev A', width: 80, height: 50, demo: true, supplyNet: 'VBUS', bridges: [],
      components: [
        c('J1', 'CONN', 'USBC', 'USB-C', -36.6, 8, 0, { VBUS: 'VBUS', GND: 'GND', SH: 'GND' }),
        c('J2', 'CONN', 'TERM2', 'Bornier 5 mm', -34.4, -10, 0, { 1: 'VBUS', 2: 'GND' }),
        c('C1', 'CPOL', 'ELEC', '100u', -24, 8, 0, { 1: 'VBUS', 2: 'GND' }),
        c('U2', 'LDO', 'TO252', 'LDO 3V3', -21, -8, 0, { 1: 'GND', 2: '3V3', 3: 'VBUS' }, { vout: 3.3, dropout: 0.3, ilim: 0.8 }),
        c('C2', 'C', '0805', '10u', -11, -4, 90, { 1: '3V3', 2: 'GND' }),
        c('C3', 'C', '0603', '100n', -3, 8.5, 0, { 1: '3V3', 2: 'GND' }),
        c('U1', 'MCU', 'LQFP32', 'PT32F030', 4, 0, 0,
          { 1: '3V3', 2: 'ADC', 3: 'BTN', 4: 'GND', 5: 'PWM', 6: 'STATUS', 7: 'NRST', 8: 'GND', 16: 'GND', 17: '3V3', 32: 'GND' },
          { gpio: { PA0: '2', PA1: '3', PA2: '5', PA3: '6' }, vdd: '1', nrst: '7' }),
        c('RV1', 'POT', 'POT', '10k', -9, 16.5, 0, { 1: '3V3', 2: 'ADC', 3: 'GND' }, { alpha: 0.6 }),
        c('R2', 'R', '0603', '10k', 12, -11, 0, { 1: '3V3', 2: 'BTN' }),
        c('SW1', 'SW', 'TACT6', 'SW1', 22, -16, 0, { 1: 'BTN', 2: 'BTN', 3: 'GND', 4: 'GND' }, { cap: 0x30343a }),
        c('R4', 'R', '0603', '10k', -7, -11, 0, { 1: '3V3', 2: 'NRST' }),
        c('C4', 'C', '0603', '100n', -7, -14.5, 0, { 1: 'NRST', 2: 'GND' }),
        c('RESET', 'SW', 'TACT6', 'RESET', 3, -18, 0, { 1: 'NRST', 2: 'NRST', 3: 'GND', 4: 'GND' }, { cap: 0xc22a2a }),
        c('R_LED1', 'R', '0603', '10R', 19, 15, 0, { 1: 'VBUS', 2: 'LED1_A' }),
        c('LED1', 'LED', 'LED0805', 'Blanc', 26, 15, 0, { 1: 'LED1_A', 2: 'LED1_K' }, { color: 0xeaf2ff, vf: 2.9, rd: 2, pmax: 1.0, rth: 80 }),
        c('Q1', 'NMOS', 'SOT23', 'NMOS', 31, 8, 0, { 1: 'PWM', 2: 'GND', 3: 'LED1_K' }),
        c('R3', 'R', '0603', '330R', 14, -4, 0, { 1: 'STATUS', 2: 'LED2_A' }),
        c('LED2', 'LED', 'LED0805', 'Vert', 20, -4, 0, { 1: 'LED2_A', 2: 'GND' }, { color: 0x30ff70, vf: 2.0, rd: 8 }),
        c('R6', 'R', '0603', '1k', -22, 19, 180, { 1: '3V3', 2: 'PWR_A' }),
        c('LED3', 'LED', 'LED0805', 'Rouge', -28, 19, 180, { 1: 'PWR_A', 2: 'GND' }, { color: 0xff3020, vf: 1.8, rd: 8 }),
        c('R5', 'R', '0603', '10k', 13, 7.5, 0, { 1: 'PWM', 2: 'PWM_FILT' }),
        c('C5', 'C', '0805', '1u', 13, 11.5, 0, { 1: 'PWM_FILT', 2: 'GND' }),
        c('U3', 'OPAMP', 'SOIC8', 'LM358', 31, -4, 0, { 1: 'DAC_OUT', 2: 'DAC_OUT', 3: 'PWM_FILT', 4: 'GND', 8: '3V3' }),
        c('TP1', 'TP', 'TP', 'VBUS', -29, -20, 0, { 1: 'VBUS' }),
        c('TP2', 'TP', 'TP', '3V3', -22, -20, 0, { 1: '3V3' }),
        c('TP3', 'TP', 'TP', 'GND', -15, -20, 0, { 1: 'GND' }),
        c('TP4', 'TP', 'TP', 'PWM', 33, 18.5, 0, { 1: 'PWM' }),
        c('TP5', 'TP', 'TP', 'ADC', -10, 5, 0, { 1: 'ADC' }),
        c('TP6', 'TP', 'TP', 'BTN', 32, -16, 0, { 1: 'BTN' })
      ]
    };
    setBugs(board, { rled: true, bridge: true, ledRev: true, short33: false });
    return board;
  }

  // Applique / retire les défauts de la carte de démo (3 bugs d'origine + court-circuit injectable)
  function setBugs(board, bugs) {
    board.bugs = Object.assign({ rled: false, bridge: false, ledRev: false, short33: false }, bugs);
    const find = (ref) => board.components.find((c) => c.ref === ref);
    const r = find('R_LED1');
    if (r) { r.value = board.bugs.rled ? '10R' : '150R'; r.pkg = board.bugs.rled ? '0603' : '0805'; }
    const d = find('LED2');
    if (d) d.params.reversed = !!board.bugs.ledRev;
    board.bridges = [];
    if (board.bugs.bridge && find('U1')) board.bridges.push({ id: 'bridge', a: 'BTN', b: 'GND', ref: 'U1', pins: ['3', '4'], r: 0.02 });
    if (board.bugs.short33 && find('C3')) board.bridges.push({ id: 'short33', a: '3V3', b: 'GND', ref: 'C3', pins: ['1', '2'], r: 0.02 });
  }

  const FIRMWARE = {
    demo: [
      '// RV1 -> rapport cyclique PWM de LED1 ; SW1 bascule LED2',
      "mcu.pwm('PA2', mcu.adc('PA0') / 4095);",
      "const b = mcu.read('PA1');",
      'if (mem.last === undefined) { mem.last = 1; mem.led = 0; }',
      'if (b !== mem.last) { mem.last = b; mem.t0 = mcu.millis; mem.armed = true; }',
      'if (mem.armed && mcu.millis - mem.t0 >= 10) {   // anti-rebond 10 ms',
      '  mem.armed = false;',
      '  if (b === 0) mem.led ^= 1;',
      '}',
      "mcu.write('PA3', mem.led);"
    ].join('\n'),
    blink: [
      '// LED2 clignote à 2 Hz, LED1 à 50 %',
      "mcu.write('PA3', (mcu.millis % 500) < 250 ? 1 : 0);",
      "mcu.pwm('PA2', 0.5);"
    ].join('\n'),
    breath: [
      '// LED1 « respire » sur 2 s ; LED2 suit le bouton SW1',
      "mcu.pwm('PA2', 0.5 - 0.5 * Math.cos(mcu.millis / 1000 * Math.PI));",
      "mcu.write('PA3', mcu.read('PA1') ? 0 : 1);"
    ].join('\n')
  };

  // ------------------------------------------------------------------ Émulateur de microcontrôleur
  class MCU {
    constructor(comp, solver) {
      const p = comp.params;
      this.comp = comp;
      this.vddNode = solver.node(comp.pins[p.vdd]);
      this.nrstNode = p.nrst ? solver.node(comp.pins[p.nrst]) : -2;
      this.vddPin = p.vdd;
      this.gndPin = Object.keys(comp.pins).find((k) => GND_RE.test(comp.pins[k]));
      this.pins = {};
      for (const name in p.gpio) this.pins[name] = { pin: p.gpio[name], node: solver.node(comp.pins[p.gpio[name]]), mode: 'in', level: 0, duty: 0, out: 0 };
      this.pwmFreq = 500; this.running = false; this.fn = null; this.error = null; this.code = ''; this.vdd = 0;
      this.reset();
    }
    reset() {
      this.mem = {}; this.millis = 0; this.acc = 0; this.boot = 0.005; this.clean = true;
      for (const k in this.pins) { const q = this.pins[k]; q.mode = 'in'; q.out = 0; q.duty = 0; q.level = 0; }
    }
    flash(code) {
      this.code = code; this.error = null;
      try { this.fn = new Function('mcu', 'mem', code); } catch (e) { this.fn = null; this.error = e.message; }
      this.running = false; this.reset();
    }
    tick(s) {
      const vdd = s.vn(this.vddNode), nrst = this.nrstNode === -2 ? vdd : s.vn(this.nrstNode);
      if (!(vdd > 2.0 && nrst > 0.6 * vdd)) {          // brown-out ou RESET maintenu
        if (this.running || !this.clean) { this.running = false; this.reset(); }
        return;
      }
      this.vdd = vdd; this.s = s; this.clean = false;
      if (!this.running) { this.boot -= s.dt; if (this.boot > 0) return; this.running = true; }
      this.acc += s.dt;
      if (this.acc >= 1e-3) {
        this.acc -= 1e-3; this.millis++;
        if (this.fn) { try { this.fn(this, this.mem); } catch (e) { this.error = e.message; this.fn = null; } }
      }
      const ph = (s.t * this.pwmFreq) % 1;
      for (const k in this.pins) { const q = this.pins[k]; q.out = q.mode === 'pwm' ? (ph < q.duty ? 1 : 0) : q.level; }
    }
    stamp(s) {
      if (this.vddNode >= 0) s.G[this.vddNode * s.n + this.vddNode] += this.running ? 0.0025 : 1e-5;   // ≈ 8 mA sous 3,3 V
      if (!this.running) return;
      for (const k in this.pins) { const q = this.pins[k]; if (q.mode !== 'in') s._th(q.node, q.out * this.vdd, 25); }
    }
    pinCurrents(s, add) {
      let src = this.running ? this.vdd * 0.0025 : 0, snk = src;
      if (this.running) for (const k in this.pins) {
        const q = this.pins[k]; if (q.mode === 'in' || q.node < 0) continue;
        const i = (q.out * this.vdd - s.vn(q.node)) / 25;
        add(this.comp, q.pin, i); if (i > 0) src += i; else snk -= i;
      }
      add(this.comp, this.vddPin, -src); if (this.gndPin) add(this.comp, this.gndPin, snk);
    }
    // --- API firmware ---
    adc(name) { const q = this.pins[name]; if (!q) return 0; q.mode = 'in'; return Math.max(0, Math.min(4095, Math.round(this.s.vn(q.node) / this.vdd * 4095))); }
    read(name) { const q = this.pins[name]; if (!q) return 0; if (q.mode !== 'in') return q.out; return this.s.vn(q.node) > this.vdd * 0.5 ? 1 : 0; }
    write(name, v) { const q = this.pins[name]; if (!q) return; q.mode = 'out'; q.level = v ? 1 : 0; }
    pwm(name, d) { const q = this.pins[name]; if (!q) return; q.mode = 'pwm'; q.duty = Math.max(0, Math.min(1, +d || 0)); }
  }

  // ------------------------------------------------------------------ Solveur nodal
  class CircuitSolver {
    constructor() {
      this.dt = 50e-6; this.t = 0; this.tamb = 25; this.n = 0;
      this.psu = { on: true, vset: 5, ilim: 0.5, mode: 'CV', v: 0, i: 0 };
      this.netIndex = new Map(); this.netNames = [];
    }
    node(net) {
      if (net === undefined || net === null || net === '') return -2;   // -2 : non connecté
      if (GND_RE.test(net)) return -1;                                   // -1 : masse
      const i = this.netIndex.get(String(net));
      return i === undefined ? -2 : i;
    }
    vn(i) { return i >= 0 ? this.V[i] : 0; }
    v(net) { return this.vn(this.node(net)); }

    load(board, firmware) {
      this.board = board; this.t = 0;
      this.netIndex = new Map(); this.netNames = [];
      const reg = (net) => { if (!net || GND_RE.test(net) || this.netIndex.has(String(net))) return; this.netIndex.set(String(net), this.netNames.length); this.netNames.push(String(net)); };
      for (const c of board.components) for (const k in c.pins) reg(c.pins[k]);
      for (const b of board.bridges || []) { reg(b.a); reg(b.b); }
      const n = this.n = this.netNames.length;
      this.G = new Float64Array(n * n); this.I = new Float64Array(n); this.V = new Float64Array(n);
      this.res = []; this.sw = []; this.pots = []; this.caps = []; this.leds = []; this.ldos = []; this.fets = []; this.mcus = []; this.opamps = [];
      this.supplyNode = this.node(board.supplyNet); this.supplyConn = null; this.hottest = null;
      const ok = (...a) => a.every((x) => x !== -2);
      for (const c of board.components) {
        const pk = PKG[c.pkg] || PKG.BOX, pr = c.params || (c.params = {});
        c.state = c.state || {};
        c.sim = { e: 0, p: 0, pAvg: 0, pPeak: 0, temp: this.tamb, over: false, burnt: 0, rth: pr.rth || pk.rth, pmax: pr.pmax || pk.pmax };
        const N = (p) => this.node(c.pins[p]);
        if (c.kind === 'R') {
          if (ok(N('1'), N('2'))) this.res.push({ a: N('1'), b: N('2'), g: 1 / Math.max(1e-3, parseValue(c.value, 1e3)), comp: c, p1: '1', p2: '2' });
        } else if (c.kind === 'C' || c.kind === 'CPOL') {
          if (ok(N('1'), N('2'))) this.caps.push({ a: N('1'), b: N('2'), c: parseValue(c.value, 1e-7), vp: 0, i: 0, comp: c });
        } else if (c.kind === 'LED') {
          const pa = pr.reversed ? '2' : '1', pkk = pr.reversed ? '1' : '2';
          if (ok(N(pa), N(pkk))) this.leds.push({ a: N(pa), k: N(pkk), vf: pr.vf || 2, rd: pr.rd || 8, on: false, i: 0, iAvg: 0, comp: c, pa, pk: pkk });
        } else if (c.kind === 'POT') {
          if (c.state.alpha === undefined) c.state.alpha = pr.alpha === undefined ? 0.5 : pr.alpha;
          if (ok(N('1'), N('2'), N('3'))) {
            const e1 = { a: N('1'), b: N('2'), g: 1e-4, comp: c, p1: '1', p2: '2' }, e2 = { a: N('2'), b: N('3'), g: 1e-4, comp: c, p1: '2', p2: '3' };
            this.res.push(e1, e2); this.pots.push({ comp: c, R: parseValue(c.value, 1e4), e1, e2 });
          }
        } else if (c.kind === 'SW') {
          c.state.pressed = false;
          if (ok(N('1'), N('3'))) {
            const e = { a: N('1'), b: N('3'), g: 1e-9, comp: c, p1: '1', p2: '3' };
            this.res.push(e); this.sw.push({ e, comp: c, closed: false, target: false, bounceEnd: 0, nextT: 0 });
          }
        } else if (c.kind === 'LDO') {
          if (ok(N('2'), N('3'))) this.ldos.push({ out: N('2'), in: N('3'), vout: pr.vout || 3.3, drop: pr.dropout || 0.3, ilim: pr.ilim || 0.8, rs: 0.15, st: 'O', iout: 0, iq: 0, comp: c });
        } else if (c.kind === 'NMOS') {
          if (ok(N('1'), N('2'), N('3'))) this.fets.push({ g: N('1'), s: N('2'), d: N('3'), on: false, i: 0, comp: c });
        } else if (c.kind === 'MCU') {
          const m = new MCU(c, this); m.flash(firmware || FIRMWARE.demo); this.mcus.push(m);
        } else if (c.kind === 'OPAMP') {
          if (ok(N('1'), N('2'), N('3'), N('8'))) this.opamps.push({ out: N('1'), n: N('2'), p: N('3'), vcc: N('8'), vo: 0, comp: c });
        } else if (c.kind === 'CONN' && !this.supplyConn) {
          const pin = Object.keys(c.pins).find((k) => c.pins[k] && c.pins[k] === board.supplyNet);
          if (pin) this.supplyConn = { comp: c, pin, gndPin: Object.keys(c.pins).find((k) => GND_RE.test(c.pins[k] || '')) };
        }
      }
      for (const b of board.bridges || []) {
        const a = this.node(b.a), bb = this.node(b.b);
        if (ok(a, bb)) this.res.push({ a, b: bb, g: 1 / b.r, comp: null });
      }
      this.psu.mode = 'CV'; this.psu.v = 0; this.psu.i = 0;
    }

    _g(a, b, g) {
      const n = this.n, G = this.G;
      if (a >= 0) G[a * n + a] += g;
      if (b >= 0) G[b * n + b] += g;
      if (a >= 0 && b >= 0) { G[a * n + b] -= g; G[b * n + a] -= g; }
    }
    _i(a, b, x) { if (a >= 0) this.I[a] += x; if (b >= 0) this.I[b] -= x; }
    _th(a, v, rs) { if (a < 0) return; this.G[a * this.n + a] += 1 / rs; this.I[a] += v / rs; }   // source de Thévenin vers la masse

    _solve() {   // élimination de Gauss avec pivot partiel : G·V = I
      const n = this.n, A = this.G, b = this.I, x = this.V;
      for (let k = 0; k < n; k++) {
        let p = k, max = Math.abs(A[k * n + k]);
        for (let r = k + 1; r < n; r++) { const v = Math.abs(A[r * n + k]); if (v > max) { max = v; p = r; } }
        if (max < 1e-18) continue;
        if (p !== k) {
          for (let c = k; c < n; c++) { const t = A[k * n + c]; A[k * n + c] = A[p * n + c]; A[p * n + c] = t; }
          const t = b[k]; b[k] = b[p]; b[p] = t;
        }
        const piv = A[k * n + k];
        for (let r = k + 1; r < n; r++) {
          const f = A[r * n + k] / piv; if (f === 0) continue;
          for (let c = k; c < n; c++) A[r * n + c] -= f * A[k * n + c];
          b[r] -= f * b[k];
        }
      }
      for (let k = n - 1; k >= 0; k--) {
        let s = b[k];
        for (let c = k + 1; c < n; c++) s -= A[k * n + c] * x[c];
        const piv = A[k * n + k];
        x[k] = Math.abs(piv) < 1e-18 ? 0 : s / piv;
      }
    }

    step() {
      const n = this.n, G = this.G, I = this.I, dt = this.dt, psu = this.psu, sn = this.supplyNode;
      // Contacts mécaniques : rebonds aléatoires pendant 4 ms après chaque appui / relâchement
      for (const s of this.sw) {
        const want = !!s.comp.state.pressed;
        if (want !== s.target) { s.target = want; s.bounceEnd = this.t + 0.004; s.nextT = this.t; }
        if (this.t < s.bounceEnd) {
          if (this.t >= s.nextT) { s.closed = !s.closed; s.nextT = this.t + 0.0001 + Math.random() * 0.0005; }
        } else s.closed = s.target;
        s.e.g = s.closed ? 20 : 1e-9;
      }
      for (const p of this.pots) {
        const a = Math.min(1, Math.max(0, p.comp.state.alpha));
        p.e1.g = 1 / (p.R * (1 - a) + 1); p.e2.g = 1 / (p.R * a + 1);
      }
      for (const m of this.mcus) m.tick(this);
      for (const o of this.opamps) {
        const top = Math.max(0.02, this.vn(o.vcc) - 1.2);
        o.vo = Math.max(0.02, Math.min(top, o.vo + (this.vn(o.p) - this.vn(o.n)) * 0.6));
      }

      let again = true, iter = 0;
      while (again && iter < 12) {
        again = false; iter++;
        G.fill(0); I.fill(0);
        for (let i = 0; i < n; i++) G[i * n + i] = 1e-9;
        for (const r of this.res) this._g(r.a, r.b, r.g);
        for (const c of this.caps) { const g = c.c / dt; this._g(c.a, c.b, g); this._i(c.a, c.b, g * c.vp); }
        for (const d of this.leds) if (d.on) { const g = 1 / d.rd; this._g(d.a, d.k, g); this._i(d.a, d.k, g * d.vf); }
        for (const f of this.fets) this._g(f.d, f.s, f.on ? 12 : 1e-8);
        for (const l of this.ldos) {
          const g = 1 / l.rs; l.iq = this.vn(l.in) > 1 ? 0.004 : 0;
          if (l.st === 'A') {            // régulation : sortie fixe, l'entrée fournit le courant de sortie
            this._th(l.out, l.vout, l.rs);
            if (l.in >= 0) { if (l.out >= 0) G[l.in * n + l.out] -= g; I[l.in] -= l.vout * g; }
          } else if (l.st === 'B') {     // décrochage (dropout) : Vout = Vin − Vdrop
            this._g(l.in, l.out, g); this._i(l.in, l.out, g * l.drop);
          } else if (l.st === 'C') {     // limitation de courant
            if (l.out >= 0) I[l.out] += l.ilim;
            if (l.in >= 0) I[l.in] -= l.ilim;
          }
          if (l.in >= 0) I[l.in] -= l.iq;
        }
        for (const m of this.mcus) m.stamp(this);
        for (const o of this.opamps) this._th(o.out, o.vo, 50);
        if (psu.on && sn >= 0) {
          if (psu.mode === 'CV') this._th(sn, psu.vset, RS_PSU);
          else { I[sn] += psu.ilim; G[sn * n + sn] += 1e-6; }
        }
        this._solve();

        // États non linéaires
        for (const d of this.leds) {
          const vd = this.vn(d.a) - this.vn(d.k);
          if (d.on && vd < d.vf) { d.on = false; again = true; } else if (!d.on && vd > d.vf + 1e-4) { d.on = true; again = true; }
        }
        for (const f of this.fets) {
          const vgs = this.vn(f.g) - this.vn(f.s);
          if (!f.on && vgs > 1.5) { f.on = true; again = true; } else if (f.on && vgs < 1.3) { f.on = false; again = true; }
        }
        for (const l of this.ldos) {
          const vo = this.vn(l.out), head = this.vn(l.in) - l.drop, g = 1 / l.rs;
          let st = l.st;
          if (st === 'A') { l.iout = (l.vout - vo) * g; if (head < l.vout) st = 'B'; else if (l.iout > l.ilim) st = 'C'; }
          else if (st === 'B') { l.iout = (head - vo) * g; if (head > l.vout + 1e-3) st = 'A'; else if (l.iout > l.ilim) st = 'C'; else if (l.iout < 0) st = 'O'; }
          else if (st === 'C') { l.iout = l.ilim; if (vo > Math.min(l.vout, head)) st = head >= l.vout ? 'A' : 'B'; }
          else { l.iout = 0; if (head > vo + 1e-3) st = 'B'; }
          if (st !== l.st) { l.st = st; again = true; }
        }
        if (psu.on && sn >= 0) {      // bascule CV <-> CC
          if (psu.mode === 'CV' && (psu.vset - this.V[sn]) / RS_PSU > psu.ilim) { psu.mode = 'CC'; again = true; }
          else if (psu.mode === 'CC' && this.V[sn] > psu.vset) { psu.mode = 'CV'; again = true; }
        }
      }

      // Bilan du pas : mémoires, courants, énergie dissipée par composant
      for (const c of this.caps) { const v = this.vn(c.a) - this.vn(c.b); c.i = (c.c / dt) * (v - c.vp); c.vp = v; }
      for (const r of this.res) if (r.comp) { const dv = this.vn(r.a) - this.vn(r.b); r.comp.sim.e += r.g * dv * dv * dt; }
      for (const d of this.leds) {
        const vd = this.vn(d.a) - this.vn(d.k);
        d.i = d.on ? Math.max(0, (vd - d.vf) / d.rd) : 0;
        d.iAvg += (d.i - d.iAvg) * (dt / 0.02);
        d.comp.sim.e += vd * d.i * dt;
      }
      for (const f of this.fets) { const dv = this.vn(f.d) - this.vn(f.s); f.i = dv * (f.on ? 12 : 1e-8); f.comp.sim.e += dv * f.i * dt; }
      for (const l of this.ldos) l.comp.sim.e += ((this.vn(l.in) - this.vn(l.out)) * l.iout + this.vn(l.in) * l.iq) * dt;
      for (const m of this.mcus) if (m.running) m.comp.sim.e += m.vdd * m.vdd * 0.0025 * dt;
      if (sn >= 0) {
        psu.v = this.V[sn];
        psu.i = !psu.on ? 0 : psu.mode === 'CV' ? Math.max(0, (psu.vset - psu.v) / RS_PSU) : psu.ilim;
      }
      this.t += dt;
    }

    // Thermique par boîtier : T = Tamb + P × RθJA (1er ordre, constante de temps accélérée pour l'affichage)
    updateThermal(realDt, simDt) {
      let hottest = null;
      for (const c of this.board.components) {
        const s = c.sim;
        s.p = simDt > 0 ? s.e / simDt : 0; s.e = 0;
        s.pAvg += (s.p - s.pAvg) * Math.min(1, realDt / 0.15);
        s.temp += (this.tamb + s.pAvg * s.rth - s.temp) * (1 - Math.exp(-realDt / 1.4));
        if (s.pAvg > s.pPeak) s.pPeak = s.pAvg;
        const ratio = s.pAvg / s.pmax;
        s.over = ratio > 1;
        if (ratio > 1.3) s.burnt = Math.min(1, s.burnt + realDt * 0.08 * ratio);
        if (!hottest || s.temp > hottest.sim.temp) hottest = c;
      }
      this.hottest = hottest;
    }

    // Courant injecté dans le réseau par chaque broche ("REF.pin" -> A), pour l'animation Rayon X
    pinCurrents() {
      const map = new Map();
      const add = (c, p, i) => { const k = c.ref + '.' + p; map.set(k, (map.get(k) || 0) + i); };
      for (const r of this.res) if (r.comp) { const i = (this.vn(r.a) - this.vn(r.b)) * r.g; add(r.comp, r.p1, -i); add(r.comp, r.p2, i); }
      for (const c of this.caps) { add(c.comp, '1', -c.i); add(c.comp, '2', c.i); }
      for (const d of this.leds) { add(d.comp, d.pa, -d.iAvg); add(d.comp, d.pk, d.iAvg); }
      for (const f of this.fets) { add(f.comp, '3', -f.i); add(f.comp, '2', f.i); }
      for (const l of this.ldos) { add(l.comp, '3', -(l.iout + l.iq)); add(l.comp, '2', l.iout); add(l.comp, '1', l.iq); }
      for (const m of this.mcus) m.pinCurrents(this, add);
      for (const o of this.opamps) { const i = (o.vo - this.vn(o.out)) / 50; add(o.comp, '1', i); add(o.comp, '8', -i); }
      if (this.supplyConn) {
        add(this.supplyConn.comp, this.supplyConn.pin, this.psu.i);
        if (this.supplyConn.gndPin) add(this.supplyConn.comp, this.supplyConn.gndPin, -this.psu.i);
      }
      return map;
    }

    // Ohmmètre : réseau résistif seul (hors tension), injection de 1 mA entre les deux nets
    measureResistance(netA, netB) {
      const a = this.node(netA), b = this.node(netB);
      if (a === -2 || b === -2) return Infinity;
      if (a === b) return 0;
      const n = this.n, G0 = this.G, I0 = this.I, V0 = this.V;
      this.G = new Float64Array(n * n); this.I = new Float64Array(n); this.V = new Float64Array(n);
      for (let i = 0; i < n; i++) this.G[i * n + i] = 1e-10;
      for (const r of this.res) this._g(r.a, r.b, r.g);
      this._i(a, b, 1e-3);
      this._solve();
      const R = (this.vn(a) - this.vn(b)) / 1e-3;
      this.G = G0; this.I = I0; this.V = V0;
      return R > 5e7 ? Infinity : Math.max(0, R);
    }
  }

  // Diagnostic de la carte à partir des grandeurs simulées
  function diagnose(board, solver) {
    const out = [];
    for (const c of board.components) {
      const s = c.sim; if (!s) continue;
      if (s.pPeak > s.pmax) {          // puissance maximale observée depuis la mise sous tension
        out.push({ ref: c.ref, msg: c.ref + ' (' + c.value + ', ' + c.pkg + ') dissipe ' + (s.pPeak * 1000).toFixed(0) + ' mW pour ' + (s.pmax * 1000).toFixed(0) + ' mW admissibles → ' + (solver.tamb + s.pPeak * s.rth).toFixed(0) + ' °C en régime établi' });
      } else if (c.kind === 'R' && board.demo && board.bugs && board.bugs.rled && c.ref === 'R_LED1') {
        const p = Math.pow(5 - 2.9, 2) / (parseValue(c.value, 10) + 2) / (parseValue(c.value, 10) + 2) * parseValue(c.value, 10);   // estimation hors tension, sous 5 V
        out.push({ ref: c.ref, msg: c.ref + ' (' + c.value + ', ' + c.pkg + ') dissipe ≈ ' + (p * 1000).toFixed(0) + ' mW sous 5 V (estimation, carte hors tension) pour ' + (s.pmax * 1000).toFixed(0) + ' mW admissibles' });
      }
    }
    for (const b of board.bridges || []) out.push({ ref: b.ref, msg: 'Pont de soudure sur ' + b.ref + ' broches ' + b.pins.join('–') + ' : ' + b.a + ' ↔ ' + b.b + ' (' + (b.r * 1000).toFixed(0) + ' mΩ)' });
    for (const d of solver.leds) if (d.comp.params.reversed) out.push({ ref: d.comp.ref, msg: d.comp.ref + ' montée à l\'envers : ' + (solver.vn(d.k) - solver.vn(d.a)).toFixed(2) + ' V en inverse, courant nul' });
    return out;
  }

  // ------------------------------------------------------------------ Import Pick & Place / Netlist
  function splitCells(line, delim) {
    if (delim === ' ') return line.trim().split(/\s+/);
    const out = []; let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === delim && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function parsePickPlace(text) {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/^#\s*(?=Ref)/i, '').trim()).filter((l) => l && !/^#/.test(l));
    const isHeader = (l) => /(^|[\s,;"\t])(ref|designator|refdes|reference)/i.test(l) && /(x|pos)/i.test(l);
    const hi = lines.findIndex(isHeader);
    if (hi < 0) return [];
    const head = lines[hi], delim = head.includes(',') ? ',' : head.includes(';') ? ';' : head.includes('\t') ? '\t' : ' ';
    const cols = splitCells(head, delim).map((h) => h.toLowerCase().replace(/[\s"]/g, ''));
    const col = (re) => cols.findIndex((h) => re.test(h));
    const ix = { ref: col(/^(ref|designator|refdes|reference)/), val: col(/^(val|value|comment)/), pkg: col(/^(package|footprint)/),
      x: col(/^(posx|center-x|centerx|midx|x)/), y: col(/^(posy|center-y|centery|midy|y)/), rot: col(/^rot/), side: col(/^(side|layer)/) };
    if (ix.ref < 0 || ix.x < 0 || ix.y < 0) return [];
    const num = (s, h) => { const v = parseFloat(String(s).replace(',', '.')); return (/mil/i.test(s) || /mil/.test(h)) ? v * 0.0254 : v; };
    const parts = [];
    for (let i = hi + 1; i < lines.length; i++) {
      const cells = splitCells(lines[i], delim);
      const ref = cells[ix.ref], x = num(cells[ix.x], cols[ix.x]), y = num(cells[ix.y], cols[ix.y]);
      if (!ref || !isFinite(x) || !isFinite(y)) continue;
      parts.push({ ref, value: ix.val >= 0 ? cells[ix.val] || '' : '', footprint: ix.pkg >= 0 ? cells[ix.pkg] || '' : '', x, y,
        rot: ix.rot >= 0 ? parseFloat(cells[ix.rot]) || 0 : 0, side: ix.side >= 0 && /bot|back|^b/i.test(cells[ix.side] || '') ? 'bottom' : 'top' });
    }
    return parts;
  }

  // Netlist KiCad (.net, s-expressions) ou CSV « Ref,Pin,Net » -> Map(ref -> {pin: net})
  function parseNetlist(text) {
    const map = new Map();
    const put = (ref, pin, net) => { if (!map.has(ref)) map.set(ref, {}); map.get(ref)[pin] = net; };
    if (/\(net\s+\(code/.test(text)) {
      const re = /\(net\s+\(code\s+"?[^)]*"?\)\s*\(name\s+"?([^")]*)"?\)|\(node\s+\(ref\s+"?([^")\s]+)"?\)\s*\(pin\s+"?([^")\s]+)"?/g;
      let m, net = '';
      while ((m = re.exec(text))) { if (m[1] !== undefined) net = m[1].replace(/^\//, ''); else put(m[2], m[3], net); }
      return map;
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^#/.test(l));
    if (!lines.length) return map;
    const delim = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
    let order = [0, 1, 2], start = 0;
    const h = splitCells(lines[0], delim).map((s) => s.toLowerCase());
    if (h.some((s) => /^(ref|net|pin)/.test(s))) {
      order = [h.findIndex((s) => /^(ref|designator)/.test(s)), h.findIndex((s) => /^pin/.test(s)), h.findIndex((s) => /^net/.test(s))]; start = 1;
      if (order.includes(-1)) return map;
    }
    for (let i = start; i < lines.length; i++) { const c = splitCells(lines[i], delim); if (c[order[0]] && c[order[1]]) put(c[order[0]], c[order[1]], c[order[2]] || ''); }
    return map;
  }

  function guessPkg(ref, fp) {
    const f = (fp || '').toUpperCase(), p = (ref.match(/^[A-Za-z_]+/) || [''])[0].toUpperCase();
    if (/LED/.test(f)) return 'LED0805';
    if (/QFP|QFN/.test(f)) return 'LQFP32';
    if (/SOIC|SOP|SO-?8|MSOP/.test(f)) return 'SOIC8';
    if (/SOT-?23|SC-?70/.test(f)) return 'SOT23';
    if (/TO-?252|DPAK|SOT-?223/.test(f)) return 'TO252';
    if (/USB/.test(f)) return 'USBC';
    if (/TERM|SCREW|PHOENIX|BORNIER/.test(f)) return 'TERM2';
    if (/CP_|ELEC|RADIAL|CAP_AL/.test(f)) return 'ELEC';
    if (/TACT|SW_|PUSH|BUTTON/.test(f)) return 'TACT6';
    if (/POT|TRIM/.test(f)) return 'POT';
    if (/TESTPOINT|TEST_POINT|^TP/.test(f)) return 'TP';
    if (/0805|2012/.test(f)) return 'D' === p || 'LED' === p ? 'LED0805' : '0805';
    if (/0603|1608|0402|1206/.test(f)) return 'D' === p || 'LED' === p ? 'LED0805' : '0603';
    return ({ R: '0603', C: '0603', L: '0805', D: 'LED0805', LED: 'LED0805', U: 'SOIC8', IC: 'SOIC8', Q: 'SOT23', SW: 'TACT6', S: 'TACT6', RV: 'POT', J: 'TERM2', P: 'TERM2', TP: 'TP' })[p] || 'BOX';
  }

  function guessKind(ref, pkg, value) {
    const p = (ref.match(/^[A-Za-z_]+/) || [''])[0].toUpperCase();
    if (pkg === 'LED0805') return 'LED';
    if (pkg === 'ELEC') return 'CPOL';
    if (pkg === 'TACT6') return 'SW';
    if (pkg === 'POT') return 'POT';
    if (pkg === 'TP') return 'TP';
    if (pkg === 'USBC' || pkg === 'TERM2') return 'CONN';
    if (pkg === 'TO252' || /1117|LDO|78\d\d/i.test(value || '')) return pkg === 'TO252' ? 'LDO' : 'IC';
    if (p === 'R') return 'R';
    if (p === 'C') return 'C';
    if (p === 'Q') return 'NMOS';
    return 'IC';
  }

  function buildImportedBoard(pnpText, netText, name) {
    const parts = parsePickPlace(pnpText);
    if (!parts.length) throw new Error('Aucun composant reconnu : colonnes attendues Ref, PosX, PosY (Rot, Side, Val, Package optionnelles).');
    const nets = netText ? parseNetlist(netText) : new Map();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of parts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const colorOf = (v) => /red|rouge/i.test(v) ? 0xff3020 : /blue|bleu/i.test(v) ? 0x3070ff : /white|blanc/i.test(v) ? 0xeaf2ff : /yellow|jaune|amber/i.test(v) ? 0xffc020 : 0x30ff70;
    const alias = { A: '1', K: '2', '+': '1', '-': '2', C: '2' };
    const components = parts.map((p) => {
      const pkg = guessPkg(p.ref, p.footprint), kind = guessKind(p.ref, pkg, p.value), src = nets.get(p.ref) || {}, pins = {};
      for (const k in src) {
        let pin = PKG[pkg].pins.includes(k) ? k : alias[k.toUpperCase()];
        if (pkg === 'USBC') pin = /VBUS|5V/i.test(src[k]) ? 'VBUS' : GND_RE.test(src[k]) ? 'GND' : null;
        if (pin && PKG[pkg].pins.includes(pin)) pins[pin] = src[k];
      }
      const params = kind === 'LED' ? { color: colorOf(p.value), vf: 2, rd: 8 } : {};
      return { ref: p.ref, kind, pkg, value: p.value, x: p.x - cx, y: p.y - cy, rot: p.rot, side: p.side, pins, params };
    });
    let supplyNet = null;
    for (const c of components) for (const k in c.pins) if (!supplyNet && /^(VBUS|\+?5V|VIN|VCC|\+?12V|\+?9V)$/i.test(c.pins[k])) supplyNet = c.pins[k];
    return { name: name || 'Carte importée', width: Math.max(24, x1 - x0 + 14), height: Math.max(18, y1 - y0 + 14), demo: false,
      supplyNet, bridges: [], bugs: {}, components, hasNets: nets.size > 0 };
  }

  const SAMPLE_PNP = [
    'Ref,Val,Package,PosX,PosY,Rot,Side',
    'J1,USB_C,USB_C_Receptacle,104.0,-60.0,0,top',
    'U1,AMS1117-3.3,TO-252-2,118.0,-66.0,0,top',
    'C1,10u,C_0805_2012Metric,118.0,-55.0,0,top',
    'C2,100n,C_0603_1608Metric,127.0,-55.0,0,top',
    'U2,STM32G030K6,LQFP-32_7x7mm_P0.8mm,136.0,-62.0,0,top',
    'R1,330R,R_0603_1608Metric,148.0,-55.0,0,top',
    'D1,LED_Green,LED_0805_2012Metric,154.0,-55.0,0,top',
    'R2,1k,R_0603_1608Metric,148.0,-70.0,0,top',
    'D2,LED_Red,LED_0805_2012Metric,154.0,-70.0,0,top',
    'U3,LM358,SOIC-8_3.9x4.9mm,148.0,-62.5,90,top',
    'SW1,Tact,SW_Push_6x6mm,128.0,-72.0,0,top',
    'TP1,3V3,TestPoint_Pad_D1.5mm,110.0,-72.0,0,top'
  ].join('\n');
  const SAMPLE_NET = [
    'Ref,Pin,Net', 'J1,A4,VBUS', 'J1,A1,GND', 'U1,3,VBUS', 'U1,1,GND', 'U1,2,3V3', 'C1,1,3V3', 'C1,2,GND', 'C2,1,3V3', 'C2,2,GND',
    'U2,1,3V3', 'U2,4,GND', 'R1,1,3V3', 'R1,2,D1_A', 'D1,A,D1_A', 'D1,K,GND', 'R2,1,VBUS', 'R2,2,D2_A', 'D2,A,D2_A', 'D2,K,SW',
    'SW1,1,SW', 'SW1,2,SW', 'SW1,3,GND', 'SW1,4,GND', 'TP1,1,3V3'
  ].join('\n');

  Object.assign(PT, { PKG, GND_RE, parseValue, demoBoard, setBugs, FIRMWARE, MCU, CircuitSolver, diagnose, parsePickPlace, parseNetlist, buildImportedBoard, SAMPLE_PNP, SAMPLE_NET });
})(typeof window !== 'undefined' ? window : globalThis);
