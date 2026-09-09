// 生成 Launcher 品牌 Logo 资源（零依赖，3x3 超采样抗锯齿）：
//   power / rocket / arrow 三款 × {菜单栏模板图 16/32（纯黑白 alpha）、应用图标 512（squircle 渐变底座+白色符号+光影）、icns}
//   demo 双主题 SVG。特性：底座超椭圆（squircle）连续圆角；符号尖角全部圆角多边形化。
// 调试：node scripts/gen-icon.mjs --dump（16px ASCII）| --dump-svg（三款完整 SVG 文本，供 Logo.tsx 同步）
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── PNG 编码 ──
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function encodePng(size, pixelFn) {
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4)
    raw[rowStart] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y)
      const p = rowStart + 1 + x * 4
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
      raw[p + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const inCircleBand = (px, py, cx, cy, r, w) => {
  const d = Math.hypot(px - cx, py - cy)
  return d >= r - w / 2 && d <= r + w / 2
}
const inRect = (px, py, x0, y0, x1, y1) => px >= x0 && px <= x1 && py >= y0 && py <= y1

// ── 圆角多边形（支持凹轮廓）：内部 = 原多边形 − 凸顶点「角楔」，角部以内切圆弧补回 ──
function roundedPolyFactory(pts, crFrac) {
  const n = pts.length
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % n]
    area2 += x1 * y2 - x2 * y1
  }
  // 凸顶点：仅当点靠近顶点（< cr）时用圆弧判定修复；凹顶点不做处理
  const corners = []
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i]
    const [px, py] = pts[(i - 1 + n) % n]
    const [qx, qy] = pts[(i + 1) % n]
    const v1 = [x - px, y - py]
    const v2 = [qx - x, qy - y]
    const cross = v1[0] * v2[1] - v1[1] * v2[0]
    const convex = (area2 > 0 && cross > 0) || (area2 < 0 && cross < 0)
    if (!convex) continue
    const l1 = Math.hypot(...v1) || 1
    const l2 = Math.hypot(...v2) || 1
    const dir = [v1[0] / l1 + v2[0] / l2, v1[1] / l1 + v2[1] / l2]
    const dl = Math.hypot(...dir) || 1
    const sinHalf = Math.sqrt(Math.max(0, (1 - (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)) / 2))
    corners.push({ x, y, dx: dir[0] / dl, dy: dir[1] / dl, sinHalf: Math.max(sinHalf, 1e-6) })
  }
  const inPolyRaw = (ux, uy) => {
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi > uy !== yj > uy && ux < ((xj - xi) * (uy - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  return (px, py, S) => {
    const ux = px / S
    const uy = py / S
    if (!inPolyRaw(ux, uy)) return false
    // 圆角随尺寸缩放：大图全量圆润，小图收窄以免形状丢失
    const cr = crFrac * Math.min(1, S / 128)
    if (cr <= 0) return true
    for (const c of corners) {
      const d2v = (ux - c.x) ** 2 + (uy - c.y) ** 2
      if (d2v < cr * cr) {
        // 近凸顶点：须落在内切弧内侧，否则视为被圆角裁切的角楔
        const cxArc = c.x + c.dx * (cr / c.sinHalf)
        const cyArc = c.y + c.dy * (cr / c.sinHalf)
        if ((ux - cxArc) ** 2 + (uy - cyArc) ** 2 > cr * cr + 1e-9) return false
      }
    }
    return true
  }
}

// 圆角多边形顶点近似（SVG polygon 用）：凸角替换为切点 + 圆弧段
function roundedPolyPoints(pts, crFrac, segs = 5) {
  const n = pts.length
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % n]
    area2 += x1 * y2 - x2 * y1
  }
  const out = []
  const tan = (i) => {
    const [x, y] = pts[i]
    const [px, py] = pts[(i - 1 + n) % n]
    const [qx, qy] = pts[(i + 1) % n]
    const v1 = [x - px, y - py]
    const v2 = [qx - x, qy - y]
    const cross = v1[0] * v2[1] - v1[1] * v2[0]
    const convex = (area2 > 0 && cross > 0) || (area2 < 0 && cross < 0)
    if (!convex) return []
    const l1 = Math.hypot(...v1) || 1
    const l2 = Math.hypot(...v2) || 1
    const cosA = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)
    const tanLen = crFrac / Math.max(1e-6, Math.tan(Math.acos(clamp01(cosA)) / 2))
    const t1 = [x - (v1[0] / l1) * tanLen, y - (v1[1] / l1) * tanLen]
    const t2 = [x + (v2[0] / l2) * tanLen, y + (v2[1] / l2) * tanLen]
    const dir = [v1[0] / l1 + v2[0] / l2, v1[1] / l1 + v2[1] / l2]
    const dl = Math.hypot(...dir) || 1
    const sinHalf = Math.sqrt(Math.max(0, (1 - cosA) / 2))
    const dist = sinHalf < 1e-6 ? 1e6 : crFrac / sinHalf
    const c = [x + (dir[0] / dl) * dist, y + (dir[1] / dl) * dist]
    const ptsArc = []
    for (let k = 1; k < segs; k++) {
      const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0])
      const a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0])
      let da = a2 - a1
      while (da > Math.PI) da -= 2 * Math.PI
      while (da < -Math.PI) da += 2 * Math.PI
      const a = a1 + (da * k) / segs
      ptsArc.push([c[0] + Math.cos(a) * crFrac, c[1] + Math.sin(a) * crFrac])
    }
    return [t1, ...ptsArc, t2]
  }
  for (let i = 0; i < n; i++) {
    const seg = tan(i)
    if (seg.length) out.push(...seg)
    else out.push(pts[i])
  }
  return out
}

