// 生成紫调双主题 rocketOrbit2 图标（一次产出全部应用资产）
// 管线（最高清晰度）：884 高清源轻高斯软化（σ1.15：抹平插画边缘锯齿与单像素切换起伏）
//   → 重着色（青→紫连续色相映射；BFS 白底掩码 + 6px 渐变带融入贴纸底（带内增益 ×1.6+0.15）；
//     浅色像素按主题映射——深色版全部压到 V≤0.42 中暗紫、浅色版保留淡紫）
//   → 程序绘制超采样圆角贴纸（2048 画布）→ 1024 BOX 降采样。
// 输入：resources/app-logo-src/app-icon.png（884×806 原始高清插画）
// 输出（rocketOrbit2 = 紫调双主题插画变体；rocketOrbit v1 保留原始蓝青不动）：
//   docs/demo/logo-dark.png / logo-light.png（1024，demo 侧边栏双主题）
//   resources/logo/rocketOrbit2/icon-dark.png / icon-light.png（512，Dock 运行时深浅切换）
//   resources/logo/rocketOrbit2/icon.png（512 浅色，变体静态图标）
//   resources/logo/rocketOrbit2/icon.icns（浅色版静态包图标，Finder/Dock 默认）
//   src/renderer/src/assets/rocketOrbit2Theme.ts（512 双主题 dataURL，Logo 组件主题切换）
// 依赖：python3 + PIL + numpy + iconutil（macOS 自带；pip3 install pillow numpy）
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const src = join(root, '../resources/app-logo-src/app-icon.png')
const demoDark = join(root, '../docs/demo/logo-dark.png')
const demoLight = join(root, '../docs/demo/logo-light.png')
const resDir = join(root, '../resources/logo/rocketOrbit2')
const iconDark = join(resDir, 'icon-dark.png')
const iconLight = join(resDir, 'icon-light.png')
const iconPng = join(resDir, 'icon.png')
const iconIcns = join(resDir, 'icon.icns')
const tsOut = join(root, '../src/renderer/src/assets/rocketOrbit2Theme.ts')

