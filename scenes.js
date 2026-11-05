'use strict';

/* ======================================================================
   Живые фоны для карточек: процедурные SVG-сцены.
   Без картинок — весят ноль и работают офлайн. Сцена и её палитра
   выбираются по id стиха, поэтому у каждого стиха свой постоянный фон.
   ====================================================================== */
const Scenes = (() => {
  const W = 390, H = 844;
  let uid = 0;

  function hash(str) {
    let h = 2166136261;
    for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  const f = (n) => Math.round(n * 10) / 10;
  const pickOf = (r, arr) => arr[Math.floor(r() * arr.length)];

  /* --- общие кирпичики --- */
  function skyGrad(id, stops, y2 = 1) {
    const s = stops.map((c, i) => `<stop offset="${f(i / (stops.length - 1))}" stop-color="${c}"/>`).join('');
    return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="${y2}">${s}</linearGradient>`;
  }
  function glow(id, color, op = 0.6) {
    return `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
  }
  function starsLayer(r, n, yMax, anim, minR = 0.4, maxR = 1.5) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const tw = anim && r() < 0.35;
      out += `<circle cx="${f(r() * W)}" cy="${f(r() * yMax)}" r="${f(minR + r() * r() * (maxR - minR))}" fill="#fff" opacity="${f(0.35 + r() * 0.65)}"${tw ? ` class="tw" style="animation-delay:-${f(r() * 4)}s;animation-duration:${f(2 + r() * 3)}s"` : ''}/>`;
    }
    return out;
  }
  function ridge(r, baseY, amp, steps, color, op = 1) {
    // ломаная линия гор методом смещения средней точки
    let pts = [[0, baseY - r() * amp], [W, baseY - r() * amp]];
    for (let k = 0; k < steps; k++) {
      const next = [];
      const a = amp / Math.pow(1.9, k + 1);
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        next.push(pts[i], [(x1 + x2) / 2, (y1 + y2) / 2 + (r() - 0.55) * a * 2]);
      }
      next.push(pts[pts.length - 1]);
      pts = next;
    }
    const d = 'M0,' + H + ' L' + pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L') + ` L${W},${H} Z`;
    return `<path d="${d}" fill="${color}" opacity="${op}"/>`;
  }
  function smoothHill(r, baseY, amp, color) {
    const n = 3 + Math.floor(r() * 2);
    const step = W / n;
    let d = `M-20,${H} L-20,${f(baseY)}`;
    let x = -20, y = baseY;
    for (let i = 0; i <= n; i++) {
      const nx = -20 + (i + 1) * step + 10, ny = baseY - r() * amp + amp * 0.3;
      d += ` Q${f((x + nx) / 2)},${f(Math.min(y, ny) - amp * (0.3 + r() * 0.5))} ${f(nx)},${f(ny)}`;
      x = nx; y = ny;
    }
    return `<path d="${d} L${W + 20},${H} Z" fill="${color}"/>`;
  }
  function wavePath(baseY, amp, period, phase) {
    let d = `M0,${H} L0,${f(baseY)}`;
    for (let x = 0; x <= W * 2; x += 6) d += ` L${x},${f(baseY + Math.sin((x / period) * Math.PI * 2 + phase) * amp)}`;
    return d + ` L${W * 2},${H} Z`;
  }

  /* --- сцены --- */
  const SCENES = {
    mountains(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#1d2b4f', '#c56f6b', '#f3b37a'], ridges: ['#7a6488', '#54446c', '#332a4c', '#1b1629'], sun: '#ffe2b0' },
        { sky: ['#140f2b', '#4b2a63', '#d26a7c'], ridges: ['#674578', '#46305c', '#2b1f40', '#150f23'], sun: '#ffd1a1' },
        { sky: ['#0f2340', '#3e6e9a', '#a9c7d8'], ridges: ['#5b7c98', '#3e5d78', '#263f57', '#142636'], sun: '#fff3d6' },
        { sky: ['#060a18', '#122042', '#2a3b6a'], ridges: ['#2c3b63', '#1d2a4b', '#121c36', '#090f20'], sun: '#e8eefc', night: true },
      ]);
      const sx = 60 + r() * 270, sy = 250 + r() * 140;
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}${glow(p + 'sun', pal.sun, 0.55)}${skyGrad(p + 'mist', ['rgba(255,255,255,0)', 'rgba(255,255,255,.22)', 'rgba(255,255,255,0)'])}</defs>`;
      out += `<rect width="${W}" height="${H}" fill="url(#${p}sky)"/>`;
      if (pal.night) out += starsLayer(r, 90, 450, anim);
      out += `<circle cx="${f(sx)}" cy="${f(sy)}" r="170" fill="url(#${p}sun)"/><circle cx="${f(sx)}" cy="${f(sy)}" r="${pal.night ? 22 : 30}" fill="${pal.sun}" opacity=".95"/>`;
      pal.ridges.forEach((c, i) => {
        out += ridge(r, 470 + i * 85, 150 - i * 22, 6, c);
        if (i === 1) out += `<rect x="-80" y="${500 + i * 70}" width="${W + 160}" height="120" fill="url(#${p}mist)"${anim ? ' class="drift"' : ''}/>`;
      });
      return out;
    },

    stars(r, p, anim) {
      const pal = pickOf(r, [
        ['#03050d', '#0b1330', '#1b1f4a'], ['#0a0718', '#1d1240', '#3a1d5c'], ['#020a12', '#0b2233', '#174055'],
      ]);
      const angle = -35 + r() * 30;
      let out = `<defs>${skyGrad(p + 'sky', pal)}${glow(p + 'mw', '#c9d6ff', 0.22)}${glow(p + 'mw2', '#ffd7f0', 0.12)}
        <linearGradient id="${p}sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>`;
      out += `<rect width="${W}" height="${H}" fill="url(#${p}sky)"/>`;
      out += `<g transform="rotate(${f(angle)} 195 360)"><ellipse cx="195" cy="360" rx="420" ry="70" fill="url(#${p}mw)"/><ellipse cx="230" cy="350" rx="260" ry="40" fill="url(#${p}mw2)"/></g>`;
      out += starsLayer(r, 170, H - 120, anim, 0.3, 1.7);
      // звёзды гуще вдоль Млечного пути
      let band = '';
      for (let i = 0; i < 90; i++) {
        const t = r() * 840 - 420, off = (r() - 0.5) * 70;
        band += `<circle cx="${f(195 + t)}" cy="${f(360 + off)}" r="${f(0.3 + r() * 0.8)}" fill="#fff" opacity="${f(0.3 + r() * 0.6)}"/>`;
      }
      out += `<g transform="rotate(${f(angle)} 195 360)">${band}</g>`;
      if (anim) out += `<line x1="${f(260 + r() * 100)}" y1="${f(80 + r() * 120)}" x2="${f(340 + r() * 60)}" y2="${f(40 + r() * 80)}" stroke="url(#${p}sh)" stroke-width="1.6" stroke-linecap="round" class="shoot" style="animation-delay:-${f(r() * 7)}s"/>`;
      out += ridge(r, 760, 60, 5, '#05060c');
      return out;
    },

    aurora(r, p, anim) {
      const cols = pickOf(r, [['#5dffb0', '#3fd6c8', '#a87bff'], ['#6dffd2', '#5aa8ff', '#ff7ad9'], ['#7dff8f', '#47e0b0', '#58b4ff']]);
      let out = `<defs>${skyGrad(p + 'sky', ['#020611', '#061a26', '#0a2633', '#0f1d2c'])}`;
      cols.forEach((c, i) => { out += glow(p + 'a' + i, c, 0.55); });
      out += `</defs><rect width="${W}" height="${H}" fill="url(#${p}sky)"/>`;
      out += starsLayer(r, 80, 600, anim, 0.3, 1.2);
      cols.forEach((c, i) => {
        const cy = 220 + i * 90 + r() * 60, rot = -25 + r() * 30;
        out += `<g transform="rotate(${f(rot)} 195 ${f(cy)})"><ellipse cx="${f(150 + r() * 90)}" cy="${f(cy)}" rx="${f(260 + r() * 80)}" ry="${f(45 + r() * 40)}" fill="url(#${p}a${i})"${anim ? ` class="sway" style="animation-duration:${f(9 + r() * 8)}s;animation-delay:-${f(r() * 8)}s"` : ''}/></g>`;
      });
      out += ridge(r, 700, 110, 6, '#071019');
      // ели на переднем плане
      let trees = '';
      for (let x = -10; x < W + 10; x += 12 + r() * 16) {
        const h = 40 + r() * 70, w = h * 0.32, b = 800 + r() * 30;
        trees += `<path d="M${f(x)},${f(b - h)} L${f(x + w)},${f(b)} L${f(x - w)},${f(b)} Z"/>`;
      }
      out += `<g fill="#03070c">${trees}</g><rect y="820" width="${W}" height="30" fill="#03070c"/>`;
      return out;
    },

    sea(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#1b1036', '#7a3b6b', '#f08a5d', '#ffd08a'], sea: ['#5a2f55', '#1d1330'], sun: '#ffe1a8' },
        { sky: ['#071226', '#173a63', '#3d6f9a'], sea: ['#173556', '#081627'], sun: '#eef4ff', moon: true },
        { sky: ['#2a3d6b', '#9a88b8', '#f6c3a8'], sea: ['#5d6f9a', '#25335a'], sun: '#fff1d8' },
      ]);
      const hz = 520, sx = 110 + r() * 170;
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}${skyGrad(p + 'sea', pal.sea)}${glow(p + 'sun', pal.sun, 0.6)}</defs>`;
      out += `<rect width="${W}" height="${hz}" fill="url(#${p}sky)"/>`;
      if (pal.moon) out += starsLayer(r, 70, 380, anim);
      out += `<circle cx="${f(sx)}" cy="${hz - 40}" r="190" fill="url(#${p}sun)"/><circle cx="${f(sx)}" cy="${hz - (pal.moon ? 160 : 6)}" r="${pal.moon ? 20 : 46}" fill="${pal.sun}"/>`;
      out += `<rect y="${hz}" width="${W}" height="${H - hz}" fill="url(#${p}sea)"/>`;
      // солнечная дорожка
      for (let i = 0; i < 14; i++) {
        const y = hz + 10 + i * 22 + r() * 8, w = 70 - i * 2.5 + r() * 30;
        out += `<rect x="${f(sx - w / 2 + (r() - 0.5) * 30)}" y="${f(y)}" width="${f(w)}" height="2.4" rx="1.2" fill="${pal.sun}" opacity="${f(0.55 - i * 0.03)}"${anim ? ` class="shimmer" style="animation-delay:-${f(r() * 2.4)}s"` : ''}/>`;
      }
      [[hz + 70, 6, 130, 0.18], [hz + 150, 9, 195, 0.28], [hz + 250, 12, 390, 0.45]].forEach(([y, a, per, op], i) => {
        out += `<path d="${wavePath(y, a, per, r() * 6)}" fill="${pal.sea[1]}" opacity="${op}"${anim ? ` class="wave" style="animation-duration:${14 - i * 3}s"` : ''}/>`;
      });
      return out;
    },

    bokeh(r, p, anim) {
      const pal = pickOf(r, [
        { bg: ['#1f0e05', '#5c2c10', '#a86a2c'], lights: ['#ffd59a', '#ffb36b', '#fff1c9'] },
        { bg: ['#1f0816', '#5a2140', '#a85470'], lights: ['#ffc2d6', '#ffd9a8', '#fff0f4'] },
        { bg: ['#06161c', '#11414c', '#2f7a7a'], lights: ['#bff8ff', '#ffe8a8', '#d6fff0'] },
      ]);
      let out = `<defs>${skyGrad(p + 'bg', pal.bg)}`;
      pal.lights.forEach((c, i) => {
        out += `<radialGradient id="${p}l${i}"><stop offset="0" stop-color="${c}" stop-opacity=".32"/><stop offset=".78" stop-color="${c}" stop-opacity=".22"/><stop offset=".92" stop-color="${c}" stop-opacity=".34"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
      });
      out += `</defs><rect width="${W}" height="${H}" fill="url(#${p}bg)"/>`;
      for (let i = 0; i < 22; i++) {
        const rr = 12 + r() * r() * 75;
        out += `<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${f(rr)}" fill="url(#${p}l${Math.floor(r() * 3)})"${anim ? ` class="float" style="animation-duration:${f(7 + r() * 9)}s;animation-delay:-${f(r() * 9)}s"` : ''}/>`;
      }
      return out;
    },

    rays(r, p, anim) {
      const pal = pickOf(r, [
        { bg: ['#fbd9a0', '#c97a4a', '#4a2340', '#1c0f24'], ray: '#fff6dc' },
        { bg: ['#d8ecff', '#6f9ccf', '#26406e', '#0d1830'], ray: '#ffffff' },
        { bg: ['#ffe9b8', '#9fb06a', '#3c5a3a', '#142416'], ray: '#fffbe6' },
      ]);
      let out = `<defs>${skyGrad(p + 'bg', pal.bg)}${glow(p + 'g', pal.ray, 0.75)}</defs><rect width="${W}" height="${H}" fill="url(#${p}bg)"/>`;
      let rays = '';
      const n = 13;
      for (let i = 0; i < n; i++) {
        const a = (-70 + (140 / (n - 1)) * i + (r() - 0.5) * 6) * Math.PI / 180, spread = (1.5 + r() * 3) * Math.PI / 180, L = 1100;
        const x1 = 195 + Math.sin(a - spread) * L, y1 = -40 + Math.cos(a - spread) * L;
        const x2 = 195 + Math.sin(a + spread) * L, y2 = -40 + Math.cos(a + spread) * L;
        rays += `<path d="M195,-40 L${f(x1)},${f(y1)} L${f(x2)},${f(y2)} Z" opacity="${f(0.05 + r() * 0.09)}"/>`;
      }
      out += `<g fill="${pal.ray}"${anim ? ' class="spin"' : ''}>${rays}</g>`;
      out += `<circle cx="195" cy="-40" r="330" fill="url(#${p}g)"/>`;
      for (let i = 0; i < (anim ? 36 : 20); i++) {
        out += `<circle cx="${f(r() * W)}" cy="${f(120 + r() * 650)}" r="${f(0.8 + r() * 1.6)}" fill="${pal.ray}" opacity=".7"${anim ? ` class="dust" style="animation-duration:${f(9 + r() * 10)}s;animation-delay:-${f(r() * 18)}s"` : ''}/>`;
      }
      return out;
    },

    hills(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#26375e', '#8aa0c8', '#f0d2b8'], hills: ['#7d93a6', '#5d7a6e', '#3f5c52', '#22382f'], sun: '#fff0d0' },
        { sky: ['#2b1d3f', '#a35d6a', '#f2b880'], hills: ['#9a6f86', '#6e4c6c', '#46304f', '#261a30'], sun: '#ffe0b0' },
        { sky: ['#0f2c3a', '#4f8f8f', '#e8d9a8'], hills: ['#8aa38a', '#5f8466', '#3d6049', '#1f3628'], sun: '#fff6d6' },
      ]);
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}${glow(p + 'sun', pal.sun, 0.65)}${glow(p + 'cl', '#ffffff', 0.5)}</defs><rect width="${W}" height="${H}" fill="url(#${p}sky)"/>`;
      const sx = 80 + r() * 230;
      out += `<circle cx="${f(sx)}" cy="420" r="200" fill="url(#${p}sun)"/><circle cx="${f(sx)}" cy="440" r="34" fill="${pal.sun}"/>`;
      for (let i = 0; i < 4; i++) {
        const cx = r() * W, cy = 120 + r() * 220, w = 90 + r() * 90;
        out += `<g${anim ? ` class="drift" style="animation-duration:${f(30 + r() * 30)}s;animation-delay:-${f(r() * 30)}s"` : ''} opacity=".55"><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(w)}" ry="${f(w * 0.28)}" fill="url(#${p}cl)"/><ellipse cx="${f(cx + w * 0.3)}" cy="${f(cy - w * 0.12)}" rx="${f(w * 0.55)}" ry="${f(w * 0.26)}" fill="url(#${p}cl)"/></g>`;
      }
      pal.hills.forEach((c, i) => { out += smoothHill(r, 520 + i * 80, 90 - i * 10, c); });
      return out;
    },

    clouds(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#16244a', '#3c5a92', '#9bb5dd'], cl: '#ffffff' },
        { sky: ['#3b2a4a', '#c0786a', '#f6c58f'], cl: '#ffe9d6' },
        { sky: ['#1a1433', '#5b4a8a', '#c9a6d8'], cl: '#f4e8ff' },
      ]);
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}${glow(p + 'c', pal.cl, 0.55)}${glow(p + 'sun', '#fff3d0', 0.5)}</defs><rect width="${W}" height="${H}" fill="url(#${p}sky)"/>`;
      out += `<circle cx="${f(60 + r() * 270)}" cy="${f(560 + r() * 120)}" r="260" fill="url(#${p}sun)"/>`;
      for (let i = 0; i < 9; i++) {
        const cy = 60 + i * 90 + r() * 40, cx = r() * W, w = 120 + r() * 140;
        let blobs = '';
        for (let k = 0; k < 4; k++) blobs += `<ellipse cx="${f(cx + (k - 1.5) * w * 0.35)}" cy="${f(cy + (r() - 0.5) * 30)}" rx="${f(w * (0.35 + r() * 0.25))}" ry="${f(w * (0.16 + r() * 0.1))}" fill="url(#${p}c)"/>`;
        out += `<g opacity="${f(0.45 + r() * 0.4)}"${anim ? ` class="drift" style="animation-duration:${f(25 + r() * 35)}s;animation-delay:-${f(r() * 30)}s"` : ''}>${blobs}</g>`;
      }
      return out;
    },
  };

  /* ================= библейские сцены ================= */

  // Силуэт фигуры в длинной одежде. Локальные координаты: 60×150, ступни на y=150.
  function figure(x, baseY, s, color, { arms = 'down', halo = null, staff = false } = {}) {
    let d = 'M24,22 C20,23 17,26 15,31 L11,70 C10,90 8,120 6,150 L54,150 C52,120 50,90 49,70 L45,31 C43,26 40,23 36,22 Z';
    if (arms === 'open') d += ' M17,30 C10,38 4,50 0,60 L5,63 C10,55 16,47 21,42 Z M43,30 C50,38 56,50 60,60 L55,63 C50,55 44,47 39,42 Z';
    if (arms === 'wide') d += ' M17,30 C9,32 2,31 -6,28 L-6,33 C2,37 10,39 19,41 Z M43,30 C51,32 58,31 66,28 L66,33 C58,37 50,39 41,41 Z';
    let out = `<g transform="translate(${f(x - 30 * s)} ${f(baseY - 150 * s)}) scale(${s})">`;
    if (halo) out += `<circle cx="30" cy="13" r="26" fill="url(#${halo})"/>`;
    if (staff) out += `<path d="M52,150 L50,42 C49,30 58,26 62,34" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>`;
    out += `<circle cx="30" cy="12.5" r="8.5" fill="${color}"/><path d="${d}" fill="${color}"/></g>`;
    return out;
  }
  function sheep(x, y, s, color, flip = false) {
    return `<g transform="translate(${f(x)} ${f(y)}) scale(${flip ? -s : s} ${s})" fill="${color}">
      <ellipse cx="0" cy="0" rx="11" ry="7"/><ellipse cx="11" cy="-3" rx="4.2" ry="3.4"/>
      <rect x="-7" y="4" width="1.8" height="7"/><rect x="5" y="4" width="1.8" height="7"/></g>`;
  }
  function onion(cx, by, w, h) {
    return `M${f(cx - w / 2)},${f(by)} C${f(cx - w * 0.62)},${f(by - h * 0.35)} ${f(cx - w * 0.62)},${f(by - h * 0.58)} ${f(cx - w * 0.22)},${f(by - h * 0.76)}`
      + ` C${f(cx - w * 0.07)},${f(by - h * 0.86)} ${f(cx)},${f(by - h * 0.9)} ${f(cx)},${f(by - h)}`
      + ` C${f(cx)},${f(by - h * 0.9)} ${f(cx + w * 0.07)},${f(by - h * 0.86)} ${f(cx + w * 0.22)},${f(by - h * 0.76)}`
      + ` C${f(cx + w * 0.62)},${f(by - h * 0.58)} ${f(cx + w * 0.62)},${f(by - h * 0.35)} ${f(cx + w / 2)},${f(by)} Z`;
  }
  // православный крест
  function oCross(cx, topY, s, color) {
    const w = 1.6 * s;
    return `<g fill="${color}"><rect x="${f(cx - w / 2)}" y="${f(topY)}" width="${f(w)}" height="${f(22 * s)}"/>`
      + `<rect x="${f(cx - 3 * s)}" y="${f(topY + 3 * s)}" width="${f(6 * s)}" height="${f(1.3 * s)}"/>`
      + `<rect x="${f(cx - 5.5 * s)}" y="${f(topY + 7 * s)}" width="${f(11 * s)}" height="${f(1.5 * s)}"/>`
      + `<rect x="${f(cx - 4 * s)}" y="${f(topY + 15 * s)}" width="${f(8 * s)}" height="${f(1.4 * s)}" transform="rotate(-18 ${f(cx)} ${f(topY + 15.7 * s)})"/></g>`;
  }
  function latinCross(cx, baseY, h, color) {
    const w = h * 0.075;
    return `<g fill="${color}"><rect x="${f(cx - w / 2)}" y="${f(baseY - h)}" width="${f(w)}" height="${f(h)}"/>`
      + `<rect x="${f(cx - h * 0.3)}" y="${f(baseY - h * 0.78)}" width="${f(h * 0.6)}" height="${f(w)}"/></g>`;
  }
  function palm(x, baseY, h, color, lean) {
    const tx = x + lean, ty = baseY - h;
    let out = `<path d="M${f(x - 3)},${baseY} Q${f(x + lean * 0.3)},${f(baseY - h * 0.5)} ${f(tx - 1.5)},${f(ty)} L${f(tx + 1.5)},${f(ty)} Q${f(x + lean * 0.3 + 4)},${f(baseY - h * 0.5)} ${f(x + 3)},${baseY} Z" fill="${color}"/>`;
    for (let a = -150; a <= -30; a += 24) {
      const rad = a * Math.PI / 180, L = h * 0.42;
      const ex = tx + Math.cos(rad) * L, ey = ty + Math.sin(rad) * L * 0.55 + L * 0.35;
      out += `<path d="M${f(tx)},${f(ty)} Q${f((tx + ex) / 2)},${f(ty - L * 0.25)} ${f(ex)},${f(ey)} Q${f((tx + ex) / 2)},${f(ty - L * 0.12)} ${f(tx)},${f(ty + 3)} Z" fill="${color}"/>`;
    }
    return out;
  }

  Object.assign(SCENES, {
    // Христос идёт по водам
    walkwater(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#030712', '#0b1d3a', '#1c3d66'], sea: ['#0f2a4a', '#040d1c'], moon: '#f3f1e6' },
        { sky: ['#0a0716', '#1f1440', '#45306e'], sea: ['#25184a', '#0a0716'], moon: '#fbeedd' },
      ]);
      const hz = 560, mx = 120 + r() * 150;
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}${skyGrad(p + 'sea', pal.sea)}${glow(p + 'moon', pal.moon, 0.45)}${glow(p + 'halo', '#ffe6a8', 0.9)}${glow(p + 'aura', '#ffe6a8', 0.35)}</defs>`;
      out += `<rect width="${W}" height="${hz}" fill="url(#${p}sky)"/>` + starsLayer(r, 110, hz - 60, anim);
      out += `<circle cx="${f(mx)}" cy="150" r="150" fill="url(#${p}moon)"/><circle cx="${f(mx)}" cy="150" r="24" fill="${pal.moon}"/>`;
      out += `<rect y="${hz}" width="${W}" height="${H - hz}" fill="url(#${p}sea)"/>`;
      for (let i = 0; i < 12; i++) {
        const y = hz + 12 + i * 20, w = 50 + r() * 50 - i * 2;
        out += `<rect x="${f(mx - w / 2 + (r() - 0.5) * 30)}" y="${f(y)}" width="${f(w)}" height="2" rx="1" fill="${pal.moon}" opacity="${f(0.4 - i * 0.025)}"${anim ? ` class="shimmer" style="animation-delay:-${f(r() * 2.4)}s"` : ''}/>`;
      }
      out += `<circle cx="195" cy="${hz + 40}" r="170" fill="url(#${p}aura)"/>`;
      // отражение
      out += `<g opacity=".22" transform="translate(0 ${2 * (hz + 100)}) scale(1 -1)">${figure(195, hz + 100, 1.1, '#0a1222')}</g>`;
      out += `<g${anim ? ' class="bob"' : ''}>${figure(195, hz + 100, 1.1, '#0a1222', { arms: 'open', halo: p + 'halo' })}</g>`;
      [[hz + 115, 5, 130, 0.5], [hz + 175, 8, 195, 0.6], [hz + 250, 11, 390, 0.75]].forEach(([y, a, per, op], i) => {
        out += `<path d="${wavePath(y, a, per, r() * 6)}" fill="${pal.sea[1]}" opacity="${op}"${anim ? ` class="wave" style="animation-duration:${15 - i * 3}s"` : ''}/>`;
      });
      return out;
    },

    // Добрый Пастырь
    shepherd(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#2a3a64', '#c48a7a', '#f7d4a2'], hills: ['#8c8a9a', '#5f6b62', '#3c4a3e', '#1e2a22'], sun: '#fff1cf', fig: '#141c16' },
        { sky: ['#1d2b4a', '#6f8fb8', '#e7e1c8'], hills: ['#7e93a2', '#56786a', '#38584a', '#1b2e25'], sun: '#fffbe8', fig: '#102018' },
      ]);
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}${glow(p + 'sun', pal.sun, 0.7)}${glow(p + 'cl', '#ffffff', 0.45)}${glow(p + 'halo', '#fff0c0', 0.8)}</defs><rect width="${W}" height="${H}" fill="url(#${p}sky)"/>`;
      const sx = 230 + r() * 80;
      out += `<circle cx="${f(sx)}" cy="440" r="230" fill="url(#${p}sun)"/><circle cx="${f(sx)}" cy="455" r="36" fill="${pal.sun}"/>`;
      for (let i = 0; i < 3; i++) {
        const cx = r() * W, cy = 110 + r() * 200, w = 90 + r() * 70;
        out += `<g opacity=".5"${anim ? ` class="drift" style="animation-duration:${f(35 + r() * 25)}s;animation-delay:-${f(r() * 30)}s"` : ''}><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(w)}" ry="${f(w * 0.25)}" fill="url(#${p}cl)"/></g>`;
      }
      pal.hills.slice(0, 3).forEach((c, i) => { out += smoothHill(r, 540 + i * 70, 80 - i * 10, c); });
      // передний холм, на котором стоит пастырь
      out += `<path d="M-20,${H} L-20,700 Q90,640 200,672 Q300,700 410,690 L410,${H} Z" fill="${pal.hills[3]}"/>`;
      out += figure(120, 668, 0.9, pal.fig, { staff: true, halo: p + 'halo' });
      [[175, 690, 1.1, false], [215, 700, 1.0, true], [250, 712, 1.15, false], [158, 715, 0.95, true], [290, 724, 1.05, true]].forEach(([x, y, s, fl]) => {
        out += sheep(x, y, s * 1.35, pal.fig, fl);
      });
      return out;
    },

    // Голгофа: три креста на закате
    golgotha(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#1a0d1f', '#5e1f33', '#c4553f', '#f2a35e'], ground: '#120a10', ray: '#ffd9a0' },
        { sky: ['#0d0b1d', '#2f2350', '#8a4a6e', '#e59a7a'], ground: '#0b0912', ray: '#ffe3c4' },
      ]);
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}${glow(p + 'g', pal.ray, 0.7)}</defs><rect width="${W}" height="${H}" fill="url(#${p}sky)"/>`;
      let rays = '';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + r() * 0.2, sp = 0.05 + r() * 0.04, L = 900;
        rays += `<path d="M195,470 L${f(195 + Math.cos(a - sp) * L)},${f(470 + Math.sin(a - sp) * L)} L${f(195 + Math.cos(a + sp) * L)},${f(470 + Math.sin(a + sp) * L)} Z" opacity="${f(0.05 + r() * 0.07)}"/>`;
      }
      out += `<g fill="${pal.ray}"${anim ? ' class="spin2"' : ''}>${rays}</g><circle cx="195" cy="470" r="260" fill="url(#${p}g)"/>`;
      for (let i = 0; i < 4; i++) {
        const cy = 160 + r() * 220, cx = r() * W, w = 110 + r() * 90;
        out += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(w)}" ry="${f(w * 0.12)}" fill="${pal.sky[0]}" opacity=".35"${anim ? ` class="drift" style="animation-duration:${f(40 + r() * 30)}s"` : ''}/>`;
      }
      out += `<path d="M-20,${H} L-20,700 Q110,690 160,628 Q195,600 230,628 Q290,690 410,700 L410,${H} Z" fill="${pal.ground}"/>`;
      out += latinCross(195, 630, 150, pal.ground) + latinCross(122, 668, 104, pal.ground) + latinCross(268, 668, 104, pal.ground);
      return out;
    },

    // Православный храм
    church(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#18213f', '#6b5b8a', '#e9a77c', '#f9d9a6'], wall: '#efe6d6', shade: '#c9bba5', dome: ['#ffe39a', '#c98d2c'], ground: '#2c2a26', win: '#5a4a3a', night: false },
        { sky: ['#030713', '#0d1a36', '#20345e'], wall: '#1a2233', shade: '#141b29', dome: ['#e8c574', '#8a6320'], ground: '#05080f', win: '#ffd889', night: true },
        { sky: ['#2a466e', '#8fb0d6', '#e6eef4'], wall: '#f4f1ea', shade: '#d4cec2', dome: ['#7fb2d8', '#2f5f8a'], ground: '#3b4a3a', win: '#4a5560', night: false },
      ]);
      const by = 640;
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}<linearGradient id="${p}dome" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${pal.dome[1]}"/><stop offset=".45" stop-color="${pal.dome[0]}"/><stop offset="1" stop-color="${pal.dome[1]}"/></linearGradient>${glow(p + 'win', '#ffd27a', 0.8)}${glow(p + 'sun', '#fff1d0', 0.55)}</defs>`;
      out += `<rect width="${W}" height="${H}" fill="url(#${p}sky)"/>`;
      if (pal.night) out += starsLayer(r, 120, 520, anim) + `<circle cx="300" cy="150" r="18" fill="#f2efe4"/>`;
      else out += `<circle cx="${f(60 + r() * 60)}" cy="470" r="200" fill="url(#${p}sun)"/>`;
      const c = pal.wall, sh = pal.shade, D = `url(#${p}dome)`;
      // колокольня
      out += `<rect x="78" y="468" width="38" height="${by - 468}" fill="${sh}"/><path d="M74,470 L97,395 L120,470 Z" fill="${D}"/>`;
      out += `<rect x="90" y="378" width="14" height="18" fill="${sh}"/><path d="${onion(97, 380, 14, 26)}" fill="${D}"/>` + oCross(97, 330, 1.1, pal.dome[1]);
      out += `<rect x="89" y="490" width="16" height="26" rx="8" fill="${pal.win}"/>`;
      // основной объём
      out += `<rect x="130" y="520" width="140" height="${by - 520}" fill="${c}"/><rect x="130" y="512" width="140" height="10" fill="${sh}"/>`;
      // боковые главки
      [152, 248].forEach((x) => {
        out += `<rect x="${x - 9}" y="488" width="18" height="26" fill="${c}"/><path d="${onion(x, 490, 18, 34)}" fill="${D}"/>` + oCross(x, 440, 0.9, pal.dome[1]);
      });
      // центральный барабан и купол
      out += `<rect x="176" y="452" width="38" height="64" fill="${c}"/><rect x="176" y="452" width="38" height="6" fill="${sh}"/>`;
      out += `<path d="${onion(195, 456, 38, 70)}" fill="${D}"/>` + oCross(195, 352, 1.5, pal.dome[1]);
      // окна (ночью горят)
      const wins = [[186, 470], [199, 470], [142, 548], [168, 548], [222, 548], [248, 548]];
      wins.forEach(([x, y]) => {
        if (pal.night) out += `<circle cx="${x + 2.5}" cy="${y + 10}" r="18" fill="url(#${p}win)" opacity=".7"${anim ? ` class="flick" style="animation-delay:-${f(r() * 3)}s"` : ''}/>`;
        out += `<rect x="${x}" y="${y}" width="${x > 180 && y < 500 ? 5 : 10}" height="${y < 500 ? 20 : 26}" rx="${y < 500 ? 2.5 : 5}" fill="${pal.win}"/>`;
      });
      out += `<path d="M186,${by} L186,594 Q200,576 214,594 L214,${by} Z" fill="${pal.win}"/>`;
      // земля и деревья
      out += `<path d="M-20,${H} L-20,${by} Q195,${by - 14} 410,${by} L410,${H} Z" fill="${pal.ground}"/>`;
      let trees = '';
      [[22, 1.1], [48, 0.8], [330, 1.0], [360, 1.25], [300, 0.7]].forEach(([x, s]) => {
        trees += `<ellipse cx="${x}" cy="${f(by - 30 * s)}" rx="${f(18 * s)}" ry="${f(34 * s)}"/><rect x="${x - 2}" y="${f(by - 6 * s)}" width="4" height="${f(8 * s)}"/>`;
      });
      out += `<g fill="${pal.night ? '#04070d' : pal.ground}" opacity=".95">${trees}</g>`;
      return out;
    },

    // Вифлеемская звезда
    bethlehem(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#02040c', '#0b1430', '#26305a'], land: ['#1a1830', '#0d0c1a'], star: '#fff6dc' },
        { sky: ['#06030f', '#1a0f33', '#3d2a5c'], land: ['#20183a', '#0d0a18'], star: '#fff1d6' },
      ]);
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}${glow(p + 'st', pal.star, 0.75)}${glow(p + 'st2', '#cfd8ff', 0.25)}</defs><rect width="${W}" height="${H}" fill="url(#${p}sky)"/>`;
      out += starsLayer(r, 150, 600, anim, 0.3, 1.3);
      const sx = 240, sy = 230;
      out += `<circle cx="${sx}" cy="${sy}" r="240" fill="url(#${p}st2)"/>`;
      out += `<g${anim ? ' class="pulse"' : ''}><circle cx="${sx}" cy="${sy}" r="90" fill="url(#${p}st)"/>`;
      out += `<path d="M${sx},${sy - 120} L${sx + 6},${sy - 6} L${sx},${sy + 210} L${sx - 6},${sy - 6} Z M${sx - 70},${sy} L${sx - 4},${sy - 4} L${sx + 70},${sy} L${sx - 4},${sy + 4} Z" fill="${pal.star}" opacity=".85"/>`;
      out += `<path d="M${sx - 30},${sy - 30} L${sx},${sy - 3} L${sx + 30},${sy - 30} L${sx + 3},${sy} L${sx + 30},${sy + 30} L${sx},${sy + 3} L${sx - 30},${sy + 30} L${sx - 3},${sy} Z" fill="${pal.star}" opacity=".5"/><circle cx="${sx}" cy="${sy}" r="7" fill="#fff"/></g>`;
      out += ridge(r, 650, 70, 5, pal.land[0]);
      // город
      let town = '';
      const houses = [[96, 26, 30], [124, 34, 22], [152, 22, 40], [178, 30, 28], [210, 40, 36], [246, 26, 24], [270, 34, 32]];
      houses.forEach(([x, w, h]) => { town += `<rect x="${x}" y="${700 - h}" width="${w}" height="${h + 20}"/>`; });
      town += `<path d="${onion(229, 664, 24, 26)}"/>`;
      out += `<g fill="${pal.land[1]}">${town}</g>`;
      [[128, 682], [176, 678], [222, 688], [258, 684]].forEach(([x, y]) => {
        out += `<rect x="${x}" y="${y}" width="4" height="6" fill="#ffcf7a" opacity=".85"${anim ? ` class="flick" style="animation-delay:-${f(r() * 3)}s"` : ''}/>`;
      });
      out += palm(60, 720, 110, pal.land[1], 14) + palm(330, 716, 90, pal.land[1], -10) + palm(352, 724, 70, pal.land[1], 8);
      out += `<rect y="715" width="${W}" height="${H - 715}" fill="${pal.land[1]}"/>`;
      return out;
    },

    // Ковчег и радуга
    ark(r, p, anim) {
      const pal = pickOf(r, [
        { sky: ['#4a5f86', '#9fb6cf', '#f1e6cf'], sea: ['#3e5f7a', '#1d3346'], hull: '#3a2618' },
        { sky: ['#2e3b5e', '#7d8fb3', '#e8d3b8'], sea: ['#344a6a', '#162238'], hull: '#2c1c12' },
      ]);
      const hz = 560;
      let out = `<defs>${skyGrad(p + 'sky', pal.sky)}${skyGrad(p + 'sea', pal.sea)}${glow(p + 'cl', '#ffffff', 0.5)}${glow(p + 'sun', '#fff6dd', 0.6)}</defs>`;
      out += `<rect width="${W}" height="${hz}" fill="url(#${p}sky)"/><circle cx="300" cy="200" r="200" fill="url(#${p}sun)"/>`;
      const cols = ['#ff6b6b', '#ffa95c', '#ffe066', '#7ddc8a', '#62b6ff', '#6f7dff', '#b47cff'];
      cols.forEach((c, i) => {
        const rr = 300 - i * 9;
        out += `<path d="M${f(195 - rr)},${hz} A${rr},${rr} 0 0 1 ${f(195 + rr)},${hz}" fill="none" stroke="${c}" stroke-width="9" opacity=".32"/>`;
      });
      for (let i = 0; i < 4; i++) {
        const cx = r() * W, cy = 90 + r() * 150, w = 100 + r() * 80;
        out += `<g opacity=".6"${anim ? ` class="drift" style="animation-duration:${f(30 + r() * 30)}s"` : ''}><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(w)}" ry="${f(w * 0.26)}" fill="url(#${p}cl)"/></g>`;
      }
      out += `<rect y="${hz}" width="${W}" height="${H - hz}" fill="url(#${p}sea)"/>`;
      const ax = 195, ay = hz + 40;
      out += `<g${anim ? ' class="bob"' : ''} fill="${pal.hull}">
        <path d="M${ax - 110},${ay - 22} L${ax + 110},${ay - 22} L${ax + 86},${ay + 14} L${ax - 86},${ay + 14} Z"/>
        <rect x="${ax - 60}" y="${ay - 56}" width="120" height="36"/>
        <path d="M${ax - 70},${ay - 56} L${ax},${ay - 80} L${ax + 70},${ay - 56} Z"/>
        <rect x="${ax - 40}" y="${ay - 46}" width="10" height="10" fill="#e9c98a" opacity=".6"/><rect x="${ax + 10}" y="${ay - 46}" width="10" height="10" fill="#e9c98a" opacity=".6"/></g>`;
      [[hz + 70, 5, 130, 0.45], [hz + 140, 8, 195, 0.6], [hz + 230, 11, 390, 0.75]].forEach(([y, a, per, op], i) => {
        out += `<path d="${wavePath(y, a, per, r() * 6)}" fill="${pal.sea[1]}" opacity="${op}"${anim ? ` class="wave" style="animation-duration:${14 - i * 3}s"` : ''}/>`;
      });
      return out;
    },

    // Свечи
    candles(r, p, anim) {
      const pal = pickOf(r, [
        { bg: ['#0b0603', '#1f1006', '#2e1a0b'], wax: ['#f5ead2', '#cdb894'] },
        { bg: ['#07040c', '#1a0f22', '#2c1830'], wax: ['#f3e7dc', '#c9b1a0'] },
      ]);
      let out = `<defs>${skyGrad(p + 'bg', pal.bg)}${glow(p + 'gl', '#ffb347', 0.55)}${glow(p + 'core', '#fff3c4', 1)}
        <linearGradient id="${p}wax" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${pal.wax[1]}"/><stop offset=".4" stop-color="${pal.wax[0]}"/><stop offset="1" stop-color="${pal.wax[1]}"/></linearGradient>
        <radialGradient id="${p}fl" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#fffbe6"/><stop offset=".45" stop-color="#ffd36b"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient></defs>`;
      out += `<rect width="${W}" height="${H}" fill="url(#${p}bg)"/>`;
      for (let i = 0; i < 12; i++) {
        out += `<circle cx="${f(r() * W)}" cy="${f(r() * 560)}" r="${f(8 + r() * 30)}" fill="#ffb347" opacity="${f(0.04 + r() * 0.06)}"${anim ? ` class="float" style="animation-duration:${f(8 + r() * 8)}s;animation-delay:-${f(r() * 8)}s"` : ''}/>`;
      }
      const base = 720;
      [[120, 150, 22], [195, 220, 26], [272, 120, 20]].forEach(([x, h, w], i) => {
        const top = base - h;
        out += `<circle cx="${x}" cy="${top - 30}" r="${150 + i * 10}" fill="url(#${p}gl)"${anim ? ` class="glowp" style="animation-delay:-${f(r() * 2)}s"` : ''}/>`;
        out += `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="3" fill="url(#${p}wax)"/>`;
        out += `<path d="M${x - w / 2},${top + 4} q${w * 0.2},-6 ${w * 0.5},-2 q${w * 0.3},4 ${w * 0.5},-2 L${x + w / 2},${top + 10} L${x - w / 2},${top + 10} Z" fill="${pal.wax[0]}"/>`;
        out += `<rect x="${x - 0.8}" y="${top - 9}" width="1.6" height="10" fill="#2a1a0a"/>`;
        out += `<g${anim ? ` class="flame" style="animation-delay:-${f(r() * 1.5)}s"` : ''}><path d="M${x},${top - 46} C${x + 9},${top - 26} ${x + 10},${top - 12} ${x},${top - 6} C${x - 10},${top - 12} ${x - 9},${top - 26} ${x},${top - 46} Z" fill="url(#${p}fl)"/>`;
        out += `<ellipse cx="${x}" cy="${top - 15}" rx="3.2" ry="6" fill="url(#${p}core)"/></g>`;
      });
      out += `<rect y="${base}" width="${W}" height="${H - base}" fill="#0a0503" opacity=".85"/>`;
      return out;
    },

    // Голубь в лучах света
    dove(r, p, anim) {
      const pal = pickOf(r, [
        { bg: ['#fbe7b8', '#d99a66', '#6b3d5a', '#231633'], ray: '#fff8e1' },
        { bg: ['#e8f1ff', '#8fb3dd', '#3c5a8c', '#141f3b'], ray: '#ffffff' },
      ]);
      let out = `<defs>${skyGrad(p + 'bg', pal.bg)}${glow(p + 'g', pal.ray, 0.85)}${glow(p + 'cl', '#ffffff', 0.4)}${glow(p + 'aura', '#ffffff', 0.5)}</defs><rect width="${W}" height="${H}" fill="url(#${p}bg)"/>`;
      let rays = '';
      for (let i = 0; i < 15; i++) {
        const a = (-75 + i * (150 / 14) + (r() - 0.5) * 6) * Math.PI / 180, sp = (1.5 + r() * 3) * Math.PI / 180, L = 1100;
        rays += `<path d="M195,-60 L${f(195 + Math.sin(a - sp) * L)},${f(-60 + Math.cos(a - sp) * L)} L${f(195 + Math.sin(a + sp) * L)},${f(-60 + Math.cos(a + sp) * L)} Z" opacity="${f(0.05 + r() * 0.08)}"/>`;
      }
      out += `<g fill="${pal.ray}"${anim ? ' class="spin"' : ''}>${rays}</g><circle cx="195" cy="-60" r="340" fill="url(#${p}g)"/>`;
      for (let i = 0; i < 5; i++) {
        const cx = r() * W, cy = 560 + r() * 220, w = 120 + r() * 90;
        out += `<g opacity=".45"${anim ? ` class="drift" style="animation-duration:${f(30 + r() * 30)}s"` : ''}><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(w)}" ry="${f(w * 0.22)}" fill="url(#${p}cl)"/></g>`;
      }
      const dx = 200, dy = 330;
      out += `<circle cx="${dx}" cy="${dy - 20}" r="120" fill="url(#${p}aura)"/>`;
      out += `<g${anim ? ' class="bob"' : ''} transform="translate(${dx} ${dy}) scale(1.6)" fill="#ffffff">
        <path d="M0,-5 C-25,-35 -35,-50 -52,-56 C-38,-30 -22,-12 -8,-2 Z" opacity=".8"/>
        <path d="M-30,0 C-15,-9 15,-9 30,-3 C20,7 -10,9 -30,0 Z"/>
        <path d="M-30,0 L-47,-7 L-45,7 Z"/>
        <circle cx="31" cy="-5" r="6"/><path d="M36,-6 L43,-4 L36,-2 Z" fill="#e9b26a"/>
        <path d="M-6,-5 C-10,-40 12,-62 34,-72 C22,-46 16,-22 10,-4 Z"/></g>`;
      return out;
    },
  });

  const NAMES = Object.keys(SCENES);

  // Сцены, которые больше подходят к теме стиха (остальное — случайно из всех)
  const BY_TOPIC = {
    jesus: ['walkwater', 'shepherd', 'golgotha', 'dove'],
    prayer: ['candles', 'church', 'stars', 'dove'],
    faith: ['walkwater', 'church', 'bethlehem', 'dove'],
    hope: ['ark', 'rays', 'bethlehem', 'mountains'],
    forgiveness: ['golgotha', 'dove', 'rays', 'sea'],
    comfort: ['shepherd', 'candles', 'sea', 'hills'],
    peace: ['hills', 'sea', 'shepherd', 'clouds'],
    love: ['golgotha', 'bokeh', 'rays', 'candles'],
    thanks: ['church', 'rays', 'hills', 'ark'],
    wisdom: ['stars', 'candles', 'mountains', 'aurora'],
    strength: ['mountains', 'ark', 'golgotha', 'aurora'],
    anxiety: ['walkwater', 'shepherd', 'candles', 'clouds'],
  };

  function pick(id, topic) {
    const h = hash(id);
    const pref = BY_TOPIC[topic];
    if (pref && ((h >>> 4) % 10) < 7) return { name: pref[h % pref.length], seed: h };
    return { name: NAMES[h % NAMES.length], seed: h };
  }

  /** SVG-разметка сцены. animated=false — статичный кадр (для картинки «Поделиться»). */
  function svg(id, { animated = true, standalone = false, scene = null, topic = null } = {}) {
    const { name, seed } = scene && SCENES[scene] ? { name: scene, seed: hash(id) } : pick(id, topic);
    const p = 'sc' + (++uid) + '-';
    const body = SCENES[name](rng(seed), p, animated);
    const size = standalone ? ` width="${W}" height="${H}"` : '';
    return `<svg class="scene" data-scene="${name}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"${size} aria-hidden="true">${body}</svg>`;
  }

  /** Картинка сцены (для canvas). */
  function image(id, topic) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(id, { animated: false, standalone: true, topic }));
    });
  }

  return { svg, image, pick, names: NAMES, W, H };
})();