// ── 三款符号（几何归一化，各尺寸同构）──
const POWER = { cx: 0.5, cy: 0.565, r: 0.305, w: 0.14, gap: 30 }
const powerHit = (px, py, S, frac = 1) => {
  const cx = POWER.cx * S
  const cy = POWER.cy * S
  const r = POWER.r * S
  const w = POWER.w * S * frac
  if (inCircleBand(px, py, cx, cy, r, w)) {
    const ang = (Math.atan2(py - cy, px - cx) * 180) / Math.PI
    const d = Math.abs(((ang + 90 + 180) % 360) - 180)
    if (d > POWER.gap) return true
  }
  return inRect(px, py, cx - w / 2, cy - r - w * 0.85, cx + w / 2, cy - r * 0.22)
}

const ROCKET_PTS = [[0.5, 0.13], [0.63, 0.5], [0.75, 0.77], [0.575, 0.7], [0.545, 0.8], [0.455, 0.8], [0.425, 0.7], [0.25, 0.77], [0.37, 0.5]]
const rocketHitR = roundedPolyFactory(ROCKET_PTS, 0.045)
const ROCKET_WINDOW = { cx: 0.5, cy: 0.42, r: 0.085 }
const rocketHit = (px, py, S, frac = 1) => {
  if (!rocketHitR(px, py, S)) return false
  if (frac < 0.9) {
    const w = ROCKET_WINDOW
    if (Math.hypot(px - w.cx * S, py - w.cy * S) < w.r * S * 1.35) return false
  }
  return true
}

const ARROW = { cx: 0.5, cy: 0.63, r: 0.27, w: 0.13, shaftTop: 0.2, shaftBot: 0.74 }
const ARROW_HEAD = [[0.5, 0.11], [0.36, 0.36], [0.64, 0.36]]
const arrowHeadHit = roundedPolyFactory(ARROW_HEAD, 0.03)
const arrowHit = (px, py, S, frac = 1) => {
  const a = ARROW
  const cx = a.cx * S
  const w = a.w * S * frac
  if (inCircleBand(px, py, cx, a.cy * S, a.r * S, w)) return true
  if (inRect(px, py, cx - w / 2, a.shaftTop * S, cx + w / 2, a.shaftBot * S)) return true
  return arrowHeadHit(px, py, S)
}

// ── gauge：仪表盘（环 + 45° 圆头指针），「运行中」语义 ──
const GAUGE = { cx: 0.5, cy: 0.615, r: 0.285, w: 0.13, ang: -45, len: 0.175 }
const gaugeHit = (px, py, S, frac = 1) => {
  const g = GAUGE
  const w = g.w * S * frac
  if (inCircleBand(px, py, g.cx * S, g.cy * S, g.r * S, w)) return true
  // 指针：从圆心沿 -45° 的圆头线段
  const th = (g.ang * Math.PI) / 180
  const dx = px - g.cx * S
  const dy = py - g.cy * S
  const u = dx * Math.cos(th) + dy * Math.sin(th)
  const v = -dx * Math.sin(th) + dy * Math.cos(th)
  const t = Math.max(0, Math.min(g.len * S, u))
  if (Math.hypot(u - t, v) <= w / 2) return true
  return false
}

