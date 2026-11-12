import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { dirname, extname, join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

// 这个 worktree 自己的 node_modules 是空的,包在仓库根。Vite 会跟到真实路径,
// 但默认不放行项目目录以外的文件,图标和中文字体就会 403。
const repoModules = resolve('../../../node_modules')
const outsideModules = existsSync(resolve(repoModules, '@fortawesome')) ? repoModules : null

// 中文 PDF 的字符映射、标准字体和 wasm 解码器。不进 git,跟着 pdfjs-dist 走。
// 开发时挂在渲染页旁边的 /pdfjs,构建时拷到 out/renderer/pdfjs。
// 地址必须是相对的:生产环境是 file://,写死 /pdfjs 会指到磁盘根。
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm'] as const
const PDFJS_MIME: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.js': 'text/javascript'
}

function pdfjsAssetsPlugin(): Plugin {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? ''
        if (!pathname.startsWith('/pdfjs/')) return next()
        const rel = decodeURIComponent(pathname.slice('/pdfjs/'.length))
        const dir = rel.split('/')[0]
        if (!PDFJS_ASSET_DIRS.includes(dir as (typeof PDFJS_ASSET_DIRS)[number])) return next()
        const file = join(root, rel)
        const base = join(root, dir) + sep
        if (!file.startsWith(base) || !existsSync(file)) return next()
        const stat = statSync(file)
        if (!stat.isFile()) return next()
        res.setHeader('Content-Type', PDFJS_MIME[extname(file)] ?? 'application/octet-stream')
        res.setHeader('Content-Length', stat.size)
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      const out = resolve('out/renderer/pdfjs')
      for (const dir of PDFJS_ASSET_DIRS) {
        cpSync(join(root, dir), join(out, dir), { recursive: true })
      }
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // 两个入口:
        //  index        —— 应用主进程(package.json 的 main 指向 out/main/index.js)
        //  launcher-mcp —— MCP 的 stdio 形态,由外部 Agent(Electron 二进制 + ELECTRON_RUN_AS_NODE=1)拉起
        input: {
          index: resolve('src/main/index.ts'),
          'launcher-mcp': resolve('src/main/mcp/stdio-entry.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    server: outsideModules ? { fs: { allow: [resolve('.'), outsideModules] } } : undefined,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        // 仓库根:帮助文档(docs/help.md / docs/install.md)以 `?raw` 内联进产物 —— 应用内离线可读,
        // 且与 GitHub 上的是同一份文件,不会分叉
        '@root': resolve('.')
      }
    },
    plugins: [react(), pdfjsAssetsPlugin()]
  }
})
