// Generates the Claude Topo backdrop: a synthetic terrain (mountain ranges rising out of
// flat plains), traced into contour lines with marching squares. Lines are coloured by
// elevation, so valleys glow deep rust and peaks burn pale peach. Steep slopes pack the
// lines tight; plains spread them wide. Usage: node tools/gen.js [seed]
// Writes hooks/scene.ts (the mod's scene) and tools/prototype.html (a preview).
const fs = require('fs')
const path = require('path')

// --- knobs -----------------------------------------------------------------
const SEED = Number(process.argv[2] ?? 3)
const W = 1600, H = 1000        // design space; output is doubled so curve midpoints stay integers
const STEP = 5                  // sampling grid, px
const LEVELS = 40               // contour lines from the lowest valley to the highest peak
const INDEX_EVERY = 5           // every Nth line is a heavier "index contour", like a survey map
const SCALE = 1 / 700           // feature size: lower = broader landforms
const RANGES = 0.62             // how much of the map is mountains (0..1); the rest is plains
const WARP = 0.55               // how much the land is folded and twisted
const EPS = 1.0                 // simplification tolerance, px
const MIN_POINTS = 4            // drop specks
const STROKE = 1.9              // in doubled space, so ~0.95px at 1600 wide
const INDEX_STROKE = 3.6

// Claude orange, from low ground to summit.
const RAMP = ['#6e3524', '#8a4029', '#a84a2e', '#c15f3c', '#d97757', '#e48c6c', '#eda585', '#f5c6ae', '#fbe3d6']
const BG = '#0a0a0b'

// --- noise -----------------------------------------------------------------
const rand = (() => { let s = SEED * 2654435761 >>> 0; return () => ((s = Math.imul(s ^ s >>> 15, 2246822507) + 0x9e3779b9 >>> 0) / 4294967296) })()
const P = Array.from({ length: 256 }, (_, i) => i)
for (let i = 255; i > 0; i--) { const j = rand() * (i + 1) | 0; [P[i], P[j]] = [P[j], P[i]] }
const G = Array.from({ length: 256 }, () => { const a = rand() * Math.PI * 2; return [Math.cos(a), Math.sin(a)] })
const grad = (ix, iy, dx, dy) => { const g = G[P[(ix + P[iy & 255]) & 255]]; return g[0] * dx + g[1] * dy }
const fade = t => t * t * t * (t * (t * 6 - 15) + 10)
function perlin(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fade(fx), v = fade(fy)
  const a = grad(ix, iy, fx, fy), b = grad(ix + 1, iy, fx - 1, fy)
  const c = grad(ix, iy + 1, fx, fy - 1), d = grad(ix + 1, iy + 1, fx - 1, fy - 1)
  return a + u * (b - a) + v * (c - a + u * (d - b - c + a))
}
const fbm = (x, y, oct = 4) => { let s = 0, a = 1, n = 0; for (let o = 0; o < oct; o++) { s += a * perlin(x, y); n += a; a *= 0.5; x = x * 2.07 + 5.3; y = y * 2.07 - 3.1 } return s / n }
// Ridged noise: sharp crests and steep flanks, the shape of real mountain ranges.
const ridged = (x, y) => { let s = 0, a = 0.6, w = 1; for (let o = 0; o < 3; o++) { let r = 1 - Math.abs(perlin(x, y)); r *= r * w; w = Math.min(1, r * 1.6); s += r * a; a *= 0.38; x = x * 2.1 + 9.2; y = y * 2.1 - 1.7 } return s }
const smooth = (a, b, t) => { t = Math.min(1, Math.max(0, (t - a) / (b - a))); return t * t * (3 - 2 * t) }

function height(px, py) {
  let x = px * SCALE, y = py * SCALE
  x += WARP * fbm(x + 31.4, y + 7.9, 2); y += WARP * fbm(x - 17.3, y + 54.1, 2)
  // where the mountains are: a broad mask, so plains stay genuinely flat
  const mask = smooth(0.5 - RANGES * 0.5, 0.78 - RANGES * 0.3, fbm(x * 0.55 + 70, y * 0.55 - 20, 3) * 0.5 + 0.5)
  const plains = 0.2 * (fbm(x * 0.6, y * 0.6, 2) * 0.5 + 0.5)   // gentle rolling ground
  const peaks = Math.pow(ridged(x * 0.75, y * 0.75), 1.8)          // steep, close-packed contours
  return plains + mask * peaks * 1.1
}

