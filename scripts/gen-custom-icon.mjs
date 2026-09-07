// 将用户提供的插画（~/Desktop/IMG_9736.jpg）转为 Launcher 图标资源：
//   1. sips: jpg → PNG → 1024
//   2. 自写 PNG 解码（filter 0-4 完整恢复）→ 近白像素颜色渐隐透明（白色不留色，避免 Dock 白块；
//      深藏青/青色像素保留，渐变处半透明过渡）
//   3. sips 缩放 → icon.png(512)/icns(16/32/128/256/512)
//   4. 菜单栏模板 16/32：按内容包围盒等比满幅（fit），RGB 置 0（纯黑白 alpha 模板）
//   5. 渲染层预览 dataURL（128）
import { inflateSync, deflateSync } from 'node:zlib'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const SRC = '/Users/wangming/Desktop/IMG_9736.jpg'
const WORK = join(ROOT, '../resources/logo-custom')
const OUT = join(ROOT, '../resources/logo/rocketOrbit')
const ASSET = join(ROOT, '../src/renderer/src/assets')

function sips(...args) {
  execFileSync('sips', args, { stdio: 'pipe' })
}

// ── PNG 解码（8-bit RGB/RGBA，filter 0-4）──
function decodePng(buf) {
  let off = 8
  let w = 0
  let h = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported png format: depth=${bitDepth} color=${colorType}`)
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const out = Buffer.alloc(h * stride)
  let pos = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++]
    const rowStart = y * stride
    const prevRowStart = rowStart - stride
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++]
      const a = x >= bpp ? out[rowStart + x - bpp] : 0
      const b = y > 0 ? out[prevRowStart + x] : 0
      const c = y > 0 && x >= bpp ? out[prevRowStart + x - bpp] : 0
      let val
      switch (filter) {
        case 0: val = rawByte; break
        case 1: val = rawByte + a; break
        case 2: val = rawByte + b; break
        case 3: val = rawByte + ((a + b) >> 1); break
        default: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          val = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        }
      }
      out[rowStart + x] = val & 0xff
    }
  }
  return { w, h, bpp, pixels: out }
}

// ── PNG 编码（RGBA）──
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
function encodePng(w, h, rgba) {
  const stride = w * 4
  const raw = Buffer.alloc(h * (1 + stride))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── 内容包围盒 + 等比满幅双线性缩放（tray 用）──
function fitResize(src, sw, sh, size, pad = 0.04) {
  let x0 = sw
  let y0 = sh
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (src[(y * sw + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) throw new Error('empty content')
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const s = Math.min(((1 - 2 * pad) * size) / bw, ((1 - 2 * pad) * size) / bh)
  const dw = Math.round(bw * s)
  const dh = Math.round(bh * s)
  const dx0 = Math.round((size - dw) / 2)
  const dy0 = Math.round((size - dh) / 2)
  const out = Buffer.alloc(size * size * 4)
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      const sx = x0 + (ox - dx0) / s
      const sy = y0 + (oy - dy0) / s
      const x0f = Math.floor(sx)
      const y0f = Math.floor(sy)
      const fx = sx - x0f
      const fy = sy - y0f
      const clampS = (v, m) => Math.max(0, Math.min(m - 1, v))
      const xa = clampS(x0f, sw)
      const xb = clampS(x0f + 1, sw)
      const ya = clampS(y0f, sh)
      const yb = clampS(y0f + 1, sh)
      const p = (xi, yi) => {
        const i = (yi * sw + xi) * 4
        return [src[i], src[i + 1], src[i + 2], src[i + 3]]
      }
      const [r1, g1, b1, a1] = p(xa, ya)
      const [r2, g2, b2, a2] = p(xb, ya)
      const [r3, g3, b3, a3] = p(xa, yb)
      const [r4, g4, b4, a4] = p(xb, yb)
      const lerp = (v1, v2, v3, v4) =>
        Math.round((v1 * (1 - fx) + v2 * fx) * (1 - fy) + (v3 * (1 - fx) + v4 * fx) * fy)
      const o = (oy * size + ox) * 4
      out[o] = lerp(r1, r2, r3, r4)
      out[o + 1] = lerp(g1, g2, g3, g4)
      out[o + 2] = lerp(b1, b2, b3, b4)
      out[o + 3] = lerp(a1, a2, a3, a4)
    }
  }
  return out
}

// ── 1. 转 PNG 并放大到 1024 ──
mkdirSync(WORK, { recursive: true })
mkdirSync(OUT, { recursive: true })
mkdirSync(ASSET, { recursive: true })
sips('-s', 'format', 'png', SRC, '--out', join(WORK, 'source.png'))
sips('-z', '1024', '1024', join(WORK, 'source.png'), '--out', join(WORK, 'big.png'))
console.log('[1] source → 1024 png ok')

// ── 2. 解码 + 浅色彻底透明（低饱和灰白/浅青光晕全删；高饱和青/深色主体保留）──
const { w, h, bpp, pixels } = decodePng(readFileSync(join(WORK, 'big.png')))
const rgba = Buffer.alloc(w * h * 4)
for (let i = 0; i < w * h; i++) {
  const r = pixels[i * bpp]
  const g = pixels[i * bpp + 1]
  const b = pixels[i * bpp + 2]
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = 255 - mn // 到白的最小通道距离（深藏青 d≈200+，纯青 d≈115）
  const s = mx === 0 ? 0 : (mx - mn) / mx // 饱和度（环青≈0.48，光晕≈0.14）
  const keep = d >= 62 || (d >= 45 && s >= 0.28)
  let alpha
  if (keep) alpha = 255
  else if (d <= 50) alpha = 0
  else alpha = Math.round(((d - 50) / 12) * 255) // 50..62 渐隐过渡，避免硬边
  rgba[i * 4] = r
  rgba[i * 4 + 1] = g
  rgba[i * 4 + 2] = b
  rgba[i * 4 + 3] = alpha
}
writeFileSync(join(WORK, 'clean.png'), encodePng(w, h, rgba))
console.log('[2] cutout ok (near-white & pale haze → transparent)')

// ── 2.5 内容留白缩放 + 白底 squircle 合成（Dock/应用图标：macOS 规范留白，底座外透明）──
const TRAY_SRC = rgba // 菜单栏模板仍用纯透明版（满幅 fit 逻辑在步骤 4）
const CONTENT = fitResize(rgba, w, h, w, 0.12) // 插画内容缩至画布 ~76%，白边收窄成紧凑徽章
const BASE_RGBA = Buffer.alloc(w * h * 4)
{
  const m = w * 0.06 // 满幅白底 squircle（与几何款 SVG 底座同网格，无透明边缘）
  const a0 = w / 2 - m
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const dx = Math.abs(x + 0.5 - w / 2)
      const dy = Math.abs(y + 0.5 - h / 2)
      const ex = dx / a0
      const ey = dy / a0
      const inside = ex * ex * ex * ex + ey * ey * ey * ey <= 1
      if (!inside) {
        BASE_RGBA[i + 3] = 0
        continue
      }
      const sa = CONTENT[i + 3] / 255
      BASE_RGBA[i] = Math.round(CONTENT[i] * sa + 255 * (1 - sa)) // 白底 + 插画：留白区即纯白
      BASE_RGBA[i + 1] = Math.round(CONTENT[i + 1] * sa + 255 * (1 - sa))
      BASE_RGBA[i + 2] = Math.round(CONTENT[i + 2] * sa + 255 * (1 - sa))
      BASE_RGBA[i + 3] = 255
    }
  }
}
writeFileSync(join(WORK, 'base.png'), encodePng(w, h, BASE_RGBA))
console.log('[2.5] white squircle base ok')

// ── 3. 缩放 + icns（白底版）──
sips('-z', '512', '512', join(WORK, 'base.png'), '--out', join(OUT, 'icon.png'))
const icnsEntries = []
for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp7', 128], ['icp8', 256], ['ic09', 512]]) {
  const f = join(WORK, `icon-${size}.png`)
  sips('-z', String(size), String(size), join(OUT, 'icon.png'), '--out', f)
  const png = readFileSync(f)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(8 + png.length)
  icnsEntries.push(Buffer.concat([Buffer.from(type, 'ascii'), len, png]))
}
const icnsBody = Buffer.concat(icnsEntries)
const icnsHead = Buffer.alloc(8)
icnsHead.write('icns', 0, 'ascii')
icnsHead.writeUInt32BE(8 + icnsBody.length, 4)
writeFileSync(join(OUT, 'icon.icns'), Buffer.concat([icnsHead, icnsBody]))
console.log('[3] icon.png(512) + icon.icns ok')

// ── 4. 菜单栏模板 16/32：内容包围盒满幅 + 纯黑白 alpha（用透明版，无白色底）──
for (const [size, name] of [[16, 'iconTemplate.png'], [32, 'iconTemplate@2x.png']]) {
  const fitted = fitResize(TRAY_SRC, w, h, size)
  const out = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = 0
    out[i * 4 + 1] = 0
    out[i * 4 + 2] = 0
    out[i * 4 + 3] = fitted[i * 4 + 3]
  }
  writeFileSync(join(OUT, name), encodePng(size, size, out))
}
console.log('[4] tray template 16/32 ok (content-fit)')

// ── 5. 渲染层预览 dataURL（128）──
sips('-z', '128', '128', join(OUT, 'icon.png'), '--out', join(WORK, 'preview.png'))
const preview = readFileSync(join(WORK, 'preview.png')).toString('base64')
writeFileSync(
  join(ASSET, 'rocketOrbit.ts'),
  `// 自动生成：node scripts/gen-custom-icon.mjs（用户插画抠图版，128px dataURL）\nexport const ROCKET_ORBIT_DATAURL = 'data:image/png;base64,${preview}'\n`
)
console.log(`[5] renderer asset ok (${preview.length} b64 chars)`)

console.log('done →', OUT)