// ── bolt：圆润闪电 ──
const BOLT_PTS = [[0.56, 0.1], [0.36, 0.47], [0.495, 0.47], [0.42, 0.9], [0.66, 0.5], [0.525, 0.5]]
const boltHit = roundedPolyFactory(BOLT_PTS, 0.035)

// ── stack：对角错位层叠方块（服务栈，16px 下仍可见层次）──
const STACK_RECTS = [
  [0.27, 0.58, 0.55, 0.78],
  [0.45, 0.40, 0.73, 0.60],
  [0.27, 0.22, 0.55, 0.42]
]
const stackHits = STACK_RECTS.map(([x0, y0, x1, y1]) =>
  roundedPolyFactory([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 0.028)
)
const stackHit = (px, py, S, frac = 1) => stackHits.some((h) => h(px, py, S))

// ── bars：均衡器（三根圆头竖条，底对齐）──
const BARS = [
  { cx: 0.41, top: 0.5, bot: 0.74, w: 0.1 },
  { cx: 0.5, top: 0.26, bot: 0.74, w: 0.1 },
  { cx: 0.59, top: 0.38, bot: 0.74, w: 0.1 }
]
const barsHit = (px, py, S, frac = 1) =>
  BARS.some((b) => {
    const w = b.w * S * frac
    const cx = b.cx * S
    const y0 = b.top * S
    const y1 = b.bot * S
    if (Math.abs(px - cx) <= w / 2 && py >= y0 && py <= y1) return true
    if (Math.hypot(px - cx, py - y0) <= w / 2 || Math.hypot(px - cx, py - y1) <= w / 2) return true
    return false
  })

// ── letter-l：圆润 L 字标 + 右上状态点 ──
const L_PTS = [[0.34, 0.26], [0.46, 0.26], [0.46, 0.62], [0.66, 0.62], [0.66, 0.74], [0.34, 0.74]]
const lHit = roundedPolyFactory(L_PTS, 0.045)
const L_DOT = { cx: 0.7, cy: 0.3, r: 0.062 }
const letterLHit = (px, py, S, frac = 1) => {
  if (lHit(px, py, S)) return true
  if (Math.hypot(px - L_DOT.cx * S, py - L_DOT.cy * S) <= L_DOT.r * S) return true
  return false
}

const SYMBOLS = { power: powerHit, rocket: rocketHit, arrow: arrowHit, gauge: gaugeHit, bolt: boltHit, stack: stackHit, bars: barsHit, letterL: letterLHit }

// ── 各款符号包围盒自动测量（用于 Tray/SVG 等比满幅放大，避免菜单栏图标显小）──
const TRAY_BOUNDS = {}
{
  const R = 160
  for (const [v, hit] of Object.entries(SYMBOLS)) {
    let x0 = 1
    let y0 = 1
    let x1 = 0
    let y1 = 0
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < R; x++) {
        if (hit(x, y, R)) {
          if (x / R < x0) x0 = x / R
          if (x / R > x1) x1 = x / R
          if (y / R < y0) y0 = y / R
          if (y / R > y1) y1 = y / R
        }
      }
    }
    TRAY_BOUNDS[v] = [x0, y0, x1, y1]
  }
}
// 等比满幅变换（pad 边距，保持形状不拉伸）
const TRAY_PAD = 0.05
function fitTransform(b) {
  const w = b[2] - b[0]
  const h = b[3] - b[1]
  const s = Math.min((1 - 2 * TRAY_PAD) / w, (1 - 2 * TRAY_PAD) / h)
  const cx = (b[0] + b[2]) / 2
  const cy = (b[1] + b[3]) / 2
  return { s, cx, cy }
}

// ── 3x3 超采样（每像素子采样）──
function render(px, py, hit, S, opts = {}) {
  let a = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      if (hit(px + (sx + 0.5) / 3, py + (sy + 0.5) / 3, S, opts.frac ?? 1)) a++
    }
  }
  return a / 9
}