const py = `
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from collections import deque

SRC = ${JSON.stringify(src)}
OUT = 1024
CAN = 2048    # 贴纸画布超采样（程序圆角无锯齿）
SIGMA = 1.15  # 源软化：抹平插画边缘锯齿起伏（白点链根源）
DOCK = 512
ICONSET = ${JSON.stringify(join(tmpdir(), 'launcher-logo.iconset'))}

def rgb_to_hsv(a):
    mx = a.max(axis=-1); mn = a.min(axis=-1)
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.zeros_like(mx)
    m = mx > mn
    idx = m & (mx == r); h[idx] = (60 * ((g - b) / np.maximum(mx - mn, 1e-9)) % 360)[idx]
    idx = m & (mx == g); h[idx] = (60 * ((b - r) / np.maximum(mx - mn, 1e-9)) + 120)[idx]
    idx = m & (mx == b); h[idx] = (60 * ((r - g) / np.maximum(mx - mn, 1e-9)) + 240)[idx]
    return h, s, v

def hsv_to_rgb(h, s, v):
    c = v * s
    hp = h / 60.0
    x = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(c)
    h0 = hp.astype(int) % 6
    conds = [(h0 == 0), (h0 == 1), (h0 == 2), (h0 == 3), (h0 == 4), (h0 == 5)]
    choices = [np.stack([c, x, z], -1), np.stack([x, c, z], -1), np.stack([z, c, x], -1),
               np.stack([z, x, c], -1), np.stack([x, z, c], -1), np.stack([c, z, x], -1)]
    rgb = np.zeros_like(choices[0])
    for cond, ch in zip(conds, choices):
        rgb = np.where(cond[..., None], ch, rgb)
    m = v - c
    return rgb + m[..., None]

def map_hsv_np(h, s, v, white_v):
    cyan = (h >= 170) & (h <= 235) & (s > 0.006)
    hp = np.where(h < 200, 244 + (h - 170) * 8.0 / 30, 252 + (h - 200) * 6.0 / 35)
    t = np.clip((h - 170) / 65.0, 0, 1)
    sp = s * (1.10 - 0.28 * t)
    tv = np.clip((v - 0.35) / 0.25, 0, 1)
    vp = np.minimum(0.97, v * (1.30 - 0.18 * tv))
    hp = np.where(cyan, hp, h); sp = np.where(cyan, sp, s); vp = np.where(cyan, vp, v)
    if white_v < 0.9:
        # 深色版：浅色像素 v>0.42 渐入、>0.60 全压至 ≤0.42 中暗紫（杜绝亮白点链）
        w2 = np.clip((v - 0.42) / 0.18, 0, 1) * (s < 0.38)
        cap = white_v
    else:
        w2 = np.clip((v - 0.55) / 0.25, 0, 1) * (s < 0.38)
        cap = 0.94
    hp = hp * (1 - w2) + 253.0 * w2
    sp = sp * (1 - w2) + 0.50 * w2
    vp = np.where(w2 > 0, vp * (1 - w2) + np.minimum(cap, v) * w2, vp)
    return hp, sp, vp

def build_bg_mask(px, W, H):
    mask = bytearray(W * H)
    seed = None
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a >= 30 and min(r, g, b) > 240:
                seed = (x, y); break
        if seed: break
    if not seed: return mask
    q = deque([seed]); mask[seed[1]*W+seed[0]] = 1
    while q:
        x, y = q.popleft()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x+dx, y+dy
            if 0 <= nx < W and 0 <= ny < H and not mask[ny*W+nx]:
                r, g, b, a = px[nx, ny]
                if a >= 30 and min(r, g, b) > 240:
                    mask[ny*W+nx] = 1; q.append((nx, ny))
    return mask

def dilate(mask, W, H, n):
    m2 = bytearray(mask)
    for _ in range(n):
        cur = bytearray(m2)
        for y in range(H):
            base = y*W
            for x in range(W):
                if m2[base+x]: continue
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < W and 0 <= ny < H and m2[ny*W+nx]:
                        cur[base+x] = 1; break
        m2 = cur
    return m2

def sticker(bg_hex, white_v):
    src_img = Image.open(SRC).convert('RGBA')
    rgb_part = src_img.convert('RGB').filter(ImageFilter.GaussianBlur(SIGMA))
    a_part = src_img.getchannel('A').filter(ImageFilter.GaussianBlur(SIGMA))
    src_img = Image.merge('RGBA', (*rgb_part.split(), a_part))
    W, H = src_img.size
    px = src_img.load()
    bgm = build_bg_mask(px, W, H)
    edge = dilate(bgm, W, H, 6)
    m = np.array(src_img)
    h, s, v = rgb_to_hsv(m[..., :3].astype(np.float64) / 255.0)
    hp, sp, vp = map_hsv_np(h, s, v, white_v)
    rgb2 = np.clip(hsv_to_rgb(hp, sp, vp) * 255.0, 0, 255)
    bg = np.array(tuple(int(bg_hex[i:i+2], 16) for i in (1,3,5)), dtype=float)
    bgm_np = np.array(bgm, dtype=bool).reshape(H, W)
    edge_np = np.array(edge, dtype=bool).reshape(H, W)
    mn = m[..., :3].min(axis=-1)
    w0 = np.clip((mn - 100) / 110.0, 0, 1)
    w = np.where(bgm_np, 1.0, np.where(edge_np, np.minimum(1.0, w0 * 1.6 + 0.15), 0.0))
    out = rgb2 * (1 - w[..., None]) + bg[None, None, :] * w[..., None]
    mapped = Image.fromarray(np.dstack([out.astype(np.uint8), m[..., 3]]))
    # 对齐 macOS 系统应用图标基准（实测系统图标：贴纸/不透明区 = 80.5% 画布 = 824/1024，四角透明）：
    # 贴纸 80.5%、内部图形约 66% 画布；art 溢出贴纸的部分由圆角 mask 裁切
    fit = int(CAN * 0.84)
    s = min(fit / W, fit / H)
    art = mapped.resize((int(W * s), int(H * s)), Image.LANCZOS)
    canvas = Image.new('RGBA', (CAN, CAN), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    stick_m = int(CAN * 0.0975)
    stick_r = int(CAN * 0.1787)  # 圆角 ≈ 贴纸边长 22.2%（系统图标圆角比例）
    d.rounded_rectangle((stick_m, stick_m, CAN - 1 - stick_m, CAN - 1 - stick_m), radius=stick_r,
                        fill=tuple(int(bg_hex[i:i+2], 16) for i in (1,3,5)) + (255,))
    canvas.alpha_composite(art, ((CAN - art.width) // 2, (CAN - art.height) // 2))
    # 圆角 mask 裁切：消除 art 溢出贴纸圆角外的部分
    mask = Image.new('L', (CAN, CAN), 0)
    ImageDraw.Draw(mask).rounded_rectangle((stick_m, stick_m, CAN - 1 - stick_m, CAN - 1 - stick_m),
                                           radius=stick_r, fill=255)
    from PIL import ImageChops
    canvas.putalpha(ImageChops.multiply(canvas.getchannel('A'), mask))
    return canvas.resize((OUT, OUT), Image.BOX)

def iconset(light_img):
    import os
    from os import path
    os.makedirs(ICONSET, exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        light_img.resize((size, size), Image.LANCZOS).save(path.join(ICONSET, f'icon_{size}x{size}.png'))
        light_img.resize((size*2, size*2), Image.LANCZOS).save(path.join(ICONSET, f'icon_{size}x{size}@2x.png'))

dark = sticker('#1d1d2e', 0.42)
light = sticker('#ffffff', 0.94)
dark.save(${JSON.stringify(demoDark)})
light.save(${JSON.stringify(demoLight)})
dark.resize((DOCK, DOCK), Image.LANCZOS).save(${JSON.stringify(iconDark)})
light.resize((DOCK, DOCK), Image.LANCZOS).save(${JSON.stringify(iconLight)})
light.resize((DOCK, DOCK), Image.LANCZOS).save(${JSON.stringify(iconPng)})   # 浅色 512 = v2 静态图标
iconset(light)
print('written')
`

execFileSync('python3', ['-c', py], { stdio: 'inherit' })

// icns：浅色版静态包图标（iconutil 打包 iconset）
const iconset = join(tmpdir(), 'launcher-logo.iconset')
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', iconIcns], { stdio: 'inherit' })
rmSync(iconset, { recursive: true, force: true })

// renderer 双主题 dataURL（供 Logo.tsx 主题切换：rocketOrbit2 = 紫调双主题）
const b64 = (p) => `'data:image/png;base64,${readFileSync(p).toString('base64')}'`
const ts = `// 自动生成：scripts/gen-demo-logos.mjs（紫调双主题 512，源 resources/app-logo-src/app-icon.png）
export const ROCKET_ORBIT2_DARK_DATAURL = ${b64(iconDark)}
export const ROCKET_ORBIT2_LIGHT_DATAURL = ${b64(iconLight)}
`
writeFileSync(tsOut, ts)
console.log(`written dock icons, icns, ${tsOut.split('/').pop()}`)