// --- marching squares --------------------------------------------------------
const nx = Math.ceil(W / STEP) + 1, ny = Math.ceil(H / STEP) + 1
const f = new Float64Array(nx * ny)
let lo = Infinity, hi = -Infinity
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const v = f[j * nx + i] = height(i * STEP, j * STEP)
  lo = Math.min(lo, v); hi = Math.max(hi, v)
}
function contours(level) {
  const pt = new Map(), adj = new Map()
  const cross = (i, j, horiz) => {
    const key = (j * nx + i) * 2 + (horiz ? 0 : 1)
    if (!pt.has(key)) {
      const a = f[j * nx + i], b = horiz ? f[j * nx + i + 1] : f[(j + 1) * nx + i], t = (level - a) / (b - a)
      pt.set(key, horiz ? [(i + t) * STEP, j * STEP] : [i * STEP, (j + t) * STEP])
    }
    return key
  }
  const link = (a, b) => { (adj.get(a) ?? adj.set(a, []).get(a)).push(b); (adj.get(b) ?? adj.set(b, []).get(b)).push(a) }
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const tl = f[j * nx + i] > level, tr = f[j * nx + i + 1] > level
    const bl = f[(j + 1) * nx + i] > level, br = f[(j + 1) * nx + i + 1] > level
    const e = []
    if (tl !== tr) e.push(cross(i, j, true))
    if (tr !== br) e.push(cross(i + 1, j, false))
    if (bl !== br) e.push(cross(i, j + 1, true))
    if (tl !== bl) e.push(cross(i, j, false))
    if (e.length === 2) link(e[0], e[1])
    else if (e.length === 4) { link(e[0], tl ? e[1] : e[3]); link(e[2], tl ? e[3] : e[1]) }
  }
  const seen = new Set(), lines = []
  const walk = start => {
    const out = [start]; seen.add(start)
    for (let cur = start; ;) {
      const nxt = adj.get(cur).find(k => !seen.has(k))
      if (nxt === undefined) break
      seen.add(nxt); out.push(nxt); cur = nxt
    }
    return out
  }
  for (const k of adj.keys()) if (!seen.has(k) && adj.get(k).length === 1) lines.push({ keys: walk(k), closed: false })
  for (const k of adj.keys()) if (!seen.has(k)) lines.push({ keys: walk(k), closed: true })
  return lines.map(l => ({ pts: l.keys.map(k => pt.get(k)), closed: l.closed }))
}

// --- simplify + emit -----------------------------------------------------------
function rdp(p, eps) {
  if (p.length < 3) return p
  const [ax, ay] = p[0], [bx, by] = p[p.length - 1], len = Math.hypot(bx - ax, by - ay) || 1
  let far = 0, idx = 0
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs((p[i][0] - ax) * (by - ay) - (p[i][1] - ay) * (bx - ax)) / len
    if (d > far) { far = d; idx = i }
  }
  return far <= eps ? [p[0], p[p.length - 1]] : [...rdp(p.slice(0, idx + 1), eps).slice(0, -1), ...rdp(p.slice(idx), eps)]
}
function emit({ pts, closed }) {
  let p = rdp(pts, EPS).map(([x, y]) => [Math.round(x) * 2, Math.round(y) * 2])
  p = p.filter((q, i) => i === 0 || q[0] !== p[i - 1][0] || q[1] !== p[i - 1][1])
  if (p.length < MIN_POINTS) return ''
  if (closed) p = [...p, p[0], p[1]]
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const start = closed ? mid(p[0], p[1]) : p[0]
  let [cx, cy] = start, d = `M${cx} ${cy}`
  const rel = (x, y) => { const s = `${x - cx}${y - cy < 0 ? '' : ' '}${y - cy}`; cx = x; cy = y; return s }
  const m1 = mid(p[1], p[2])
  d += `q${p[1][0] - cx}${p[1][1] - cy < 0 ? '' : ' '}${p[1][1] - cy} ${rel(m1[0], m1[1])}`
  for (let i = 2; i < p.length - 1; i++) { const m = mid(p[i], p[i + 1]); d += `t${rel(m[0], m[1])}` }
  if (!closed) d += `t${rel(p[p.length - 1][0], p[p.length - 1][1])}`
  return d
}

// one path per colour band; index contours get their own heavier paths
const bands = RAMP.map(() => ({ thin: '', index: '' }))
const gap = (hi - lo) / (LEVELS + 1)
for (let n = 1; n <= LEVELS; n++) {
  const level = lo + n * gap, t = (n - 1) / (LEVELS - 1)
  const b = bands[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))]
  const d = contours(level).map(emit).join('')
  if (n % INDEX_EVERY === 0) b.index += d; else b.thin += d
}

// --- scene ---------------------------------------------------------------------
const paths = bands.map(({ thin, index }, i) =>
  (thin && `<path stroke="${RAMP[i]}" stroke-width="${STROKE}" d="${thin}"/>`) +
  (index && `<path stroke="${RAMP[i]}" stroke-width="${INDEX_STROKE}" d="${index}"/>`)).join('')
const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * 2} ${H * 2}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
<rect fill="${BG}" width="100%" height="100%"/>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
</svg>`

fs.writeFileSync(path.join(__dirname, 'prototype.html'), `<!doctype html><meta charset="utf-8"><title>Claude Topo prototype</title>
<style>html,body{margin:0;background:${BG}}.pane{height:100vh}</style><div class="pane">${out}</div>`)
const hooks = path.join(__dirname, '..', 'hooks')
if (fs.existsSync(hooks)) fs.writeFileSync(path.join(hooks, 'scene.ts'), `// Generated by tools/gen.js; do not edit by hand.\nexport const SCENE = ${JSON.stringify(out)}\n`)
console.log(`seed ${SEED}: height ${lo.toFixed(2)}..${hi.toFixed(2)}, scene ${out.length} chars (limit 131072)`)
if (out.length > 131072) { console.error('TOO BIG: lower LEVELS or raise STEP/EPS'); process.exit(1) }