// 菜单栏模板图：纯黑白（R=G=B=0），符号按包围盒等比满幅放大
function trayPng(variant, size) {
  const hit = SYMBOLS[variant]
  const { s, cx, cy } = fitTransform(TRAY_BOUNDS[variant])
  return encodePng(size, (x, y) => {
    // 像素 → 符号坐标（先还原缩放，再做 3x3 超采样）
    const ux = cx + ((x / size) - 0.5) / s
    const uy = cy + ((y / size) - 0.5) / s
    const step = 1 / (s * size)
    let a = 0
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        if (hit((ux + (sx + 0.5) / 3 * step) * size, (uy + (sy + 0.5) / 3 * step) * size, size)) a++
      }
    }
    return [0, 0, 0, Math.round((255 * a) / 9)]
  })
}

// ── 应用图标：squircle 底座 + 三段渐变 + 高光 + 暗边 + 符号投影 + 白色符号 ──
const BRAND_TOP = [157, 140, 255]
const BRAND_MID = [124, 106, 244]
const BRAND_DARK = [75, 62, 199]
function lerp3(a, b, t) {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]
}
function appPng(variant, size) {
  const hit = SYMBOLS[variant]
  const m = size * 0.058
  const a0 = size / 2 - m // squircle 半轴
  const inBase = (px, py) => {
    const dx = Math.abs(px - size / 2)
    const dy = Math.abs(py - size / 2)
    const ex = dx / a0
    const ey = dy / a0
    return ex * ex * ex * ex + ey * ey * ey * ey <= 1 // 超椭圆 n=4（squircle）
  }
  return encodePng(size, (x, y) => {
    const px = x + 0.5
    const py = y + 0.5
    if (!inBase(px, py)) return [0, 0, 0, 0]
    const side = size - 2 * m
    const t = clamp01((px + py - 2 * m) / (2 * side))
    let rgb = t < 0.5 ? lerp3(BRAND_TOP, BRAND_MID, t * 2) : lerp3(BRAND_MID, BRAND_DARK, (t - 0.5) * 2)
    const relY = (py - m) / side
    if (relY < 0.18) rgb = lerp3(rgb, [255, 255, 255], ((0.18 - relY) / 0.18) * 0.1)
    if (relY > 0.93) rgb = lerp3(rgb, [0, 0, 0], ((relY - 0.93) / 0.07) * 0.14)
    const shadow = render(px - size * 0.012, py - size * 0.012, hit, size, { frac: 0.85 })
    if (shadow > 0) rgb = lerp3(rgb, [30, 20, 90], shadow * 0.35)
    const a = render(px, py, hit, size, { frac: 0.92 })
    return [
      Math.round(a * 255 + (1 - a) * rgb[0]),
      Math.round(a * 255 + (1 - a) * rgb[1]),
      Math.round(a * 255 + (1 - a) * rgb[2]),
      255
    ]
  })
}

