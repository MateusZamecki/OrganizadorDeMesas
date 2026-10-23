const CHAIR_WIDTH = 0.6;  // espaço de cada cadeira em volta da mesa (m)
const CHAIR_DEPTH = 0.5;  // quanto a cadeira ocupa para fora da mesa (m)
const SVG_NS = 'http://www.w3.org/2000/svg';

let state = load() || {
  room: { w: 20, h: 12 },
  spacing: 0.8,
  nextNum: 1,
  tables: [],
  obstacles: [{ id: 1, name: 'Palco', x: 7, y: 0, w: 6, h: 3 }],
};
let positions = {}; // id da mesa -> {x, y}

// Formato do salão: polígono dentro da área de largura × comprimento.
const SHAPES = {
  rect: [[0, 0], [1, 0], [1, 1], [0, 1]],
  L: [[0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]],
  U: [[0, 0], [0.3, 0], [0.3, 0.6], [0.7, 0.6], [0.7, 0], [1, 0], [1, 1], [0, 1]],
  T: [[0, 0], [1, 0], [1, 0.4], [0.7, 0.4], [0.7, 1], [0.3, 1], [0.3, 0.4], [0, 0.4]],
};
const setShape = (name) => {
  state.room.points = SHAPES[name].map(([x, y]) => ({ x: x * state.room.w, y: y * state.room.h }));
};
if (!state.room.points) setShape('rect');

const $ = (id) => document.getElementById(id);
const svg = $('room');

function load() {
  try { return JSON.parse(localStorage.getItem('organizador-mesas')); } catch { return null; }
}
function save() {
  try { localStorage.setItem('organizador-mesas', JSON.stringify(state)); } catch {}
}

// ---------- Geometria ----------

const tableRadius = (chairs) => Math.max(0.4, (chairs * CHAIR_WIDTH) / (2 * Math.PI));
const footprint = (chairs) => tableRadius(chairs) + CHAIR_DEPTH;

function distToRect(x, y, o) {
  const dx = Math.max(o.x - x, 0, x - (o.x + o.w));
  const dy = Math.max(o.y - y, 0, y - (o.y + o.h));
  return Math.hypot(dx, dy);
}

