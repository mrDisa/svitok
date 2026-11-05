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
  const NAMES = Object.keys(SCENES);

  function pick(id) {
    const h = hash(id);
    return { name: NAMES[h % NAMES.length], seed: h };
  }

  /** SVG-разметка сцены. animated=false — статичный кадр (для картинки «Поделиться»). */
  function svg(id, { animated = true, standalone = false, scene = null } = {}) {
    const { name, seed } = scene && SCENES[scene] ? { name: scene, seed: hash(id) } : pick(id);
    const p = 'sc' + (++uid) + '-';
    const body = SCENES[name](rng(seed), p, animated);
    const size = standalone ? ` width="${W}" height="${H}"` : '';
    return `<svg class="scene" data-scene="${name}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"${size} aria-hidden="true">${body}</svg>`;
  }

  /** Картинка сцены (для canvas). */
  function image(id) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(id, { animated: false, standalone: true }));
    });
  }

  return { svg, image, pick, W, H };
})();
