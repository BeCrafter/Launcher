// brew 可执行文件定位(绝对路径):Finder/Dock 启动的 Electron 进程 PATH 精简,裸 `brew` 可能 ENOENT
import { existsSync } from 'node:fs'

const CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

export function resolveBrewPath(exists: (p: string) => boolean = existsSync): string {
  for (const p of CANDIDATES) {
    if (exists(p)) return p
  }
  return 'brew' // 兜底走 PATH(与旧行为一致;resolve 注入 exists 便于单测)
}