// ── icns（iconutil 官方生成：标准 iconset 10 个尺寸表示 → iconutil -c icns）──
const ICONSET_REPS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]
function makeIcns(variant, pngPath, outPath) {
  const iconset = join(tmpdir(), `launcher-iconset-${variant}.iconset`) // iconutil 要求目录以 .iconset 结尾
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  for (const [name, size] of ICONSET_REPS) {
    execFileSync('sips', ['-z', String(size), String(size), pngPath, '--out', join(iconset, name)], {
      stdio: 'pipe'
    })
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', outPath], { stdio: 'pipe' })
  rmSync(iconset, { recursive: true, force: true })
}

// ── SVG 公共件：squircle 底座 path（与 PNG 底座同构，视口 256）──
const SQUIRCLE_PATH = 'M 15 128 C 15 58 58 15 128 15 C 198 15 241 58 241 128 C 241 198 198 241 128 241 C 58 241 15 198 15 128 Z'
const fmt = (v) => Math.round(v * 256).toString()

// SVG 用与 Tray 相同的 fit 变换（保持三处视觉一致）
function svgFitTransform(variant) {
  const b = TRAY_BOUNDS[variant]
  const { s, cx, cy } = fitTransform(b)
  const tx = (0.5 - cx * s) * 256
  const ty = (0.5 - cy * s) * 256
  return `translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${s.toFixed(4)})`
}

function svgSymbol(variant, color) {
  switch (variant) {
    case 'power':
      return `<g fill="none" stroke="${color}" stroke-width="36" stroke-linecap="round">
    <circle cx="128" cy="145" r="78" stroke-dasharray="408.4 81.7" transform="rotate(-60 128 145)"/>
    <line x1="128" y1="36" x2="128" y2="128"/>
  </g>`
    case 'rocket': {
      const pts = roundedPolyPoints(ROCKET_PTS, 0.045).map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')
      return `<polygon points="${pts}" fill="${color}"/>\n  <circle cx="128" cy="108" r="22" fill="url(#g)"/>`
    }
    case 'arrow': {
      const head = roundedPolyPoints(ARROW_HEAD, 0.03).map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')
      return `<g fill="none" stroke="${color}" stroke-width="33" stroke-linecap="round">
    <circle cx="128" cy="161" r="69"/>
    <line x1="128" y1="51" x2="128" y2="189"/>
  </g>
  <polygon points="${head}" fill="${color}"/>`
    }
    case 'gauge':
      return `<g fill="none" stroke="${color}" stroke-width="33" stroke-linecap="round">
    <circle cx="128" cy="157" r="73"/>
    <line x1="128" y1="157" x2="160" y2="125"/>
  </g>`
    case 'bolt': {
      const pts = roundedPolyPoints(BOLT_PTS, 0.035).map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')
      return `<polygon points="${pts}" fill="${color}"/>`
    }
    case 'stack': {
      const rects = STACK_RECTS.map(([x0, y0, x1, y1]) =>
        roundedPolyPoints([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 0.028)
          .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
          .join(' ')
      )
      return rects.map((pts) => `  <polygon points="${pts}" fill="${color}"/>`).join('\n')
    }
    case 'bars':
      return `<g fill="none" stroke="${color}" stroke-width="26" stroke-linecap="round">
    <line x1="105" y1="128" x2="105" y2="189"/>
    <line x1="128" y1="67" x2="128" y2="189"/>
    <line x1="151" y1="97" x2="151" y2="189"/>
  </g>`
    case 'letterL': {
      const pts = roundedPolyPoints(L_PTS, 0.045).map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')
      return `<polygon points="${pts}" fill="${color}"/>
  <circle cx="179" cy="77" r="16" fill="${color}"/>`
    }
  }
}

function makeSvg(variant, symbolColor, gradTop, gradMid, gradDark) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${gradTop}"/>
      <stop offset="50%" stop-color="${gradMid}"/>
      <stop offset="100%" stop-color="${gradDark}"/>
    </linearGradient>
  </defs>
  <path d="${SQUIRCLE_PATH}" fill="url(#g)"/>
  <g transform="${svgFitTransform(variant)}">
  ${svgSymbol(variant, symbolColor)}
  </g>
</svg>
`
}

// ── 16px ASCII 预览（调试，与 trayPng 同一 fit 变换）──
function dumpTray(variant) {
  const hit = SYMBOLS[variant]
  const { s, cx, cy } = fitTransform(TRAY_BOUNDS[variant])
  console.log(`— ${variant} 16px (fit ${s.toFixed(2)}x) —`)
  for (let y = 0; y < 16; y++) {
    let line = ''
    for (let x = 0; x < 16; x++) {
      const ux = cx + (x / 16 - 0.5) / s
      const uy = cy + (y / 16 - 0.5) / s
      line += hit(ux * 16, uy * 16, 16) ? '██' : '  '
    }
    console.log(line)
  }
}

// ── 输出 ──
const root = dirname(fileURLToPath(import.meta.url))
const resourcesDir = join(root, '../resources')
const demoDir = join(root, '../docs/demo')

if (process.argv.includes('--dump')) {
  for (const v of Object.keys(SYMBOLS)) dumpTray(v)
  process.exit(0)
}
if (process.argv.includes('--dump-svg')) {
  for (const v of Object.keys(SYMBOLS)) console.log(makeSvg(v, '#fff', '#9d8cff', '#7c6af4', '#4b3ec7'))
  process.exit(0)
}

const VARIANTS = Object.keys(SYMBOLS)
for (const v of VARIANTS) {
  const dir = join(resourcesDir, 'logo', v)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'iconTemplate.png'), trayPng(v, 16))
  writeFileSync(join(dir, 'iconTemplate@2x.png'), trayPng(v, 32))
  const iconPng = join(dir, 'icon.png')
  writeFileSync(iconPng, appPng(v, 512))
  makeIcns(v, iconPng, join(dir, 'icon.icns'))
}
console.log(`written ${VARIANTS.length} variants (tray 16/32 + icon 512 + icns)`)
