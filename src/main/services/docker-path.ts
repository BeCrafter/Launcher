// docker 可执行文件定位(绝对路径):Finder/Dock 启动的 Electron 进程 PATH 精简,裸 `docker` 必 ENOENT
// 本机实测(Docker Desktop):which docker 只命中 Docker.app 内的路径,/usr/local/bin/docker 不存在
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  '/Applications/Docker.app/Contents/Resources/bin/docker', // Docker Desktop
  '/opt/homebrew/bin/docker', // brew(Apple Silicon)
  '/usr/local/bin/docker', // brew(Intel)/ Docker Desktop 旧版软链
  '/Applications/OrbStack.app/Contents/MacOS/xbin/docker', // OrbStack(未真机核对;写错无害)
  '/Applications/OrbStack.app/Contents/Resources/xbin/docker'
]

// Colima 不单列:它是 VM 运行时,docker CLI 由 brew 提供(已被上面覆盖)
const HOME_CANDIDATES = ['.orbstack/bin/docker', '.docker/bin/docker']

export function resolveDockerPath(
  exists: (p: string) => boolean = existsSync,
  home: string = homedir()
): string {
  for (const p of CANDIDATES) {
    if (exists(p)) return p
  }
  for (const rel of HOME_CANDIDATES) {
    const p = join(home, rel)
    if (exists(p)) return p
  }
  return 'docker' // 兜底走 PATH(与旧行为一致;注入 exists/home 便于单测)
}
