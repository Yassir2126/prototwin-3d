/* ProtoTwin 3D — moteur Three.js procédural : scène, matériaux PBR, boîtiers, sondes, fumée, raycasting */
(function (global) {
  'use strict';
  const PT = global.ProtoTwin = global.ProtoTwin || {};
  const THREE = global.THREE;
  if (!THREE) { PT.Builder = null; return; }

  const DEG = Math.PI / 180, T_BOARD = 1.6, T_CU = 0.035;   // mm : 1 unité = 1 mm, axe Z du PCB = axe Y de Three.js
  const MASKS = {
    green: { color: 0x0b6a39, trace: 0x139a55, rough: 0.28, coat: 1.0 },
    black: { color: 0x0f1012, trace: 0x1e2126, rough: 0.92, coat: 0.0 },
    blue:  { color: 0x0f3596, trace: 0x1b56d2, rough: 0.28, coat: 1.0 }
  };

  function canvasTex(w, h, draw) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  function stadium(w, h, path) {
    const s = path || new THREE.Shape(), r = h / 2;
    s.moveTo(-w / 2 + r, -r); s.lineTo(w / 2 - r, -r);
    s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(-w / 2 + r, r);
    s.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    return s;
  }
  function dogleg(A, B) {   // coude à 45° entre deux points [x, z]
    const dx = B[0] - A[0], dz = B[1] - A[1], ax = Math.abs(dx), az = Math.abs(dz);
    if (ax < 0.01 || az < 0.01 || Math.abs(ax - az) < 0.01) return [A, B];
    if (ax > az) return [A, [A[0] + Math.sign(dx) * az, B[1]], B];
    return [A, [B[0], A[1] + Math.sign(dz) * ax], B];
  }
  function rcode(ohm) {     // marquage CMS 3 chiffres
    if (!(ohm > 0)) return '000';
    if (ohm < 10) return String(ohm.toFixed(1)).replace('.', 'R');
    const e = Math.floor(Math.log10(ohm) + 1e-9);
    return String(Math.round(ohm / Math.pow(10, e - 1))) + String(e - 1);
  }

  const FLIR_GLSL = [
    'vec3 flir(float t) {',
    '  t = clamp(t, 0.0, 1.0);',
    '  vec3 c0 = vec3(0.0, 0.0, 0.04), c1 = vec3(0.13, 0.0, 0.45), c2 = vec3(0.75, 0.05, 0.5);',
    '  vec3 c3 = vec3(0.95, 0.35, 0.1), c4 = vec3(1.0, 0.75, 0.1), c5 = vec3(1.0, 1.0, 0.95);',
    '  if (t < 0.15) return mix(c0, c1, t / 0.15);',
    '  if (t < 0.4) return mix(c1, c2, (t - 0.15) / 0.25);',
    '  if (t < 0.6) return mix(c2, c3, (t - 0.4) / 0.2);',
    '  if (t < 0.8) return mix(c3, c4, (t - 0.6) / 0.2);',
    '  return mix(c4, c5, (t - 0.8) / 0.2);',
    '}'
  ].join('\n');
  const THERM_VS = 'varying vec3 vN; varying vec3 vV; varying vec3 vW;\nvoid main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }';
  const THERM_FS = 'uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vW;\n' + FLIR_GLSL +
    '\nvoid main(){ float f = 0.72 + 0.28 * abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(flir(uT) * f, 1.0); }';
  const BOARD_FS = 'uniform vec3 uHot[32]; uniform int uCount; uniform float uBase; varying vec3 vN; varying vec3 vV; varying vec3 vW;\n' + FLIR_GLSL +
    '\nvoid main(){ float t = uBase; for (int i = 0; i < 32; i++) { if (i >= uCount) break; vec2 d = vW.xz - uHot[i].xy; t += uHot[i].z * exp(-dot(d, d) / 22.0); }' +
    ' float f = 0.8 + 0.2 * abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(flir(t) * f, 1.0); }';

  class Builder {
    constructor(container, callbacks) {
      this.container = container; this.cb = callbacks || {};
      const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
      r.outputEncoding = THREE.sRGBEncoding;
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
      container.appendChild(r.domElement);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(38, 1, 1, 1500);
      this.camera.position.set(58, 72, 92);
      this.controls = new THREE.OrbitControls(this.camera, r.domElement);
      this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
      this.controls.minDistance = 12; this.controls.maxDistance = 420;

      this.mode = 'studio'; this.maskName = 'green'; this.gauge = 'none';
      this.geoCache = {}; this.texCache = {};
      this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2(); this.mouseIn = false;
      this.comps = new Map(); this.pickList = []; this.leds = []; this.buttons = new Map(); this.pots = new Map();
      this.flowLinks = []; this.pinI = new Map(); this.tween = null; this.hover = null; this.time = 0;
      this.root = new THREE.Group(); this.scene.add(this.root);

      this._env(); this._lights(); this._materials();
      this._initProbes(); this._initSmoke(); this._initGauges(); this._initEvents();
      this._linearize(this.scene);
      this.resize();
      global.addEventListener('resize', () => this.resize());
    }

    resize() {
      const w = Math.max(2, this.container.clientWidth), h = Math.max(2, this.container.clientHeight);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }

    // Environnement de studio généré en mémoire (PMREM) : indispensable aux reflets métalliques
    _env() {
      const pm = new THREE.PMREMGenerator(this.renderer), s = new THREE.Scene();
      const sky = canvasTex(8, 128, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#59626e'); gr.addColorStop(0.5, '#262b32'); gr.addColorStop(1, '#070809');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      });
      s.add(new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide })));
      const panel = (x, y, z, w, h, k) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
        m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
      };
      panel(-70, 90, 50, 90, 60, 3.2); panel(90, 60, -30, 60, 70, 1.6); panel(0, 110, -80, 120, 30, 2.2);
      this.scene.environment = pm.fromScene(s, 0.03).texture;
      pm.dispose();
    }

    // Éclairage 3 points + ombres portées
    _lights() {
      this.scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x1a1c20, 0.32));
      const key = this.keyLight = new THREE.DirectionalLight(0xfff3e2, 1.15);
      key.position.set(-48, 95, 58); key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.04;
      const sc = key.shadow.camera; sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 260;
      this.scene.add(key);
      const fill = new THREE.DirectionalLight(0xbdd4ff, 0.34); fill.position.set(75, 42, 32); this.scene.add(fill);
      const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(12, 50, -95); this.scene.add(rim);
      const under = new THREE.DirectionalLight(0xdfe8ff, 0.85); under.position.set(25, -90, 45); this.scene.add(under);   // éclaire la face dessous
      const floor = this.floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.95, metalness: 0 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -T_BOARD - 12; floor.receiveShadow = true;
      this.scene.add(floor);
    }

    _materials() {
      const S = (o) => new THREE.MeshStandardMaterial(o), P = (o) => new THREE.MeshPhysicalMaterial(o), k = MASKS[this.maskName];
      const m = this.mat = {
        mask: P({ color: k.color, roughness: k.rough, metalness: 0.05, clearcoat: k.coat, clearcoatRoughness: 0.12 }),
        fr4: S({ color: 0xb9a565, roughness: 0.8 }),
        trace: P({ color: k.trace, roughness: k.rough, metalness: 0.1, clearcoat: k.coat, clearcoatRoughness: 0.12, emissive: 0x000000 }),
        gold: S({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 }),                 // finition ENIG
        goldDS: S({ color: 0xd4af37, metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide }),
        tin: S({ color: 0xcdd2d6, metalness: 0.95, roughness: 0.2 }),
        lead: S({ color: 0xb4b8bf, metalness: 1, roughness: 0.32 }),
        steel: S({ color: 0xd6dadf, metalness: 1, roughness: 0.2 }),
        brass: S({ color: 0xc9a44c, metalness: 0.9, roughness: 0.35 }),
        alu: P({ color: 0xe2e5ea, metalness: 0.9, roughness: 0.28, clearcoat: 0.4, clearcoatRoughness: 0.3 }),
        epoxy: P({ color: 0x2a2c30, roughness: 0.82, metalness: 0, clearcoat: 0.06 }),
        epoxyDark: S({ color: 0x17181b, roughness: 0.9 }),
        black: S({ color: 0x0b0b0d, roughness: 0.55 }),
        ceramic: S({ color: 0xe9e6dc, roughness: 0.7 }),
        resTop: S({ color: 0x131315, roughness: 0.5 }),
        capBody: S({ color: 0xb79f78, roughness: 0.65 }),
        ledBase: S({ color: 0xf1efe6, roughness: 0.6 }),
        green: P({ color: 0x1f9d4d, roughness: 0.45, clearcoat: 0.3 }),
        blue: P({ color: 0x1f55b8, roughness: 0.4, clearcoat: 0.4 }),
        white: S({ color: 0xf2f2ee, roughness: 0.5 }),
        hole: new THREE.MeshBasicMaterial({ color: 0x040405 })
      };
      for (const key in m) this._lin(m[key]);
      this.fadeMats = [m.epoxy, m.epoxyDark, m.black, m.ceramic, m.resTop, m.capBody, m.ledBase, m.green, m.blue, m.white, m.alu];
      this.boardMats = [m.mask, m.fr4];
      const hot = []; for (let i = 0; i < 32; i++) hot.push(new THREE.Vector3());
      this.boardTmat = new THREE.ShaderMaterial({ uniforms: { uHot: { value: hot }, uCount: { value: 0 }, uBase: { value: 0.09 } }, vertexShader: THERM_VS, fragmentShader: BOARD_FS });
    }

    // Three r128 interprète les couleurs hexadécimales comme linéaires : conversion explicite sRGB -> linéaire, une seule fois par matériau
    _lin(mat) {
      if (!mat || mat.userData.lin || mat.isShaderMaterial) return mat;
      mat.userData.lin = true;
      if (mat.color) mat.color.convertSRGBToLinear();
      if (mat.emissive) mat.emissive.convertSRGBToLinear();
      return mat;
    }
    _linearize(root) {
      root.traverse((o) => { if (!o.material) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => this._lin(m)); });
    }
    _geo(key, make) { return this.geoCache[key] || (this.geoCache[key] = make()); }
    _m(parent, geo, mat, x, y, z) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; m.receiveShadow = true;
      parent.add(m); return m;
    }
    // Plan texturé pour sérigraphie / marquage laser
    _text(text, height, color) {
      const key = text + '|' + color;
      let tex = this.texCache[key];
      if (!tex) {
        const probe = document.createElement('canvas').getContext('2d'), font = '600 46px Menlo, Consolas, monospace';
        probe.font = font;
        const w = Math.ceil(probe.measureText(text).width) + 12;
        tex = this.texCache[key] = canvasTex(w, 64, (g) => { g.font = font; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 6, 34); });
        tex.userData = { aspect: w / 64 };
      }
      const m = new THREE.Mesh(new THREE.PlaneGeometry(height * tex.userData.aspect, height),
        new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, roughness: 0.9, metalness: 0 }));
      m.rotation.x = -Math.PI / 2; m.receiveShadow = true;
      return m;
    }

    // ------------------------------------------------------------------ Chargement d'une carte
    loadBoard(board) {
      if (this.boardGroup) {
        this.root.remove(this.boardGroup);
        this.boardGroup.traverse((o) => { if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); });
        for (const k in this.geoCache) this.geoCache[k].dispose();
        this.geoCache = {};
      }
      this.board = board;
      this._setHover(null);
      const g = this.boardGroup = new THREE.Group(); this.root.add(g);
      this.comps = new Map(); this.pickList = []; this.leds = []; this.buttons = new Map(); this.pots = new Map(); this.usbc = null;
      this.compGroup = new THREE.Group(); g.add(this.compGroup);
      for (const c of board.components) this._buildComponent(c);
      g.updateMatrixWorld(true);
      const route = this._route(board);
      this._buildSubstrate(board, route.vias);
      this._buildCopper(route);
      this._buildFlow(route.links);
      this._buildSilk(board);
      this._buildBridges(board);
      g.updateMatrixWorld(true);
      for (const e of this.comps.values()) e.box = new THREE.Box3().setFromObject(e.group);
      this._linearize(g);
      this.setMode(this.mode);
      for (const name in this.probes) {      // ré-accroche les sondes sur la nouvelle géométrie
        const p = this.probes[name], t = p.target, e = t && this.comps.get(t.ref);
        if (e && e.pins[t.pin]) this.placeProbe(name, e.pins[t.pin]); else this.parkProbe(name);
      }
    }

    _buildComponent(c) {
      const g = new THREE.Group(), bottom = c.side === 'bottom';
      g.userData.pins = [];
      (this['_pkg_' + c.pkg] || this._pkg_BOX).call(this, g, c);
      g.position.set(c.x, bottom ? -T_BOARD : 0, -c.y);
      g.rotation.set(0, (c.rot || 0) * DEG, bottom ? Math.PI : 0);
      this.compGroup.add(g); g.updateMatrixWorld(true);
      const e = { c, group: g, pins: {}, meshes: [], box: null, burnShown: 0,
        tmat: new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 } }, vertexShader: THERM_VS, fragmentShader: THERM_FS }) };
      g.traverse((o) => { if (o.isMesh) { o.userData.orig = o.material; o.userData.entry = e; e.meshes.push(o); this.pickList.push(o); } });
      for (const p of g.userData.pins) {
        const w = g.localToWorld(new THREE.Vector3(p.x, 0, p.z));
        const rec = { ref: c.ref, pin: p.name, net: c.pins[p.name] || null, x: w.x, z: w.z, y: bottom ? -T_BOARD - p.top : p.top, pkg: c.pkg, bottom };
        e.pins[p.name] = rec;
        for (const m of p.meshes) m.userData.pinRec = rec;
      }
      this.comps.set(c.ref, e);
    }

    // Routage : chaîne pad→pad par plus proche voisin, coudes à 45°, liaisons longues en face dessous via 2 vias
    _route(board) {
      const nets = new Map(), top = [], bot = [], vias = [], links = [];
      const W = board.width / 2 - 1.2, H = board.height / 2 - 1.2, holes = this._mountHoles(board);
      const addVia = (x, z) => {
        if (Math.abs(x) > W || Math.abs(z) > H) return false;
        for (const v of vias) if (Math.hypot(v[0] - x, v[1] - z) < 1.1) return false;
        for (const h of holes) if (Math.hypot(h[0] - x, h[1] - z) < 3.4) return false;
        vias.push([x, z]); return true;
      };
      for (const e of this.comps.values()) for (const k in e.pins) {
        const p = e.pins[k]; if (!p.net || p.bottom) continue;
        if (!nets.has(p.net)) nets.set(p.net, []);
        nets.get(p.net).push(p);
      }
      for (const [net, pads] of nets) {
        const w = /^(VBUS|VIN|VCC|VDD|\+?\d+V\d*)$/i.test(net) ? 0.55 : 0.25;
        if (PT.GND_RE.test(net)) {             // masse : courte piste vers un via (plan de masse)
          for (const p of pads) {
            if (p.pkg === 'TP') continue;
            const o = this.comps.get(p.ref).group.position;
            let dx = p.x - o.x, dz = p.z - o.z; const L = Math.hypot(dx, dz);
            if (L < 0.05) { dx = 0; dz = 1; } else { dx /= L; dz /= L; }
            const vx = p.x + dx * 1.6, vz = p.z + dz * 1.6;
            if (addVia(vx, vz)) top.push({ pts: [[p.x, p.z], [vx, vz]], w: 0.3 });
          }
          continue;
        }
        const rest = pads.slice().sort((a, b) => a.x - b.x), chain = [rest.shift()];
        while (rest.length) {
          const last = chain[chain.length - 1]; let bi = 0, bd = Infinity;
          rest.forEach((p, i) => { const d = (p.x - last.x) ** 2 + (p.z - last.z) ** 2; if (d < bd) { bd = d; bi = i; } });
          chain.push(rest.splice(bi, 1)[0]);
        }
        for (let i = 0; i < chain.length - 1; i++) {
          const A = chain[i], B = chain[i + 1], d = Math.hypot(B.x - A.x, B.z - A.z);
          const keys = chain.slice(0, i + 1).map((p) => p.ref + '.' + p.pin);
          if (d < 0.05) continue;
          const a = [A.x, A.z], b = [B.x, B.z], ux = (B.x - A.x) / d, uz = (B.z - A.z) / d;
          const va = [A.x + ux * 1.5, A.z + uz * 1.5], vb = [B.x - ux * 1.5, B.z - uz * 1.5];
          let path;
          if (d > 16 && addVia(va[0], va[1])) {
            if (addVia(vb[0], vb[1])) {
              const mid = dogleg(va, vb);
              top.push({ pts: [a, va], w }, { pts: [vb, b], w }); bot.push({ pts: mid, w });
              path = [[a, 0], [va, 0]].concat(mid.map((q) => [q, -T_BOARD]), [[vb, 0], [b, 0]]);
            } else { vias.pop(); }
          }
          if (!path) { const pts = dogleg(a, b); top.push({ pts, w }); path = pts.map((q) => [q, 0]); }
          links.push({ net, keys, pts: path.map((q) => new THREE.Vector3(q[0][0], q[1] === 0 ? 0.3 : q[1] - 0.3, q[0][1])) });
        }
      }
      return { top, bot, vias, links, holes };
    }

    _mountHoles(board) {
      if (board.width < 34 || board.height < 26) return [];
      const x = board.width / 2 - 3.5, z = board.height / 2 - 3.5;
      return [[-x, -z], [x, -z], [x, z], [-x, z]];
    }

    // Substrat FR4 extrudé 1,6 mm, percé des trous de vias et de fixation
    _buildSubstrate(board, vias) {
      const W = board.width, H = board.height, r = Math.min(2.5, W / 8, H / 8), g = this.boardGroup, holes = this._mountHoles(board);
      const s = new THREE.Shape();
      s.moveTo(-W / 2 + r, -H / 2); s.lineTo(W / 2 - r, -H / 2); s.absarc(W / 2 - r, -H / 2 + r, r, -Math.PI / 2, 0, false);
      s.lineTo(W / 2, H / 2 - r); s.absarc(W / 2 - r, H / 2 - r, r, 0, Math.PI / 2, false);
      s.lineTo(-W / 2 + r, H / 2); s.absarc(-W / 2 + r, H / 2 - r, r, Math.PI / 2, Math.PI, false);
      s.lineTo(-W / 2, -H / 2 + r); s.absarc(-W / 2 + r, -H / 2 + r, r, Math.PI, Math.PI * 1.5, false);
      const drill = (x, z, rad) => { const h = new THREE.Path(); h.absarc(x, -z, rad, 0, Math.PI * 2, true); s.holes.push(h); };
      for (const v of vias) drill(v[0], v[1], 0.2);
      for (const h of holes) drill(h[0], h[1], 1.6);
      const geo = new THREE.ExtrudeGeometry(s, { depth: T_BOARD, bevelEnabled: false, curveSegments: 10 });
      geo.rotateX(-Math.PI / 2); geo.translate(0, -T_BOARD, 0);
      this.boardMesh = this._m(g, geo, this.boardMats, 0, 0, 0);

      const vg = this.viaGroup = new THREE.Group(); g.add(vg);
      const barrel = this._geo('viaBarrel', () => new THREE.CylinderGeometry(0.2, 0.2, T_BOARD + 0.06, 14, 1, true));
      const ring = this._geo('viaRing', () => new THREE.RingGeometry(0.2, 0.42, 18));
      const barrels = [], rings = [], d = new THREE.Object3D();
      const plated = (x, z, k) => {
        d.position.set(x, -T_BOARD / 2, z); d.rotation.set(0, 0, 0); d.scale.set(k, 1, k); d.updateMatrix(); barrels.push(d.matrix.clone());
        d.position.set(x, 0.05, z); d.rotation.set(-Math.PI / 2, 0, 0); d.scale.set(k, k, 1); d.updateMatrix(); rings.push(d.matrix.clone());
        d.position.set(x, -T_BOARD - 0.05, z); d.rotation.set(Math.PI / 2, 0, 0); d.updateMatrix(); rings.push(d.matrix.clone());
      };
      for (const v of vias) plated(v[0], v[1], 1);
      const post = this._geo('standoff', () => new THREE.CylinderGeometry(2.4, 2.4, 12, 6));
      for (const h of holes) { plated(h[0], h[1], 8); this._m(g, post, this.mat.brass, h[0], -T_BOARD - 6, h[1]); }
      this._instanced(vg, barrel, this.mat.goldDS, barrels);
      this._instanced(vg, ring, this.mat.gold, rings);
    }
    _instanced(parent, geo, mat, list) {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.receiveShadow = true; im.frustumCulled = false; parent.add(im);
      return im;
    }

    // Pistes de cuivre en relief (35 µm) sous vernis, face dessus et dessous
    _buildCopper(route) {
      const tg = this.traceGroup = new THREE.Group(); this.boardGroup.add(tg);
      const seg = this._geo('traceSeg', () => new THREE.BoxGeometry(1, T_CU, 1));
      const joint = this._geo('traceJoint', () => new THREE.CylinderGeometry(0.5, 0.5, T_CU, 12));
      const segs = [], joints = [], d = new THREE.Object3D();
      const lay = (list, y) => {
        for (const t of list) {
          for (let i = 0; i < t.pts.length; i++) {
            const p = t.pts[i];
            d.position.set(p[0], y, p[1]); d.rotation.set(0, 0, 0); d.scale.set(t.w, 1, t.w); d.updateMatrix(); joints.push(d.matrix.clone());
            if (i === 0) continue;
            const q = t.pts[i - 1], dx = p[0] - q[0], dz = p[1] - q[1], len = Math.hypot(dx, dz);
            if (len < 0.01) continue;
            d.position.set((p[0] + q[0]) / 2, y, (p[1] + q[1]) / 2); d.rotation.set(0, -Math.atan2(dz, dx), 0); d.scale.set(len, 1, t.w); d.updateMatrix();
            segs.push(d.matrix.clone());
          }
        }
      };
      lay(route.top, T_CU / 2);
      lay(route.bot, -T_BOARD - T_CU / 2);
      this._instanced(tg, seg, this.mat.trace, segs);
      this._instanced(tg, joint, this.mat.trace, joints);
    }

    // Sphères lumineuses circulant le long des pistes (vue Rayon X)
    _buildFlow(links) {
      this.flowLinks = [];
      let total = 0;
      for (const l of links) {
        const cum = [0];
        for (let i = 1; i < l.pts.length; i++) cum.push(cum[i - 1] + l.pts[i].distanceTo(l.pts[i - 1]));
        const len = cum[cum.length - 1];
        if (len < 0.6) continue;
        const count = Math.max(1, Math.min(8, Math.round(len / 3.5)));
        this.flowLinks.push({ keys: l.keys, pts: l.pts, cum, len, count, i: 0, phase: Math.random() });
        total += count;
      }
      const im = this.flowMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), Math.max(1, total));
      im.frustumCulled = false; im.visible = false; im.count = total;
      const c = new THREE.Color(0x35d6ff).convertSRGBToLinear(), d = new THREE.Object3D(); d.scale.setScalar(0); d.updateMatrix();
      for (let i = 0; i < total; i++) { im.setMatrixAt(i, d.matrix); im.setColorAt(i, c); }
      this.boardGroup.add(im);
    }

    _buildSilk(board) {
      const sg = this.silkGroup = new THREE.Group(); this.boardGroup.add(sg);
      for (const e of this.comps.values()) {
        const b = new THREE.Box3().setFromObject(e.group), bottom = e.c.side === 'bottom';
        const t = this._text(e.c.ref, 1.25, '#f4f4ec');
        const tw = t.geometry.parameters.width;
        if (e.c.pkg === 'TP') t.position.set(b.max.x + tw / 2 + 0.5, 0.012, (b.min.z + b.max.z) / 2);
        else t.position.set((b.min.x + b.max.x) / 2, 0.012, b.min.z - 0.95);
        if (bottom) { t.position.y = -T_BOARD - 0.012; t.rotation.x = Math.PI / 2; }
        sg.add(t);
      }
      const title = this._text('ProtoTwin 3D  ·  ' + board.name, 1.5, '#f4f4ec');
      title.position.set(board.width * 0.12, 0.012, board.height / 2 - 1.7);
      sg.add(title);
      const back = this._text('BOTTOM  ·  ' + board.name, 2.2, '#f4f4ec');
      back.position.set(0, -T_BOARD - 0.012, 0); back.rotation.x = Math.PI / 2;
      sg.add(back);
    }

    // Ponts de soudure : goutte d'étain reliant deux pastilles voisines
    _buildBridges(board) {
      const geo = this._geo('blob', () => new THREE.SphereGeometry(1, 20, 14));
      for (const b of board.bridges || []) {
        const e = this.comps.get(b.ref); if (!e) continue;
        const p = e.pins[b.pins[0]], q = e.pins[b.pins[1]]; if (!p || !q) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        const m = this._m(this.boardGroup, geo, this.mat.tin, (p.x + q.x) / 2, 0.16, (p.z + q.z) / 2);
        m.scale.set(d / 2 + 0.42, 0.26, Math.min(0.75, 0.3 + d * 0.25)); m.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
        m.userData.entry = e; this.pickList.push(m);
      }
    }

    // ------------------------------------------------------------------ Bibliothèque de boîtiers procéduraux
    // Pastille ENIG cliquable ; chaque broche garde la liste de ses maillages (pastille, patte, soudure)
    _pin(g, name, x, z, w, d, o) {
      o = o || {};
      const geo = o.round ? this._geo('padR', () => new THREE.CylinderGeometry(0.5, 0.5, 0.045, 24)) : this._geo('padB', () => new THREE.BoxGeometry(1, 0.045, 1));
      const pad = this._m(g, geo, this.mat.gold, x, 0.0225, z);
      pad.scale.set(w, 1, d); pad.castShadow = false;
      const rec = { name, x, z, meshes: [pad], top: o.top === undefined ? 0.06 : o.top };
      g.userData.pins.push(rec);
      return rec;
    }
    // Patte « gull-wing » pliée, extrudée depuis son profil
    _gullGeo(len, h, t, w) {
      return this._geo('gull' + [len, h, t, w].join('_'), () => {
        const s = new THREE.Shape();
        s.moveTo(0, h); s.lineTo(len * 0.32, h); s.lineTo(len * 0.58, t); s.lineTo(len, t); s.lineTo(len, 0);
        s.lineTo(len * 0.5, 0); s.lineTo(len * 0.25, h - t); s.lineTo(0, h - t); s.closePath();
        const geo = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
        geo.translate(0, 0, -w / 2);
        return geo;
      });
    }
    // Patte individuelle : (x, z) = sortie du boîtier, rot = direction (0 : +x, π : −x, −π/2 : +z, π/2 : −z)
    _lead(g, name, x, z, rot, len, h, w) {
      const cx = x + Math.cos(rot) * len * 0.66, cz = z - Math.sin(rot) * len * 0.66, horiz = Math.abs(Math.cos(rot)) > 0.5;
      const rec = this._pin(g, name, cx, cz, horiz ? len * 0.8 + 0.5 : w + 0.14, horiz ? w + 0.14 : len * 0.8 + 0.5, { top: 0.2 });
      const m = this._m(g, this._gullGeo(len, h, 0.15, w), this.mat.lead, x, 0.045, z);
      m.rotation.y = rot; rec.meshes.push(m);
      return rec;
    }
    // Corps époxy chanfreiné + repère de broche 1 + marquage laser
    _body(g, bw, bd, bh, so, mark, mat) {
      const ch = Math.min(0.18, bh / 4);
      const geo = this._geo('body' + [bw, bd, bh].join('_'), () => {
        const s = new THREE.Shape(), x = bw / 2 - ch, z = bd / 2 - ch;
        s.moveTo(-x, -z); s.lineTo(x, -z); s.lineTo(x, z); s.lineTo(-x, z); s.closePath();
        const e = new THREE.ExtrudeGeometry(s, { depth: bh - 2 * ch, bevelEnabled: true, bevelThickness: ch, bevelSize: ch, bevelSegments: 1 });
        e.rotateX(-Math.PI / 2); e.translate(0, ch, 0);
        return e;
      });
      const body = this._m(g, geo, mat || this.mat.epoxy, 0, so, 0);
      const r = Math.min(0.35, bw * 0.12);
      const dot = this._m(g, this._geo('dot', () => new THREE.CylinderGeometry(1, 1, 0.02, 20)), this.mat.epoxyDark, -bw / 2 + r * 2.4, so + bh + 0.004, -bd / 2 + r * 2.4);
      dot.scale.set(r, 1, r); dot.castShadow = false;
      if (mark) {
        const t = this._text(mark, Math.min(1.0, bd * 0.2), '#a9adb4');
        const k = Math.min(1, (bw * 0.8) / t.geometry.parameters.width); t.scale.set(k, k, 1);
        t.position.set(0, so + bh + 0.006, 0); g.add(t);
      }
      return body;
    }
    // Boîtier à pattes sur 2 ou 4 côtés, numérotation anti-horaire depuis la broche 1 (coin haut-gauche)
    _gullPkg(g, c, o) {
      this._body(g, o.bw, o.bd, o.bh, o.so, o.mark);
      const h = o.so + o.bh * 0.5, sx = (o.nx - 1) * o.pitch / 2, sz = (o.nz - 1) * o.pitch / 2;
      let n = 1;
      for (let i = 0; i < o.nx; i++) this._lead(g, String(n++), -o.bw / 2, -sx + i * o.pitch, Math.PI, o.ll, h, o.lw);
      for (let i = 0; i < o.nz; i++) this._lead(g, String(n++), -sz + i * o.pitch, o.bd / 2, -Math.PI / 2, o.ll, h, o.lw);
      for (let i = 0; i < o.nx; i++) this._lead(g, String(n++), o.bw / 2, sx - i * o.pitch, 0, o.ll, h, o.lw);
      for (let i = 0; i < o.nz; i++) this._lead(g, String(n++), sz - i * o.pitch, -o.bd / 2, Math.PI / 2, o.ll, h, o.lw);
    }

    _pkg_LQFP32(g, c) { this._gullPkg(g, c, { bw: 7, bd: 7, bh: 1.4, so: 0.1, nx: 8, nz: 8, pitch: 0.8, ll: 1.0, lw: 0.37, mark: c.value || 'LQFP32' }); }
    _pkg_SOIC8(g, c) { this._gullPkg(g, c, { bw: 3.9, bd: 4.9, bh: 1.5, so: 0.15, nx: 4, nz: 0, pitch: 1.27, ll: 1.05, lw: 0.42, mark: c.value || 'SOIC8' }); }
    _pkg_SOT23(g, c) {
      this._body(g, 1.3, 2.9, 0.95, 0.1, null);
      this._lead(g, '1', -0.65, -0.95, Math.PI, 0.6, 0.55, 0.4);
      this._lead(g, '2', -0.65, 0.95, Math.PI, 0.6, 0.55, 0.4);
      this._lead(g, '3', 0.65, 0, 0, 0.6, 0.55, 0.4);
    }
    _pkg_TO252(g, c) {       // DPAK : 1 = GND, 2 = languette (OUT), 3 = IN
      const body = this._body(g, 6.1, 6.6, 2.3, 0.05, c.value || 'DPAK'); body.position.x = 0.3;
      g.children.forEach((o) => { if (o !== body) o.position.x += 0.3; });
      const tab = this._pin(g, '2', 1.0, 0, 7.4, 6.0, { top: 0.55 });
      const t = this._m(g, this._geo('dpakTab', () => new THREE.BoxGeometry(7.0, 0.5, 5.4)), this.mat.tin, 1.05, 0.3, 0);
      tab.meshes.push(t);
      this._lead(g, '1', -2.75, -2.28, Math.PI, 2.5, 1.2, 0.75);
      this._lead(g, '3', -2.75, 2.28, Math.PI, 2.5, 1.2, 0.75);
      this._m(g, this._geo('dpakStub', () => new THREE.BoxGeometry(0.9, 0.5, 0.9)), this.mat.lead, -3.1, 1.2, 0);
    }

    // Résistance / condensateur CMS : corps céramique, terminaisons argentées, ménisques de soudure
    _chip(g, c, L, W, H) {
      const tl = L * 0.22, isR = c.kind === 'R', base = 0.05;
      this._m(g, this._geo('chipB' + [L, W, H].join('_'), () => new THREE.BoxGeometry(L - 2 * tl + 0.02, H, W)), isR ? this.mat.ceramic : this.mat.capBody, 0, base + H / 2, 0);
      if (isR) {
        this._m(g, this._geo('chipT' + [L, W].join('_'), () => new THREE.BoxGeometry(L - 2 * tl, 0.03, W * 0.94)), this.mat.resTop, 0, base + H + 0.012, 0).castShadow = false;
        const t = this._text(rcode(PT.parseValue(c.value, 0)), W * 0.62, '#e8e8e2');
        t.position.set(0, base + H + 0.03, 0); g.add(t);
      }
      const term = this._geo('chipE' + [L, W, H].join('_'), () => new THREE.BoxGeometry(tl, H + 0.03, W + 0.03));
      const fillet = this._geo('chipF' + [W, H].join('_'), () => {
        const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.36, 0); s.quadraticCurveTo(0.1, H * 0.2, 0, H * 0.78); s.closePath();
        const e = new THREE.ExtrudeGeometry(s, { depth: W * 0.92, bevelEnabled: false, curveSegments: 6 }); e.translate(0, 0, -W * 0.46); return e;
      });
      for (const sx of [-1, 1]) {
        const rec = this._pin(g, sx < 0 ? '1' : '2', sx * (L / 2 + 0.08), 0, tl + 0.78, W + 0.32, { top: H * 0.6 });
        rec.meshes.push(this._m(g, term, this.mat.tin, sx * (L / 2 - tl / 2), base + (H + 0.03) / 2 - 0.01, 0));
        const f = this._m(g, fillet, this.mat.tin, sx * (L / 2), 0.045, 0); f.rotation.y = sx < 0 ? Math.PI : 0;
        rec.meshes.push(f);
      }
    }
    _pkg_0603(g, c) { this._chip(g, c, 1.6, 0.8, 0.45); }
    _pkg_0805(g, c) { this._chip(g, c, 2.0, 1.25, 0.55); }

    // LED CMS : lentille translucide émissive + PointLight projetant sa lueur sur le vernis
    _pkg_LED0805(g, c) {
      const col = new THREE.Color(c.params.color === undefined ? 0x30ff70 : c.params.color);
      const body = new THREE.Group(); g.add(body);
      if (c.params.reversed) body.rotation.y = Math.PI;
      this._m(body, this._geo('ledBase', () => new THREE.BoxGeometry(1.5, 0.32, 1.25)), this.mat.ledBase, 0, 0.21, 0);
      this._m(body, this._geo('ledDie', () => new THREE.BoxGeometry(0.34, 0.08, 0.34)), new THREE.MeshStandardMaterial({ color: 0xe7c84a, roughness: 0.4 }), 0, 0.4, 0).castShadow = false;
      const lensMat = new THREE.MeshPhysicalMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.55), transparent: true, opacity: 0.62, roughness: 0.12, metalness: 0, clearcoat: 1, emissive: col, emissiveIntensity: 0 });
      const lens = this._m(body, this._geo('ledLens', () => new THREE.BoxGeometry(1.4, 0.48, 1.12)), lensMat, 0, 0.6, 0); lens.castShadow = false;
      this._m(body, this._geo('ledMark', () => new THREE.BoxGeometry(0.16, 0.02, 1.0)), new THREE.MeshStandardMaterial({ color: 0x1c8a3a, roughness: 0.6 }), 0.56, 0.855, 0).castShadow = false;   // repère cathode
      const term = this._geo('ledTerm', () => new THREE.BoxGeometry(0.3, 0.36, 1.27));
      for (const sx of [-1, 1]) {
        const rec = this._pin(g, sx < 0 ? '1' : '2', sx * 1.08, 0, 1.0, 1.5, { top: 0.3 });
        rec.meshes.push(this._m(g, term, this.mat.tin, sx * 0.88, 0.22, 0));
      }
      let light = null;
      if (this.leds.length < 8) { light = new THREE.PointLight(col.clone().convertSRGBToLinear(), 0, 26, 2); light.position.set(0, 1.6, 0); g.add(light); }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: col, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.position.set(0, 0.9, 0); halo.scale.setScalar(0.01); g.add(halo);
      this.leds.push({ ref: c.ref, light, lensMat, halo, level: 0 });
    }

    // Bouton tactile 6×6 : le piston s'enfonce physiquement (axe Z du PCB)
    _pkg_TACT6(g, c) {
      const a = { type: 'button', ref: c.ref };
      this._m(g, this._geo('tactBody', () => new THREE.BoxGeometry(6, 3.3, 6)), this.mat.epoxyDark, 0, 1.7, 0).userData.action = a;
      this._m(g, this._geo('tactPlate', () => new THREE.BoxGeometry(6.12, 0.25, 6.12)), this.mat.steel, 0, 3.47, 0).userData.action = a;
      const rivet = this._geo('tactRivet', () => new THREE.CylinderGeometry(0.38, 0.38, 0.16, 12));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this._m(g, rivet, this.mat.steel, sx * 2.45, 3.66, sz * 2.45);
      const capMat = new THREE.MeshStandardMaterial({ color: c.params.cap === undefined ? 0x30343a : c.params.cap, roughness: 0.45 });
      const plunger = this._m(g, this._geo('tactPlunger', () => new THREE.CylinderGeometry(1.7, 1.75, 1.35, 28)), capMat, 0, 4.26, 0);
      plunger.userData.action = a;
      this.buttons.set(c.ref, { mesh: plunger, y0: 4.26, travel: 0.5, k: 0, pressed: false });
      this._lead(g, '1', -3, -2.25, Math.PI, 1.0, 1.5, 0.7); this._lead(g, '2', 3, -2.25, 0, 1.0, 1.5, 0.7);
      this._lead(g, '3', -3, 2.25, Math.PI, 1.0, 1.5, 0.7); this._lead(g, '4', 3, 2.25, 0, 1.0, 1.5, 0.7);
    }

    // Potentiomètre ajustable : rotor à fente tournevis, pivote sur son axe à la molette
    _pkg_POT(g, c) {
      const a = { type: 'pot', ref: c.ref };
      this._m(g, this._geo('potBody', () => new THREE.BoxGeometry(6.8, 4.5, 6.8)), this.mat.blue, 0, 2.35, 0).userData.action = a;
      const rotor = new THREE.Group(); rotor.position.y = 4.6; g.add(rotor);
      this._m(rotor, this._geo('potRotor', () => new THREE.CylinderGeometry(2.6, 2.6, 0.7, 32)), this.mat.white, 0, 0.35, 0).userData.action = a;
      this._m(rotor, this._geo('potSlot', () => new THREE.BoxGeometry(4.4, 0.12, 0.55)), this.mat.black, 0, 0.705, 0).userData.action = a;
      this._m(rotor, this._geo('potArrow', () => new THREE.ConeGeometry(0.42, 0.8, 3)), this.mat.brass, 1.9, 0.72, 0.9).rotation.set(Math.PI / 2, 0, -Math.PI / 2);
      this.pots.set(c.ref, { rotor });
      this._lead(g, '1', -2.3, 3.4, -Math.PI / 2, 1.1, 1.4, 0.7);
      this._lead(g, '3', 2.3, 3.4, -Math.PI / 2, 1.1, 1.4, 0.7);
      this._lead(g, '2', 0, -3.4, Math.PI / 2, 1.1, 1.4, 0.7);
    }

    // Connecteur USB-C : coque acier emboutie (ouverture vers −x), languette et contacts
    _pkg_USBC(g, c) {
      const shell = this._geo('usbcShell', () => {
        const s = stadium(8.94, 3.16), hole = new THREE.Path(); stadium(8.34, 2.56, hole); s.holes.push(hole);
        const e = new THREE.ExtrudeGeometry(s, { depth: 7.3, bevelEnabled: false, curveSegments: 10 });
        e.rotateY(Math.PI / 2); e.translate(-3.65, 1.68, 0); return e;
      });
      this._m(g, shell, this.mat.steel, 0, 0, 0);
      this._m(g, this._geo('usbcBack', () => new THREE.BoxGeometry(0.4, 2.9, 8.4)), this.mat.steel, 3.4, 1.68, 0);
      this._m(g, this._geo('usbcTongue', () => new THREE.BoxGeometry(5.4, 0.7, 6.7)), this.mat.black, 0.5, 1.68, 0);
      const ct = this._geo('usbcContact', () => new THREE.BoxGeometry(3.6, 0.04, 0.26));
      for (let i = 0; i < 12; i++) this._m(g, ct, this.mat.gold, -0.2, 2.05, -2.75 + i * 0.5).castShadow = false;
      const vb = this._pin(g, 'VBUS', 4.5, -2.0, 1.5, 0.8), gn = this._pin(g, 'GND', 4.5, 2.0, 1.5, 0.8);
      const small = this._geo('padB', () => new THREE.BoxGeometry(1, 0.045, 1));
      for (let i = -2; i <= 2; i++) { const p = this._m(g, small, this.mat.gold, 4.5, 0.0225, i * 0.6); p.scale.set(1.4, 1, 0.3); p.castShadow = false; }
      const sh = this._pin(g, 'SH', -1.4, -5.0, 2.0, 1.3);
      const p2 = this._m(g, small, this.mat.gold, -1.4, 0.0225, 5.0); p2.scale.set(2.0, 1, 1.3); p2.castShadow = false; sh.meshes.push(p2);
      const leg = this._geo('usbcLeg', () => new THREE.BoxGeometry(1.1, 1.5, 0.3));
      sh.meshes.push(this._m(g, leg, this.mat.steel, -1.4, 0.75, -4.55), this._m(g, leg, this.mat.steel, -1.4, 0.75, 4.55));
      void vb; void gn;
      this.usbc = this.usbc || g;
    }

    // Bornier à vis vert 2 points au pas de 5 mm
    _pkg_TERM2(g, c) {
      const body = this._geo('termBody', () => {
        const s = new THREE.Shape();
        s.moveTo(-3.8, 0); s.lineTo(3.8, 0); s.lineTo(3.8, 10); s.lineTo(0.4, 10); s.lineTo(-1.4, 7.6); s.lineTo(-3.8, 6.6); s.closePath();
        const e = new THREE.ExtrudeGeometry(s, { depth: 10, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 1 });
        e.translate(0, 0.02, -5); return e;
      });
      this._m(g, body, this.mat.green, 0, 0, 0);
      const screw = this._geo('termScrew', () => new THREE.CylinderGeometry(1.45, 1.45, 0.5, 24));
      const slot = this._geo('termSlot', () => new THREE.BoxGeometry(2.7, 0.14, 0.4));
      const entry = this._geo('termEntry', () => new THREE.BoxGeometry(0.12, 3.2, 3.4));
      const clamp = this._geo('termClamp', () => new THREE.BoxGeometry(0.14, 1.2, 2.6));
      [-2.5, 2.5].forEach((z, i) => {
        const rec = this._pin(g, String(i + 1), 5.0, z, 2.0, 1.9, { top: 0.25 });
        rec.meshes.push(this._m(g, screw, this.mat.steel, 2.1, 10.1, z));
        const s = this._m(g, slot, this.mat.black, 2.1, 10.36, z); s.rotation.y = 0.5 + i * 1.3; s.castShadow = false;
        this._m(g, entry, this.mat.black, -3.93, 3.3, z).castShadow = false;
        this._m(g, clamp, this.mat.steel, -3.96, 2.4, z).castShadow = false;
        rec.meshes.push(this._m(g, this._geo('termTail', () => new THREE.BoxGeometry(1.4, 0.5, 0.9)), this.mat.tin, 4.5, 0.28, z));
      });
    }

    // Condensateur électrolytique aluminium CMS (Ø 6,3 mm)
    _pkg_ELEC(g, c) {
      this._m(g, this._geo('elecBase', () => new THREE.BoxGeometry(6.6, 0.9, 6.6)), this.mat.epoxyDark, 0, 0.5, 0);
      this._m(g, this._geo('elecCan', () => new THREE.CylinderGeometry(3.15, 3.15, 6.7, 40)), this.mat.alu, 0, 4.3, 0);
      const stripe = this._m(g, this._geo('elecStripe', () => new THREE.CylinderGeometry(3.17, 3.17, 6.3, 20, 1, true, Math.PI / 2 - 0.55, 1.1)), this.mat.black, 0, 4.3, 0);
      stripe.castShadow = false;
      const vent = this._geo('elecVent', () => new THREE.BoxGeometry(4.6, 0.02, 0.14));
      this._m(g, vent, this.mat.epoxyDark, 0, 7.66, 0).rotation.y = Math.PI / 4;
      this._m(g, vent, this.mat.epoxyDark, 0, 7.66, 0).rotation.y = -Math.PI / 4;
      const t = this._text(c.value || '', 1.3, '#2a2c30'); t.position.set(-0.9, 7.67, 1.6); g.add(t);
      const tab = this._geo('elecTab', () => new THREE.BoxGeometry(1.5, 0.2, 1.2));
      for (const sx of [-1, 1]) {
        const rec = this._pin(g, sx < 0 ? '1' : '2', sx * 3.7, 0, 2.6, 1.7, { top: 0.25 });
        rec.meshes.push(this._m(g, tab, this.mat.tin, sx * 3.6, 0.15, 0));
      }
    }

    _pkg_TP(g, c) { this._pin(g, '1', 0, 0, 1.9, 1.9, { round: true }); }

    _pkg_BOX(g, c) {
      this._body(g, 3, 2, 1.4, 0.05, null);
      this._pin(g, '1', -2.0, 0, 1.2, 1.5, { top: 0.1 }); this._pin(g, '2', 2.0, 0, 1.2, 1.5, { top: 0.1 });
    }

    // ------------------------------------------------------------------ Sondes 3D + câbles souples
    _initProbes() {
      this.probes = {};
      const make = (name, color, parkX, lean) => {
        const g = new THREE.Group(), body = new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 0.5 });
        const tip = this._solo(new THREE.ConeGeometry(0.24, 2.4, 18), this.mat.steel, g, 0, 1.2, 0); tip.rotation.x = Math.PI;
        this._solo(new THREE.CylinderGeometry(0.3, 0.3, 7, 14), this.mat.steel, g, 0, 5.9, 0);
        this._solo(new THREE.CylinderGeometry(1.0, 0.45, 2.0, 20), body, g, 0, 10.4, 0);
        this._solo(new THREE.CylinderGeometry(2.3, 2.3, 0.8, 24), body, g, 0, 11.8, 0);
        this._solo(new THREE.CylinderGeometry(1.5, 1.15, 26, 20), body, g, 0, 25.2, 0);
        this._solo(new THREE.SphereGeometry(1.5, 16, 12), body, g, 0, 38.2, 0);
        g.rotation.set(-0.5, 0, lean);
        this.scene.add(g);
        const cable = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
        cable.castShadow = true; cable.frustumCulled = false; this.scene.add(cable);
        const cv = document.createElement('canvas'); cv.width = 320; cv.height = 112;
        const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        label.scale.set(15, 5.25, 1); label.renderOrder = 20; label.visible = false; this.scene.add(label);
        const park = new THREE.Vector3(parkX * 2.2, 16, -34);
        this.probes[name] = { name, group: g, cable, label, cv, tex, text: '', css: name === 'red' ? '#ff5148' : '#c9d0da',
          pos: park.clone(), goal: park.clone(), park, target: null, last: new THREE.Vector3(1e9, 0, 0), anchor: new THREE.Vector3(parkX * 3.2, -T_BOARD - 11, -110) };
      };
      make('red', 0xd0221c, 14, -0.32);
      make('black', 0x1a1b1e, -14, 0.32);
      const ring = this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 28), new THREE.MeshBasicMaterial({ color: 0xf5b83d, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 15; this.scene.add(ring);
    }
    _solo(geo, mat, parent, x, y, z) { const m = this._m(parent, geo, mat, x, y, z); m.receiveShadow = false; return m; }

    placeProbe(name, rec) {
      const p = this.probes[name]; if (!p || !rec) return;
      p.target = rec; p.goal.set(rec.x, rec.y, rec.z);
    }
    parkProbe(name) { const p = this.probes[name]; p.target = null; p.label.visible = false; p.text = ''; }
    setProbeLabel(name, line1, line2) {
      const p = this.probes[name], txt = line1 + '|' + line2;
      if (!p.target) { p.label.visible = false; return; }
      p.label.visible = true;
      if (txt === p.text) return;
      p.text = txt;
      const g = p.cv.getContext('2d'); g.clearRect(0, 0, 320, 112);
      g.fillStyle = 'rgba(8,12,17,0.9)'; g.strokeStyle = p.css; g.lineWidth = 5;
      g.beginPath(); g.moveTo(16, 4); g.arcTo(316, 4, 316, 108, 14); g.arcTo(316, 108, 4, 108, 14); g.arcTo(4, 108, 4, 4, 14); g.arcTo(4, 4, 316, 4, 14); g.closePath(); g.fill(); g.stroke();
      g.textAlign = 'center'; g.fillStyle = p.css; g.font = '600 30px Menlo, Consolas, monospace'; g.fillText(line1, 160, 42);
      g.fillStyle = '#ffffff'; g.font = '700 40px Menlo, Consolas, monospace'; g.fillText(line2, 160, 90);
      p.tex.needsUpdate = true;
    }
    _updateProbes(dt) {
      const k = 1 - Math.exp(-dt * 11);
      for (const name in this.probes) {
        const p = this.probes[name];
        if (!p.target) p.goal.copy(p.park).setY(p.park.y + Math.sin(this.time * 1.3 + (name === 'red' ? 0 : 1.7)) * 0.9);
        p.pos.lerp(p.goal, k); p.group.position.copy(p.pos);
        p.label.position.set(p.pos.x + (name === 'red' ? 7 : -7), p.pos.y + 6.5, p.pos.z + 2);
        if (p.pos.distanceToSquared(p.last) < 1e-4) continue;
        p.last.copy(p.pos); p.group.updateMatrixWorld(true);
        const end = p.group.localToWorld(new THREE.Vector3(0, 39.5, 0)), out = p.group.localToWorld(new THREE.Vector3(0, 50, 0));
        const mid = end.clone().lerp(p.anchor, 0.55); mid.y = Math.min(end.y, p.anchor.y + 16) - 8;
        const curve = new THREE.CatmullRomCurve3([end, out, mid, p.anchor], false, 'catmullrom', 0.6);
        p.cable.geometry.dispose();
        p.cable.geometry = new THREE.TubeGeometry(curve, 30, 0.55, 7, false);
      }
    }

    // ------------------------------------------------------------------ Fumée volumétrique (sprites) + noircissement
    _initSmoke() {
      const radial = (stops) => canvasTex(64, 64, (g) => {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        stops.forEach((s) => gr.addColorStop(s[0], s[1]));
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      });
      this.glowTex = radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
      const tex = radial([[0, 'rgba(255,255,255,0.9)'], [0.45, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
      this.smoke = []; this.smokeAcc = 0;
      for (let i = 0; i < 80; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x8d8d8d, transparent: true, opacity: 0, depthWrite: false }));
        s.visible = false; this.scene.add(s);
        this.smoke.push({ s, life: 0, max: 0, vx: 0, vy: 0, vz: 0, size: 1, ph: 0 });
      }
    }
    _emitSmoke(x, y, z) {
      const p = this.smoke.find((q) => !q.s.visible); if (!p) return;
      p.s.visible = true; p.s.position.set(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8);
      p.life = 0; p.max = 2.2 + Math.random() * 1.6; p.vy = 7 + Math.random() * 5;
      p.vx = (Math.random() - 0.5) * 2; p.vz = (Math.random() - 0.5) * 2; p.size = 1.2 + Math.random(); p.ph = Math.random() * 6.28;
      const k = 0.25 + Math.random() * 0.35; p.s.material.color.setRGB(k, k, k);
    }
    _updateSmoke(dt) {
      for (const e of this.comps.values()) {         // émission au-dessus des composants en surcharge
        const s = e.c.sim; if (!s || !e.box) continue;
        if (s.over && s.pAvg > s.pmax * 1.3) {
          e.smokeAcc = (e.smokeAcc || 0) + dt * Math.min(30, 6 + (s.pAvg / s.pmax - 1) * 14);
          while (e.smokeAcc >= 1) { e.smokeAcc -= 1; this._emitSmoke((e.box.min.x + e.box.max.x) / 2, e.box.max.y + 0.2, (e.box.min.z + e.box.max.z) / 2); }
        }
        if (Math.abs(s.burnt - e.burnShown) > 0.01) this._applyBurn(e, s.burnt);
      }
      for (const p of this.smoke) {
        if (!p.s.visible) continue;
        p.life += dt; const k = p.life / p.max;
        if (k >= 1) { p.s.visible = false; continue; }
        p.s.position.x += (p.vx + Math.sin(p.life * 2.2 + p.ph) * 1.4) * dt;
        p.s.position.y += p.vy * dt;
        p.s.position.z += (p.vz + Math.cos(p.life * 1.7 + p.ph) * 1.4) * dt;
        p.s.scale.setScalar(p.size * (1 + k * 5.5));
        p.s.material.opacity = this.mode === 'thermal' ? 0 : Math.sin(Math.min(1, k * 5) * Math.PI / 2) * (1 - k) * 0.45;   // la fumée est transparente en infrarouge
      }
    }
    _applyBurn(e, level) {
      if (!e.burnMats) {
        e.burnMats = [];
        for (const m of e.meshes) {
          if (m.userData.pinRec && m.userData.orig === this.mat.gold) continue;      // les pastilles restent dorées
          const mat = m.userData.orig.clone(); m.userData.orig = mat;
          if (this.mode !== 'thermal') m.material = mat;
          e.burnMats.push({ mat, base: mat.color.clone(), rough: mat.roughness === undefined ? 1 : mat.roughness });
        }
      }
      const soot = new THREE.Color(0x010101);
      for (const b of e.burnMats) { b.mat.color.copy(b.base).lerp(soot, level * 0.93); if (b.mat.roughness !== undefined) b.mat.roughness = b.rough + (1 - b.rough) * level; }
      e.burnShown = level;
    }

    // ------------------------------------------------------------------ Gabarits d'ergonomie
    _initGauges() {
      const skin = this.fingerMat = new THREE.MeshPhysicalMaterial({ color: 0xf0b89a, transparent: true, opacity: 0.46, roughness: 0.5, depthWrite: false });
      const f = this.finger = new THREE.Group();
      this._solo(new THREE.CylinderGeometry(6, 6, 46, 32, 1, true), skin, f, 0, 29, 0).castShadow = false;
      this._solo(new THREE.SphereGeometry(6, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin, f, 0, 6, 0).castShadow = false;
      f.visible = false; this.scene.add(f);

      const p = this.plug = new THREE.Group(), inner = new THREE.Group(); p.add(inner); this.plugInner = inner;
      const tipGeo = new THREE.ExtrudeGeometry(stadium(8.25, 2.4), { depth: 6.6, bevelEnabled: false, curveSegments: 10 });
      tipGeo.rotateY(Math.PI / 2);
      this._solo(tipGeo, this.mat.steel, inner, 0, 0, 0);
      const moldMat = this.moldMat = new THREE.MeshPhysicalMaterial({ color: 0x2b3038, transparent: true, opacity: 0.62, roughness: 0.6, depthWrite: false });
      this.mold = this._solo(new THREE.BoxGeometry(22, 6.5, 12.4), moldMat, inner, -11.2, 0, 0);
      const cab = this._solo(new THREE.CylinderGeometry(1.7, 1.7, 30, 16), moldMat, inner, -37, 0, 0); cab.rotation.z = Math.PI / 2;
      p.visible = false; this.scene.add(p);
      this.gaugeKey = '';
    }
    setGauge(kind) {
      this.gauge = kind; this.gaugeKey = '';
      this.finger.visible = false; this.plug.visible = kind === 'usbc' && !!this.usbc;
      if (kind === 'usbc' && !this.usbc) this._gaugeReport({ kind, missing: true });
      if (kind === 'none') this._gaugeReport(null);
    }
    _gaugeReport(info) {
      const key = JSON.stringify(info);
      if (key === this.gaugeKey) return;
      this.gaugeKey = key;
      if (this.cb.onGauge) this.cb.onGauge(info);
    }
    _updateGauges() {
      if (this.gauge === 'finger') {
        this.ray.setFromCamera(this.mouse, this.camera);
        const pt = new THREE.Vector3();
        if (!this.mouseIn || !this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt)) { this.finger.visible = false; return; }
        let tipY = 0, target = null, td = 4.5;
        const touching = [];
        for (const e of this.comps.values()) {
          const b = e.box; if (!b || e.c.side === 'bottom') continue;
          const nx = Math.max(b.min.x, Math.min(pt.x, b.max.x)), nz = Math.max(b.min.z, Math.min(pt.z, b.max.z));
          if ((nx - pt.x) ** 2 + (nz - pt.z) ** 2 > 36) continue;
          touching.push(e); tipY = Math.max(tipY, b.max.y);
          const d = Math.hypot((b.min.x + b.max.x) / 2 - pt.x, (b.min.z + b.max.z) / 2 - pt.z);
          if ((this.buttons.has(e.c.ref) || this.pots.has(e.c.ref)) && d < td) { td = d; target = e; }
        }
        const blockers = target ? touching.filter((e) => e !== target && e.box.max.y > target.box.max.y - 0.3).map((e) => ({ ref: e.c.ref, h: +e.box.max.y.toFixed(1) })) : [];
        this.finger.visible = true; this.finger.position.set(pt.x, tipY + 0.05, pt.z);
        this.fingerMat.color.setHex(blockers.length ? 0xff5040 : target ? 0x58e0a0 : 0xf0b89a).convertSRGBToLinear();
        this._gaugeReport({ kind: 'finger', target: target ? target.c.ref : null, targetH: target ? +target.box.max.y.toFixed(1) : 0, blockers,
          under: touching.filter((e) => e !== target && e.box.max.y > 1).map((e) => e.c.ref) });
      } else if (this.gauge === 'usbc' && this.usbc) {
        const g = this.usbc; g.updateMatrixWorld(true);
        this.plug.position.copy(g.localToWorld(new THREE.Vector3(-3.6, 1.68, 0)));
        this.plug.rotation.y = g.rotation.y;
        const ph = (this.time % 5) / 5, out = ph < 0.3 ? 1 - ph / 0.3 : ph < 0.8 ? 0 : (ph - 0.8) / 0.2;
        this.plugInner.position.x = -out * out * 14;
        this.plug.updateMatrixWorld(true);
        const blockers = [], slide = out * out * 14;      // boîte du surmoulage en position enfichée
        const seated = new THREE.Box3().setFromObject(this.mold).translate(new THREE.Vector3(slide * Math.cos(g.rotation.y), 0, -slide * Math.sin(g.rotation.y)));
        for (const e of this.comps.values()) if (e.group !== g && e.box && e.box.intersectsBox(seated)) blockers.push({ ref: e.c.ref, h: +e.box.max.y.toFixed(1) });
        this.moldMat.color.setHex(blockers.length ? 0xc03a30 : 0x2b3038).convertSRGBToLinear();
        this._gaugeReport({ kind: 'usbc', target: [...this.comps.values()].find((e) => e.group === g).c.ref, blockers });
      }
    }

    // ------------------------------------------------------------------ Modes de rendu
    setMask(name) {
      const k = MASKS[name]; if (!k) return;
      this.maskName = name;
      const m = this.mat.mask; m.color.setHex(k.color).convertSRGBToLinear(); m.roughness = k.rough; m.clearcoat = k.coat;
      this.mat.trace.roughness = k.rough; this.mat.trace.clearcoat = k.coat;
      this.setMode(this.mode);
    }
    setMode(mode) {
      this.mode = mode;
      const th = mode === 'thermal', xr = mode === 'xray', k = MASKS[this.maskName];
      for (const m of [this.mat.mask, this.mat.fr4]) { m.transparent = xr; m.opacity = xr ? 0.2 : 1; m.depthWrite = !xr; m.needsUpdate = true; }
      for (const m of this.fadeMats) { m.transparent = xr; m.opacity = xr ? 0.32 : 1; m.depthWrite = !xr; m.needsUpdate = true; }
      this.mat.trace.color.setHex(xr ? 0xe58a3c : k.trace).convertSRGBToLinear(); this.mat.trace.emissive.setHex(xr ? 0x5a2406 : 0x000000).convertSRGBToLinear();
      this.mat.trace.metalness = xr ? 0.8 : 0.1;
      if (this.boardMesh) { this.boardMesh.material = th ? this.boardTmat : this.boardMats; this.boardMesh.castShadow = !xr; }
      if (this.traceGroup) this.traceGroup.visible = !th;
      if (this.viaGroup) this.viaGroup.visible = !th;
      if (this.silkGroup) this.silkGroup.visible = !th;
      if (this.flowMesh) this.flowMesh.visible = xr;
      for (const e of this.comps.values()) for (const m of e.meshes) m.material = th ? e.tmat : m.userData.orig;
      this.scene.background = th ? new THREE.Color(0x03040a) : null;
      this.floor.visible = !th;
    }
    _updateThermal() {
      const hot = this.boardTmat.uniforms.uHot.value, list = [];
      for (const e of this.comps.values()) {
        const s = e.c.sim; if (!s) continue;
        e.tmat.uniforms.uT.value = Math.min(1, 0.13 + 0.87 * Math.max(0, s.temp - 25) / 115);
        if (s.temp > 26.5) list.push(e);
      }
      list.sort((a, b) => b.c.sim.temp - a.c.sim.temp);
      const n = Math.min(32, list.length);
      for (let i = 0; i < n; i++) { const e = list[i], p = e.group.position; hot[i].set(p.x, p.z, (e.c.sim.temp - 25) / 115 * 0.7); }
      this.boardTmat.uniforms.uCount.value = n;
    }
    _updateFlow(dt) {
      const im = this.flowMesh; if (!im || !im.visible || !im.count) return;
      const d = this._dummy || (this._dummy = new THREE.Object3D()), col = this._col || (this._col = new THREE.Color());
      const pal = this._pal || (this._pal = [0x35d6ff, 0xffb020, 0xff3b28].map((h) => new THREE.Color(h).convertSRGBToLinear())), cold = pal[0], warm = pal[1], hotc = pal[2];
      let idx = 0;
      for (const l of this.flowLinks) {
        let I = 0; for (const key of l.keys) I += this.pinI.get(key) || 0;     // courant du tronçon = somme des injections amont
        l.i += (I - l.i) * Math.min(1, dt * 8);
        const mag = Math.abs(l.i), k = Math.sqrt(Math.min(1, mag / 0.2)), live = mag > 2e-5;
        if (live) l.phase = (((l.phase + Math.sign(l.i) * (5 + 45 * k) * dt / l.len) % 1) + 1) % 1;
        if (k < 0.5) col.copy(cold).lerp(warm, k * 2); else col.copy(warm).lerp(hotc, k * 2 - 2 + 1);
        for (let j = 0; j < l.count; j++) {
          const s = ((l.phase + j / l.count) % 1) * l.len;
          let seg = 1; while (seg < l.cum.length - 1 && l.cum[seg] < s) seg++;
          const a = l.pts[seg - 1], b = l.pts[seg], t = (s - l.cum[seg - 1]) / Math.max(1e-6, l.cum[seg] - l.cum[seg - 1]);
          d.position.lerpVectors(a, b, t); d.scale.setScalar(live ? 0.7 + 1.3 * k : 0); d.updateMatrix();
          im.setMatrixAt(idx, d.matrix); im.setColorAt(idx, col); idx++;
        }
      }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    // ------------------------------------------------------------------ Actionneurs & LEDs (pilotés par le contrôleur)
    setFlow(map) { this.pinI = map; }
    setButton(ref, pressed) { const b = this.buttons.get(ref); if (b) b.pressed = pressed; }
    setPot(ref, alpha) { const p = this.pots.get(ref); if (p) p.rotor.rotation.y = -(alpha - 0.5) * 270 * DEG; }
    setLed(ref, amps) { const l = this.leds.find((x) => x.ref === ref); if (l) l.level = Math.min(1.7, Math.pow(Math.max(0, amps) / 0.02, 0.7)); }
    _updateActuators(dt) {
      for (const b of this.buttons.values()) {
        b.k += ((b.pressed ? 1 : 0) - b.k) * Math.min(1, dt * 40);
        b.mesh.position.y = b.y0 - b.k * b.travel;
      }
      const th = this.mode === 'thermal';
      for (const l of this.leds) {
        l.lensMat.emissiveIntensity = l.level * 2.4;
        if (l.light) l.light.intensity = th ? 0 : l.level * 1.6;
        l.halo.material.opacity = th ? 0 : Math.min(0.85, l.level * 0.55);
        l.halo.scale.setScalar(0.01 + l.level * 5.5);
      }
    }

    // ------------------------------------------------------------------ Caméra
    setView(name) {
      const d = Math.max(this.board ? this.board.width : 80, 60) / 80 * Math.max(104, 172 / this.camera.aspect);   // la carte entière tient dans le cadre, quel que soit son format
      const to = { top: [0, d * 0.95, 0.02], iso: [d * 0.42, d * 0.52, d * 0.66], bottom: [0, -d * 0.95, 0.02] }[name]; if (!to) return;
      this.tween = { t: 0, p0: this.camera.position.clone(), p1: new THREE.Vector3(to[0], to[1], to[2]), t0: this.controls.target.clone(), t1: new THREE.Vector3(0, name === 'bottom' ? -T_BOARD : 0, 0) };
    }
    _updateCamera(dt) {
      const w = this.tween;
      if (w) {
        w.t = Math.min(1, w.t + dt / 0.7);
        const k = w.t * w.t * (3 - 2 * w.t);
        this.camera.position.lerpVectors(w.p0, w.p1, k); this.controls.target.lerpVectors(w.t0, w.t1, k);
        if (w.t >= 1) this.tween = null;
      }
      this.controls.update();
    }

    // ------------------------------------------------------------------ Raycasting : survol, sondes, boutons, potentiomètres
    _initEvents() {
      const el = this.renderer.domElement, box = this.container;
      const setMouse = (e) => {
        const r = el.getBoundingClientRect();
        this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.mx = e.clientX - r.left; this.my = e.clientY - r.top; this.mouseIn = true; this.hoverDirty = true;
      };
      el.addEventListener('pointermove', setMouse);
      el.addEventListener('pointerleave', () => { this.mouseIn = false; this._setHover(null); });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      box.addEventListener('pointerdown', (e) => {
        if (e.target !== el) return;
        setMouse(e); this._pick();
        this.down = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey };
        const a = this.hover && this.hover.action;
        if (a && a.type === 'button' && e.button === 0) {
          this.pressedRef = a.ref; this.controls.enabled = false;
          if (this.cb.onButton) this.cb.onButton(a.ref, true);
        }
      }, true);
      global.addEventListener('pointerup', (e) => {
        if (this.pressedRef) {
          if (this.cb.onButton) this.cb.onButton(this.pressedRef, false);
          this.pressedRef = null; this.controls.enabled = true; this.down = null; return;
        }
        const d = this.down; this.down = null;
        if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
        const h = this.hover;
        if (h && h.pin) {
          const which = d.b === 2 || d.shift ? 'black' : 'red';
          this.placeProbe(which, h.pin);
          if (this.cb.onProbe) this.cb.onProbe(which, h.pin);
        }
      });
      box.addEventListener('wheel', (e) => {
        const a = this.hover && this.hover.action;
        if (a && a.type === 'pot') {
          e.preventDefault(); e.stopPropagation();
          if (this.cb.onPot) this.cb.onPot(a.ref, -Math.sign(e.deltaY) * 0.04);
        }
      }, { capture: true, passive: false });
    }
    _pick() {
      this.hoverDirty = false;
      if (!this.mouseIn) return this._setHover(null);
      this.ray.setFromCamera(this.mouse, this.camera);
      const hit = this.ray.intersectObjects(this.pickList, false)[0];
      if (!hit) return this._setHover(null);
      const u = hit.object.userData;
      this._setHover({ pin: u.pinRec || null, action: u.action || null, entry: u.entry || null, mesh: hit.object });
    }
    _setHover(h) {
      const prev = this.hover; this.hover = h;
      const pin = h && h.pin;
      this.hoverRing.visible = !!pin;
      if (pin) this.hoverRing.position.set(pin.x, pin.y + (pin.bottom ? -0.05 : 0.05), pin.z);
      this.renderer.domElement.style.cursor = h && (h.pin || h.action) ? 'pointer' : '';
      if (!h && !prev) return;
      if (this.cb.onHover) this.cb.onHover(h ? { pin: h.pin, action: h.action, comp: h.entry ? h.entry.c : null, x: this.mx, y: this.my } : null);
    }

    // ------------------------------------------------------------------ Import optionnel d'un maillage STL / OBJ (export KiCad / Altium)
    importMesh(file) {
      return new Promise((resolve, reject) => {
        const isObj = /\.obj$/i.test(file.name), fr = new FileReader();
        fr.onerror = () => reject(new Error('Lecture du fichier impossible.'));
        fr.onload = () => {
          try {
            const mat = new THREE.MeshStandardMaterial({ color: 0x8f96a3, metalness: 0.35, roughness: 0.55, side: THREE.DoubleSide });
            let obj;
            if (isObj) {
              if (!THREE.OBJLoader) throw new Error('OBJLoader indisponible (CDN non chargé).');
              obj = new THREE.OBJLoader().parse(fr.result);
              obj.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; } });
            } else {
              if (!THREE.STLLoader) throw new Error('STLLoader indisponible (CDN non chargé).');
              const geo = new THREE.STLLoader().parse(fr.result); geo.computeVertexNormals();
              obj = new THREE.Mesh(geo, mat); obj.castShadow = true; obj.receiveShadow = true;
            }
            const holder = new THREE.Group(); holder.add(obj);
            obj.rotation.x = -Math.PI / 2;                       // exports CAO : Z vers le haut
            let b = new THREE.Box3().setFromObject(holder), size = b.getSize(new THREE.Vector3());
            const max = Math.max(size.x, size.y, size.z);
            if (max > 0 && max < 2) holder.scale.setScalar(1000);   // fichier en mètres -> mm
            b = new THREE.Box3().setFromObject(holder); const c = b.getCenter(new THREE.Vector3());
            holder.position.set(-c.x, -b.max.y, -c.z);            // dessus du maillage aligné sur la surface du PCB
            this.clearMesh();
            this._linearize(holder);
            this.imported = holder; this.scene.add(holder);
            if (this.boardGroup) this.boardGroup.visible = false;
            size = b.getSize(new THREE.Vector3());
            resolve({ x: size.x, y: size.z, z: size.y });
          } catch (err) { reject(err); }
        };
        if (isObj) fr.readAsText(file); else fr.readAsArrayBuffer(file);
      });
    }
    clearMesh() {
      if (this.imported) { this.scene.remove(this.imported); this.imported.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); this.imported = null; }
      if (this.boardGroup) this.boardGroup.visible = true;
    }

    // ------------------------------------------------------------------ Boucle
    update(dt) {
      this.time += dt;
      this._updateCamera(dt);
      if (this.hoverDirty && !this.pressedRef) this._pick();
      this._updateActuators(dt);
      this._updateProbes(dt);
      this._updateSmoke(dt);
      if (this.mode === 'thermal') this._updateThermal();
      this._updateFlow(dt);
      if (this.gauge !== 'none') this._updateGauges();
    }
    render() { this.renderer.render(this.scene, this.camera); }
  }

  PT.Builder = Builder;
})(typeof window !== 'undefined' ? window : globalThis);