function distToSegment(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

function insideRoom(x, y) {
  const pts = state.room.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToWalls(x, y) {
  const pts = state.room.points;
  return Math.min(...pts.map((a, i) => distToSegment(x, y, a, pts[(i + 1) % pts.length])));
}

// Menor folga até paredes, áreas bloqueadas e outras mesas (negativa = inválido).
// A folga até a parede vale em dobro, para que a distância à parede fique ~metade do corredor entre mesas.
function clearance(x, y, r, others) {
  if (!insideRoom(x, y)) return -Infinity;
  const s = state.spacing;
  let min = 2 * (distToWalls(x, y) - r) + s;
  for (const o of state.obstacles) min = Math.min(min, distToRect(x, y, o) - r);
  for (const p of others) min = Math.min(min, Math.hypot(x - p.x, y - p.y) - r - p.r);
  return min - s;
}

// ---------- Organização automática ----------

function arrange() {
  const step = 0.1;
  const { w, h } = state.room;
  const pinned = state.tables.filter((t) => t.pinned);
  const sorted = state.tables.filter((t) => !t.pinned).sort((a, b) => b.chairs - a.chairs);
  // Mesas movidas manualmente ficam fixas e as outras se ajustam em volta delas.
  const placed = pinned.map((t) => ({ id: t.id, x: t.x, y: t.y, r: footprint(t.chairs), fixed: true }));
  positions = {};

  // 1) Encaixe guloso: cada mesa (maiores primeiro) vai na primeira posição livre.
  for (const t of sorted) {
    const r = footprint(t.chairs);
    search:
    for (let y = r; y <= h - r; y += step) {
      for (let x = r; x <= w - r; x += step) {
        if (clearance(x, y, r, placed) >= 0) {
          placed.push({ id: t.id, x, y, r });
          break search;
        }
      }
    }
  }

  // 2) Espalha as mesas pelo salão, aumentando a folga de cada uma enquanto possível.
  const dirs = [...Array(8)].map((_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
  for (const move of [1, 0.5, 0.25, 0.1, 0.05]) {
    for (let iter = 0; iter < 25; iter++) {
      let moved = false;
      for (const p of placed) {
        if (p.fixed) continue;
        const others = placed.filter((q) => q !== p);
        let best = clearance(p.x, p.y, p.r, others);
        for (const [dx, dy] of dirs) {
          const nx = p.x + dx * move, ny = p.y + dy * move;
          const c = clearance(nx, ny, p.r, others);
          if (c > best + 1e-6) { best = c; p.x = nx; p.y = ny; moved = true; }
        }
      }
      if (!moved) break;
    }
  }

  for (const p of placed) positions[p.id] = { x: p.x, y: p.y };
}

// ---------- Desenho ----------

function el(name, attrs, parent) {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}

function draw() {
  const { w, h } = state.room;
  svg.setAttribute('viewBox', `-0.5 -0.5 ${w + 1} ${h + 1}`);
  svg.innerHTML = '';
  const pts = state.room.points;
  el('polygon', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), fill: '#fbf8f1', stroke: '#c9bfae', 'stroke-width': 0.08, 'stroke-linejoin': 'round' }, svg);

  for (const o of state.obstacles) {
    const g = el('g', { class: 'obstacle' }, svg);
    el('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: '#e9e1d2', stroke: '#c9b89a', 'stroke-width': 0.05, rx: 0.12 }, g);
    el('text', { x: o.x + o.w / 2, y: o.y + o.h / 2, 'font-size': 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#7a6c58', 'font-family': 'Inter, sans-serif', 'font-weight': 600 }, g).textContent = o.name;
    g.addEventListener('pointerdown', (e) => startDrag(e, o, 0, state.room.w - o.w, 0, state.room.h - o.h));
  }

  for (const t of state.tables) {
    const p = positions[t.id];
    if (!p) continue;
    const r = tableRadius(t.chairs);
    const g = el('g', { class: 'table' }, svg);
    for (let i = 0; i < t.chairs; i++) {
      const a = (i / t.chairs) * 2 * Math.PI;
      el('circle', { cx: p.x + Math.cos(a) * (r + 0.25), cy: p.y + Math.sin(a) * (r + 0.25), r: 0.2, fill: '#7d9a8c', stroke: '#fff', 'stroke-width': 0.04 }, g);
    }
    el('circle', { cx: p.x, cy: p.y, r, fill: t.pinned ? '#f6e3c6' : '#fff', stroke: '#b5793a', 'stroke-width': 0.07 }, g);
    el('text', { x: p.x, y: p.y, 'font-size': 0.3, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-weight': 600, 'font-family': 'Inter, sans-serif', fill: '#5a4026' }, g).textContent = tableName(t);
    g.addEventListener('pointerdown', (e) => {
      t.x = p.x; t.y = p.y; t.pinned = true;
      const fr = footprint(t.chairs);
      startDrag(e, t, fr, state.room.w - fr, fr, state.room.h - fr);
    });
  }

  // Paredes: duplo clique numa parede cria um novo canto.
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'wall', stroke: 'transparent', 'stroke-width': 0.5 }, svg);
    line.addEventListener('dblclick', (e) => {
      const p = toRoom(e);
      pts.splice(i + 1, 0, { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
      update();
    });
  });

  // Cantos: arraste para mover, duplo clique para remover.
  for (const p of pts) {
    const c = el('circle', { cx: p.x, cy: p.y, r: 0.22, class: 'corner', fill: '#fff', stroke: '#b5793a', 'stroke-width': 0.07 }, svg);
    c.addEventListener('pointerdown', (e) => startDrag(e, p, 0, state.room.w, 0, state.room.h));
    c.addEventListener('dblclick', () => {
      if (pts.length > 3) { pts.splice(pts.indexOf(p), 1); update(); }
    });
  }
}

const tableName = (t) => t.name ?? `Mesa ${t.num}`;

function toRoom(ev) {
  const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return { x: pt.x, y: pt.y };
}

// ---------- Arrastar mesas, áreas bloqueadas e cantos do salão ----------

function startDrag(e, o, minX, maxX, minY, maxY) {
  const start = toRoom(e), ox = o.x, oy = o.y;
  const onMove = (ev) => {
    const p = toRoom(ev);
    o.x = Math.round(Math.min(Math.max(ox + p.x - start.x, minX), maxX) * 10) / 10;
    o.y = Math.round(Math.min(Math.max(oy + p.y - start.y, minY), maxY) * 10) / 10;
    if (o.pinned) positions[o.id] = { x: o.x, y: o.y };
    draw();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    update();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ---------- Painel lateral ----------

function numInput(value, onChange, attrs = {}) {
  const i = document.createElement('input');
  i.type = 'number';
  i.value = value;
  Object.assign(i, attrs);
  i.addEventListener('change', () => { const v = parseFloat(i.value); if (v > 0) onChange(v); });
  return i;
}

function delButton(onClick) {
  const b = document.createElement('button');
  b.className = 'del';
  b.textContent = '✕';
  b.addEventListener('click', onClick);
  return b;
}

function renderPanel() {
  $('roomW').value = state.room.w;
  $('roomH').value = state.room.h;
  $('spacing').value = state.spacing;

  const ol = $('obstacleList');
  ol.innerHTML = '';
  for (const o of state.obstacles) {
    const div = document.createElement('div');
    div.className = 'item';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = o.name;
    name.addEventListener('change', () => { o.name = name.value; update(); });
    div.append(name,
      numInput(o.w, (v) => { o.w = v; update(); }, { step: 0.5, title: 'Largura' }), '×',
      numInput(o.h, (v) => { o.h = v; update(); }, { step: 0.5, title: 'Comprimento' }),
      delButton(() => { state.obstacles = state.obstacles.filter((x) => x !== o); update(); }));
    ol.appendChild(div);
  }

  const tl = $('tableList');
  tl.innerHTML = '';
  for (const t of state.tables) {
    const div = document.createElement('div');
    div.className = 'item' + (positions[t.id] ? '' : ' unplaced');
    const name = document.createElement('input');
    name.type = 'text';
    name.value = tableName(t);
    name.addEventListener('change', () => { t.name = name.value; update(); });
    div.append(name,
      numInput(t.chairs, (v) => { t.chairs = Math.round(v); update(); }, { min: 2, max: 20, title: 'Cadeiras' }),
      positions[t.id] ? '' : '(não coube)');
    if (t.pinned) {
      const unpin = document.createElement('button');
      unpin.textContent = '📌';
      unpin.title = 'Soltar mesa (volta a ser organizada automaticamente)';
      unpin.addEventListener('click', () => { t.pinned = false; update(); });
      div.append(unpin);
    }
    div.append(delButton(() => { state.tables = state.tables.filter((x) => x !== t); update(); }));
    tl.appendChild(div);
  }

  const placed = state.tables.filter((t) => positions[t.id]);
  const seats = placed.reduce((s, t) => s + t.chairs, 0);
  const missing = state.tables.length - placed.length;
  $('summary').textContent = `${placed.length} mesas · ${seats} lugares` + (missing ? ` · ${missing} não couberam` : '');
}

function update() {
  arrange();
  draw();
  renderPanel();
  save();
}

// Mudar largura/comprimento estica o formato atual do salão.
$('roomW').addEventListener('change', (e) => {
  const v = parseFloat(e.target.value);
  if (v >= 2) { state.room.points.forEach((p) => { p.x *= v / state.room.w; }); state.room.w = v; update(); }
});
$('roomH').addEventListener('change', (e) => {
  const v = parseFloat(e.target.value);
  if (v >= 2) { state.room.points.forEach((p) => { p.y *= v / state.room.h; }); state.room.h = v; update(); }
});
document.querySelectorAll('[data-shape]').forEach((b) => {
  b.addEventListener('click', () => { setShape(b.dataset.shape); update(); });
});

// ---------- Exportar ----------

$('exportPng').addEventListener('click', () => {
  const scale = 100; // pixels por metro
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('.wall, .corner').forEach((e) => e.remove());
  const [, , vw, vh] = clone.getAttribute('viewBox').split(' ').map(Number);
  clone.setAttribute('width', vw * scale);
  clone.setAttribute('height', vh * scale);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = vw * scale;
    canvas.height = vh * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const a = document.createElement('a');
    a.download = 'layout-salao.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
});

$('exportPdf').addEventListener('click', () => window.print());
$('spacing').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (v >= 0) { state.spacing = v; update(); } });

$('addObstacle').addEventListener('click', () => {
  const id = Math.max(0, ...state.obstacles.map((o) => o.id)) + 1;
  state.obstacles.push({ id, name: 'Área', x: 0, y: 0, w: 2, h: 2 });
  update();
});

$('addTable').addEventListener('click', () => {
  const chairs = Math.round(parseFloat($('newChairs').value)) || 8;
  const qty = Math.round(parseFloat($('newQty').value)) || 1;
  for (let i = 0; i < qty; i++) {
    state.tables.push({ id: Date.now() + i, num: state.nextNum++, chairs });
  }
  update();
});

update();
