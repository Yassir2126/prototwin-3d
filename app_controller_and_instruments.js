/* ProtoTwin 3D — contrôleur : synchronisation 60 FPS solveur ↔ 3D, alimentation, multimètre, oscilloscope, audio */
(function (global) {
  'use strict';
  const PT = global.ProtoTwin = global.ProtoTwin || {};
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ Audio procédural (Web Audio API)
  class AudioFx {
    constructor() {
      this.ctx = null;
      const unlock = () => this.ensure();
      global.addEventListener('pointerdown', unlock); global.addEventListener('keydown', unlock);
    }
    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = global.AudioContext || global.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = 0.6; this.master.connect(c.destination);
      this.beepOsc = c.createOscillator(); this.beepOsc.type = 'square'; this.beepOsc.frequency.value = 2300;   // bip de continuité
      this.beepGain = c.createGain(); this.beepGain.gain.value = 0;
      this.beepOsc.connect(this.beepGain); this.beepGain.connect(this.master); this.beepOsc.start();
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;                                     // grésillement de surchauffe
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
      this.sizzleGain = c.createGain(); this.sizzleGain.gain.value = 0;
      src.connect(hp); hp.connect(this.sizzleGain); this.sizzleGain.connect(this.master); src.start();
    }
    beep(on) { if (this.ctx) this.beepGain.gain.setTargetAtTime(on ? 0.05 : 0, this.ctx.currentTime, 0.008); }
    click(down) {                                                                                                  // clic mécanique du bouton
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = down ? 2600 : 3800; bp.Q.value = 1.2;
      const g = c.createGain(); g.gain.setValueAtTime(down ? 0.5 : 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
      src.connect(bp); bp.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + 0.04);
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(down ? 190 : 260, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.04);
      og.gain.setValueAtTime(down ? 0.35 : 0.15, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.06);
    }
    sizzle(level) {
      if (!this.ctx) return;
      this.sizzleGain.gain.setTargetAtTime(level > 0 ? level * (0.03 + Math.random() * 0.12) : 0, this.ctx.currentTime, 0.03);
    }
  }

  // ------------------------------------------------------------------ Oscilloscope 2 voies
  class Scope {
    constructor(canvas, dt) {
      this.cv = canvas; this.g = canvas.getContext('2d'); this.dt = dt;
      this.N = 1 << 16; this.a = new Float32Array(this.N); this.b = new Float32Array(this.N);
      this.count = 0; this.run = true; this.armed = false; this.trigPos = -1; this.base = 0;
      this.tdiv = 0.002; this.vdiv = 1; this.trig = 'rise'; this.ch1 = false; this.ch2 = false; this.stats = null;
    }
    get window() { return Math.min(this.N - 2, Math.round(10 * this.tdiv / this.dt)); }
    push(v1, v2) {
      if (!this.run) return;
      const i = this.count & (this.N - 1);
      this.a[i] = v1; this.b[i] = v2; this.count++;
      if (!this.armed) return;
      if (this.trigPos < 0) {            // Single : attend un écart de 0,4 V par rapport au niveau d'armement
        if ((this.trig === 'fall' && v1 < this.base - 0.4) || (this.trig !== 'fall' && v1 > this.base + 0.4)) this.trigPos = this.count - 1;
      } else if (this.count - this.trigPos >= this.window / 2) { this.run = false; this.armed = false; }
    }
    arm(current) { this.run = true; this.armed = true; this.trigPos = -1; this.base = current; }
    toggle() { this.run = !this.run; this.armed = false; this.trigPos = -1; }
    at(buf, idx) { return idx < 0 || idx >= this.count || idx < this.count - this.N ? NaN : buf[idx & (this.N - 1)]; }

    draw(name1, name2) {
      const dpr = Math.min(2, global.devicePixelRatio || 1), cw = Math.round(this.cv.clientWidth * dpr);
      if (cw > 0 && this.cv.width !== cw) { this.cv.width = cw; this.cv.height = Math.round(cw * 0.62); }   // netteté : 1 pixel écran = 1 pixel canvas
      const g = this.g, w = this.cv.width, h = this.cv.height, W = this.window, end = this.count;
      g.fillStyle = '#0c0c0d'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(237,237,237,0.07)'; g.lineWidth = 1; g.beginPath();
      for (let i = 1; i < 10; i++) { g.moveTo(i * w / 10 + 0.5, 0); g.lineTo(i * w / 10 + 0.5, h); }
      for (let i = 1; i < 8; i++) { g.moveTo(0, i * h / 8 + 0.5); g.lineTo(w, i * h / 8 + 0.5); }
      g.stroke();
      g.strokeStyle = 'rgba(237,237,237,0.2)'; g.beginPath(); g.moveTo(0, h - h / 8 + 0.5); g.lineTo(w, h - h / 8 + 0.5); g.stroke();   // 0 V

      // Recherche du point de déclenchement
      let centre = -1;
      if (this.trigPos >= 0) centre = this.trigPos;
      else if (this.trig !== 'none' && this.ch1 && this.run) {
        const lo0 = Math.max(0, end - 3 * W, end - this.N + 1);
        let mn = Infinity, mx = -Infinity;
        for (let i = lo0; i < end; i += 2) { const v = this.a[i & (this.N - 1)]; if (v < mn) mn = v; if (v > mx) mx = v; }
        if (mx - mn > 0.2) {
          const lvl = (mn + mx) / 2, rise = this.trig === 'rise';
          for (let i = end - (W >> 1) - 1; i > lo0; i--) {
            const p = this.a[(i - 1) & (this.N - 1)], q = this.a[i & (this.N - 1)];
            if (rise ? (p < lvl && q >= lvl) : (p > lvl && q <= lvl)) { centre = i; break; }
          }
        }
        this.lastCentre = centre;
      } else if (!this.run) centre = this.lastCentre === undefined ? -1 : this.lastCentre;
      if (!this.run && this.frozenStart !== undefined) this.start = this.frozenStart;
      else this.start = centre >= 0 ? centre - (W >> 1) : end - W;
      this.frozenStart = this.run ? undefined : this.start;
      const start = this.start, y = (v) => h - (1 + v / this.vdiv) * (h / 8);

      const trace = (buf, color) => {
        g.strokeStyle = color; g.lineWidth = 1.4 * dpr; g.beginPath();
        let pen = false, mn = Infinity, mx = -Infinity, sum = 0, n = 0;
        for (let px = 0; px < w; px++) {
          const i0 = start + Math.floor(px * W / w), i1 = Math.max(i0 + 1, start + Math.floor((px + 1) * W / w));
          let lo = Infinity, hi = -Infinity, first = NaN, last = NaN;
          for (let i = i0; i < i1; i++) { const v = this.at(buf, i); if (v !== v) continue; if (first !== first) first = v; last = v; if (v < lo) lo = v; if (v > hi) hi = v; sum += v; n++; }
          if (first !== first) { pen = false; continue; }
          if (lo < mn) mn = lo; if (hi > mx) mx = hi;
          if (!pen) { g.moveTo(px, y(first)); pen = true; } else g.lineTo(px, y(first));
          if (hi - lo > 1e-6) { g.lineTo(px, y(lo)); g.lineTo(px, y(hi)); g.lineTo(px, y(last)); }
        }
        g.stroke();
        return n ? { min: mn, max: mx, avg: sum / n } : null;
      };
      const s2 = this.ch2 ? trace(this.b, '#6aa9e9') : null;
      const s1 = this.ch1 ? trace(this.a, '#f5b83d') : null;
      if (s1 && s1.max - s1.min > 0.2) {         // fréquence et rapport cyclique de CH1
        const lvl = (s1.min + s1.max) / 2; let edges = 0, firstE = -1, lastE = -1, high = 0, n = 0, prev = NaN;
        for (let i = start; i < start + W; i++) {
          const v = this.at(this.a, i); if (v !== v) continue;
          if (prev === prev && prev < lvl && v >= lvl) { edges++; if (firstE < 0) firstE = i; lastE = i; }
          if (v >= lvl) high++; n++; prev = v;
        }
        s1.freq = edges > 1 ? (edges - 1) / ((lastE - firstE) * this.dt) : 0; s1.duty = n ? high / n : 0;
      }
      this.stats = { s1, s2 };

      g.font = Math.round(11 * dpr) + 'px "IBM Plex Mono", Menlo, Consolas, monospace'; g.textBaseline = 'top';
      g.fillStyle = '#f5b83d'; g.fillText('CH1 ' + (this.ch1 ? name1 : '—'), 6 * dpr, 5 * dpr);
      g.fillStyle = '#6aa9e9'; g.fillText('CH2 ' + (this.ch2 ? name2 : '—'), 6 * dpr, 19 * dpr);
      g.fillStyle = '#85858b'; g.textAlign = 'right';
      g.fillText((this.tdiv * 1000) + ' ms/div · ' + this.vdiv + ' V/div', w - 6 * dpr, 5 * dpr);
      g.fillText(this.armed ? (this.trigPos < 0 ? 'Armé' : 'Capture') : this.run ? (centre >= 0 ? 'Trig' : 'Auto') : 'Stop', w - 6 * dpr, 19 * dpr);
      g.textAlign = 'left';
      if (centre >= 0) { g.fillStyle = '#ededed'; g.beginPath(); g.moveTo(w / 2 - 6, 0); g.lineTo(w / 2 + 6, 0); g.lineTo(w / 2, 9); g.fill(); }
    }
  }

  // ------------------------------------------------------------------ Application
  class App {
    constructor() {
      this.solver = new PT.CircuitSolver();
      this.audio = new AudioFx();
      this.builder = new PT.Builder($('viewport'), {
        onButton: (ref, down) => this.onButton(ref, down),
        onPot: (ref, delta) => this.onPot(ref, delta),
        onProbe: () => { this.dmmInit = true; },
        onHover: (info) => { this.hoverInfo = info; this.updateTooltip(); },
        onGauge: (info) => this.onGauge(info)
      });
      this.scope = new Scope($('scope'), this.solver.dt);
      this.firmware = PT.FIRMWARE.demo; this.dmmMode = 'vdc'; this.dmmV = 0; this.dmmInit = true;
      this.v1 = 0; this.v2 = 0; this.simAcc = 0; this.uiT = 0; this.fpsT = 0; this.fpsN = 0; this.hoverInfo = null;
      $('fwCode').value = this.firmware;
      this.bindUI();
      this.loadBoard(PT.demoBoard());
      this.builder.setView('iso');
      this.last = performance.now();
      const loop = (t) => { this.frame(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }

    comp(ref) { return this.board.components.find((c) => c.ref === ref); }

    loadBoard(board) {
      this.board = board;
      this.solver.load(board, this.firmware);
      for (const m of this.solver.mcus) m.pwmFreq = +$('pwmFreq').value;
      this.builder.loadBoard(board);
      for (const c of board.components) if (c.kind === 'POT') this.builder.setPot(c.ref, c.state.alpha);
      $('boardName').textContent = board.name + ' · ' + board.components.length + ' composants · ' + this.solver.n + ' nets';
      const b = board.bugs || {};
      [['bugRled', 'rled'], ['bugBridge', 'bridge'], ['bugLedRev', 'ledRev'], ['bugShort', 'short33']].forEach(([id, k]) => { $(id).checked = !!b[k]; $(id).disabled = !board.demo; });
      this.dmmInit = true;
    }

    // --- interactions 3D ---
    onButton(ref, down) {
      const c = this.comp(ref); if (!c) return;
      c.state.pressed = down; this.builder.setButton(ref, down); this.audio.click(down);
    }
    onPot(ref, delta) {
      const c = this.comp(ref); if (!c) return;
      c.state.alpha = Math.max(0, Math.min(1, c.state.alpha + delta));
      this.builder.setPot(ref, c.state.alpha); this.updateTooltip();
    }
    onGauge(info) {
      const el = $('gaugeStatus');
      el.hidden = !info; if (!info) return;
      let html, blocked = info.blockers && info.blockers.length > 0;
      if (info.missing) html = 'Aucun connecteur USB-C sur cette carte';
      else if (info.kind === 'usbc') html = blocked
        ? 'La prise USB-C bute contre ' + info.blockers.map((b) => '<b>' + b.ref + '</b> (' + b.h + ' mm)').join(', ')
        : 'Prise USB-C sur <b>' + info.target + '</b> : surmoulage 12,4 × 6,5 mm dégagé, insertion complète';
      else if (!info.target) html = 'Doigt Ø 12 mm : survolez un bouton ou un potentiomètre' + (info.under.length ? '<br>Contact : ' + info.under.join(', ') : '');
      else html = blocked
        ? 'Accès à <b>' + info.target + '</b> gêné par ' + info.blockers.map((b) => '<b>' + b.ref + '</b> (' + b.h + ' mm)').join(', ') + ', plus haut que le bouton (' + info.targetH + ' mm)'
        : 'Accès à <b>' + info.target + '</b> dégagé, sommet à ' + info.targetH + ' mm, aucun composant plus haut sous le doigt';
      el.innerHTML = html; el.classList.toggle('blocked', !!blocked);
    }
    updateTooltip() {
      const el = $('tooltip'), h = this.hoverInfo;
      if (!h || (!h.pin && !h.comp)) { el.hidden = true; return; }
      let html = '';
      if (h.pin) {
        const node = this.solver.node(h.pin.net);
        html = '<b>' + h.pin.ref + '.' + h.pin.pin + '</b> · ' + (h.pin.net || 'non connectée') + (node !== -2 ? ' · ' + this.solver.vn(node).toFixed(2) + ' V' : '');
      } else {
        const c = h.comp, s = c.sim;
        html = '<b>' + c.ref + '</b> ' + (c.value || '') + ' · ' + c.pkg + (s ? ' · ' + s.temp.toFixed(0) + ' °C · ' + (s.pAvg * 1000).toFixed(s.pAvg < 0.01 ? 1 : 0) + ' mW' : '');
        if (h.action && h.action.type === 'button') html += '<br>maintenir le clic pour appuyer';
        if (h.action && h.action.type === 'pot') html += '<br>molette : ' + Math.round(c.state.alpha * 100) + ' %';
      }
      el.innerHTML = html; el.hidden = false;
      el.style.left = h.x + 'px'; el.style.top = h.y + 'px';
    }

    // --- interface ---
    bindUI() {
      const group = (sel, fn) => document.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => {
        document.querySelectorAll(sel).forEach((x) => x.classList.toggle('active', x === b)); fn(b);
      }));
      group('[data-view]', (b) => this.builder.setView(b.dataset.view));
      group('[data-mode]', (b) => { this.builder.setMode(b.dataset.mode); $('thermalLegend').hidden = b.dataset.mode !== 'thermal'; });
      group('[data-dmm]', (b) => { this.dmmMode = b.dataset.dmm; this.dmmInit = true; });
      $('maskSelect').addEventListener('change', (e) => this.builder.setMask(e.target.value));
      $('gaugeSelect').addEventListener('change', (e) => this.builder.setGauge(e.target.value));

      const psu = this.solver.psu;
      $('psuV').addEventListener('input', (e) => { psu.vset = +e.target.value; $('psuVSet').textContent = psu.vset.toFixed(1) + ' V'; });
      $('psuI').addEventListener('input', (e) => { psu.ilim = +e.target.value; $('psuISet').textContent = psu.ilim.toFixed(2) + ' A'; });
      $('psuOut').addEventListener('click', (e) => { psu.on = !psu.on; psu.mode = 'CV'; e.target.classList.toggle('on', psu.on); e.target.textContent = psu.on ? 'Sortie on' : 'Sortie off'; });

      $('btnProbeReset').addEventListener('click', () => { this.builder.parkProbe('red'); this.builder.parkProbe('black'); });
      $('scopeTime').addEventListener('change', (e) => { this.scope.tdiv = +e.target.value; });
      $('scopeVdiv').addEventListener('change', (e) => { this.scope.vdiv = +e.target.value; });
      $('scopeTrig').addEventListener('change', (e) => { this.scope.trig = e.target.value; });
      $('btnScopeRun').addEventListener('click', () => this.scope.toggle());
      $('btnScopeSingle').addEventListener('click', () => this.scope.arm(this.v1));

      $('fwPreset').addEventListener('change', (e) => { $('fwCode').value = PT.FIRMWARE[e.target.value]; });
      $('btnFlash').addEventListener('click', () => { this.firmware = $('fwCode').value; for (const m of this.solver.mcus) m.flash(this.firmware); this.updateUI(); });
      $('pwmFreq').addEventListener('change', (e) => { for (const m of this.solver.mcus) m.pwmFreq = +e.target.value; });

      const bugs = () => ({ rled: $('bugRled').checked, bridge: $('bugBridge').checked, ledRev: $('bugLedRev').checked, short33: $('bugShort').checked });
      ['bugRled', 'bugBridge', 'bugLedRev', 'bugShort'].forEach((id) => $(id).addEventListener('change', () => {
        if (!this.board.demo) return;
        PT.setBugs(this.board, bugs()); this.loadBoard(this.board); $('diagList').innerHTML = '';
      }));
      $('btnFix').addEventListener('click', () => this.fixBugs());

      const read = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('Lecture impossible : ' + file.name)); fr.readAsText(file); });
      const importBoard = (pnp, net, name) => {
        try {
          const board = PT.buildImportedBoard(pnp, net, name);
          this.loadBoard(board); $('diagList').innerHTML = '';
          $('importStatus').textContent = board.components.length + ' composants placés · carte ' + board.width.toFixed(0) + ' × ' + board.height.toFixed(0) + ' mm · ' +
            (board.hasNets ? this.solver.n + ' nets simulés' + (board.supplyNet ? ' (alim. sur ' + board.supplyNet + ')' : ' (aucun net d\'alimentation reconnu)') : 'sans netlist : rendu 3D seul');
        } catch (err) { $('importStatus').textContent = err.message; }
      };
      $('btnImport').addEventListener('click', async () => {
        const f = $('pnpFile').files[0], n = $('netFile').files[0];
        if (!f) { $('importStatus').textContent = 'Choisissez d\'abord un fichier Pick & Place (.csv ou .pos)'; return; }
        try { importBoard(await read(f), n ? await read(n) : '', f.name.replace(/\.[^.]+$/, '')); } catch (err) { $('importStatus').textContent = err.message; }
      });
      $('btnSample').addEventListener('click', () => importBoard(PT.SAMPLE_PNP, PT.SAMPLE_NET, 'Exemple KiCad'));
      $('btnDemo').addEventListener('click', () => { this.loadBoard(PT.demoBoard()); $('diagList').innerHTML = ''; $('importStatus').textContent = 'Carte de démonstration chargée, 3 bugs d\'origine'; });
      $('meshFile').addEventListener('change', (e) => {
        const f = e.target.files[0]; if (!f) return;
        this.builder.importMesh(f).then((s) => { $('importStatus').textContent = 'Maillage ' + f.name + ' affiché (' + s.x.toFixed(1) + ' × ' + s.y.toFixed(1) + ' × ' + s.z.toFixed(1) + ' mm)'; })
          .catch((err) => { $('importStatus').textContent = err.message; });
      });
      $('btnMeshClear').addEventListener('click', () => { this.builder.clearMesh(); $('meshFile').value = ''; });
    }

    // Diagnostique la carte puis répare les défauts de la carte de démo en un clic
    fixBugs() {
      const found = PT.diagnose(this.board, this.solver), ul = $('diagList');
      const fixOf = (msg) => /dissipe/.test(msg) ? ', remplacée par 150 Ω en 0805' : /Pont/.test(msg) ? ', pont retiré' : /envers/.test(msg) ? ', LED retournée' : '';
      ul.innerHTML = '';
      const add = (txt, cls) => { const li = document.createElement('li'); li.textContent = txt; if (cls) li.className = cls; ul.appendChild(li); };
      if (!found.length) { add('Aucun défaut détecté sur cette carte', 'ok'); return; }
      if (!this.board.demo) { found.forEach((d) => add(d.msg, 'bad')); add('Carte importée : diagnostic seul, à corriger dans votre CAO'); return; }
      found.forEach((d) => add(d.msg + fixOf(d.msg), 'ok'));
      PT.setBugs(this.board, {});
      this.loadBoard(this.board);
      add(found.length + (found.length > 1 ? ' défauts corrigés' : ' défaut corrigé') + ', carte re-simulée', 'ok');
    }

    updateUI() {
      const s = this.solver, psu = s.psu, pr = this.builder.probes, fmt = (v, d) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(d);
      $('psuVDisp').textContent = fmt(psu.v, 2); $('psuIDisp').textContent = fmt(psu.i, 3);
      $('psuP').textContent = (psu.v * psu.i).toFixed(2) + ' W';
      const pm = $('psuMode'); pm.textContent = psu.on ? psu.mode : 'Off'; pm.className = 'led-ind' + (!psu.on ? ' off' : psu.mode === 'CC' ? ' cc' : '');
      $('simInfo').textContent = 't = ' + s.t.toFixed(2) + ' s';
      const m = s.mcus[0], ms = $('mcuStatus');
      ms.textContent = !m ? 'Aucun MCU' : m.error ? 'Erreur : ' + m.error : m.running ? 'En marche' : 'Arrêt';
      ms.className = 'pill' + (m && m.error ? ' err' : m && m.running ? ' run' : '');
      const sc = $('scopeState'); sc.textContent = this.scope.armed ? 'Single' : this.scope.run ? 'Run' : 'Stop'; sc.className = 'led-ind' + (this.scope.run ? '' : ' stop');

      // Sondes + multimètre
      const tr = pr.red.target, tb = pr.black.target, nr = tr ? s.node(tr.net) : -2, nb = tb ? s.node(tb.net) : -2;
      const netName = (t) => t ? (t.net || 'NC') : '—';
      if (tr) this.builder.setProbeLabel('red', netName(tr), nr === -2 ? '---' : this.v1.toFixed(2) + ' V');
      if (tb) this.builder.setProbeLabel('black', netName(tb), nb === -2 ? '---' : this.v2.toFixed(2) + ' V');
      $('dmmProbes').textContent = 'Sonde rouge : ' + (tr ? tr.ref + '.' + tr.pin + ' (' + netName(tr) + ')' : '—') + ' · Sonde noire : ' + (tb ? tb.ref + '.' + tb.pin + ' (' + netName(tb) + ')' : 'GND (réf.)');
      const disp = $('dmmDisp'), unit = $('dmmUnit'), seg = disp.parentElement;
      let beep = false;
      if (this.dmmMode === 'vdc') {
        unit.textContent = 'V DC'; disp.textContent = tr && nr !== -2 ? this.dmmV.toFixed(3) : '----';
      } else {
        const R = tr && tb ? s.measureResistance(tr.net, tb.net) : NaN;
        if (this.dmmMode === 'ohm') {
          if (R !== R) { disp.textContent = '----'; unit.textContent = 'Ω'; }
          else if (!isFinite(R)) { disp.textContent = 'O.L'; unit.textContent = 'MΩ'; }
          else if (R < 1e3) { disp.textContent = R.toFixed(1); unit.textContent = 'Ω'; }
          else if (R < 1e6) { disp.textContent = (R / 1e3).toFixed(2); unit.textContent = 'kΩ'; }
          else { disp.textContent = (R / 1e6).toFixed(2); unit.textContent = 'MΩ'; }
        } else {
          beep = R === R && R < 30; unit.textContent = 'Ω';
          disp.textContent = R !== R ? '----' : beep ? R.toFixed(1) : 'O.L';
        }
      }
      seg.classList.toggle('beep', beep); this.audio.beep(beep);

      const st = this.scope.stats, line = (n, x, name) => 'CH' + n + ' ' + name + (x ? '  moy ' + x.avg.toFixed(2) + ' V  Vpp ' + (x.max - x.min).toFixed(2) + ' V' +
        (x.freq ? '  f ' + (x.freq >= 1000 ? (x.freq / 1000).toFixed(2) + ' kHz' : x.freq.toFixed(0) + ' Hz') + '  α ' + Math.round(x.duty * 100) + ' %' : '') : '');
      $('scopeInfo').textContent = st && (st.s1 || st.s2) ? line(1, st.s1, netName(tr)) + '\n' + line(2, st.s2, netName(tb)) : 'CH1 = sonde rouge · CH2 = sonde noire (référence GND)';

      const hot = s.hottest;
      if (hot) $('hotSpot').textContent = 'Point chaud : ' + hot.ref + ' ' + hot.sim.temp.toFixed(0) + ' °C' + (hot.sim.over ? ' · ' + (hot.sim.pAvg * 1000).toFixed(0) + ' mW > ' + (hot.sim.pmax * 1000).toFixed(0) + ' mW' : '');
      if (this.hoverInfo) this.updateTooltip();
    }

    frame(now) {
      const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000)); this.last = now;
      const s = this.solver, b = this.builder, pr = b.probes;
      // 1) Simulation électrique en temps réel (≈ 333 pas de 50 µs par image)
      this.simAcc += dt;
      let steps = Math.floor(this.simAcc / s.dt);
      if (steps > 1100) { steps = 1100; this.simAcc = 0; } else this.simAcc -= steps * s.dt;
      const n1 = pr.red.target ? s.node(pr.red.target.net) : -2, n2 = pr.black.target ? s.node(pr.black.target.net) : -2;
      let a1 = 0, a2 = 0;
      for (let i = 0; i < steps; i++) {
        s.step();
        const v1 = s.vn(n1), v2 = s.vn(n2);
        this.scope.push(v1, v2); a1 += v1; a2 += v2;
      }
      if (steps) {
        s.updateThermal(dt, steps * s.dt);
        this.v1 = a1 / steps; this.v2 = a2 / steps;
        const dv = this.v1 - this.v2;
        this.dmmV = this.dmmInit ? dv : this.dmmV + (dv - this.dmmV) * Math.min(1, dt / 0.12);
        this.dmmInit = false;
      }
      // 2) Synchronisation 3D : LEDs, courants, surchauffe
      for (const d of s.leds) b.setLed(d.comp.ref, d.iAvg);
      if (b.mode === 'xray') b.setFlow(s.pinCurrents());
      let over = 0;
      for (const c of this.board.components) if (c.sim.over && c.sim.pAvg > c.sim.pmax * 1.3) over = Math.max(over, Math.min(1, c.sim.pAvg / c.sim.pmax - 1));
      this.audio.sizzle(over);
      // 3) Instruments
      this.scope.ch1 = !!pr.red.target; this.scope.ch2 = !!pr.black.target;
      this.scope.draw(pr.red.target ? pr.red.target.net || 'NC' : '', pr.black.target ? pr.black.target.net || 'NC' : '');
      this.uiT += dt; if (this.uiT >= 0.1) { this.uiT = 0; this.updateUI(); }
      // 4) Rendu
      b.update(dt); b.render();
      this.fpsN++; this.fpsT += dt;
      if (this.fpsT >= 0.5) { $('fps').textContent = Math.round(this.fpsN / this.fpsT) + ' FPS'; this.fpsN = 0; this.fpsT = 0; }
    }
  }

  function boot() {
    if (!global.THREE || !PT.Builder || !global.THREE.OrbitControls) {
      const el = $('loadError'); el.hidden = false;
      el.textContent = 'Three.js n\'a pas pu être chargé depuis le CDN. Vérifiez la connexion Internet (nécessaire au premier chargement), puis rechargez la page.';
      return;
    }
    try { PT.app = new App(); }
    catch (err) { const el = $('loadError'); el.hidden = false; el.textContent = 'Erreur d\'initialisation : ' + err.message; console.error(err); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
