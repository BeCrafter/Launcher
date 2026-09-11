// 服务分类管线纯函数(阶段 3):brew → dev → node → python → php → jvm → ruby → docker → process
// 判定依据 = 进程命令 basename(ps comm,完整可信) + 完整命令行(cmd) + brew services 名称集;
// 桶(type)保持 demo 三组(brew/node/process)+ docker(docker 容器条目由 docker-service 直接产出);
// 细分 kind 只进卡片 tooltip(evidence + kind 由 renderer 经 i18n 渲染)

import type { SvcKind, SvcType } from '../../shared/models'

export interface ClassifyInput {
  command: string
  cmd: string
  port: number
}

export interface ClassifyResult {
  type: SvcType
  kind: SvcKind
  /** tooltip 参数(通常为命令名,填入 svc.cls.* 的 {C} 槽) */
  evidence: string
}

const DEV_PATTERN = /(vite|webpack-dev-server|nodemon|next dev|next-server|nuxt|astro dev|react-scripts|ng serve|ts-node-dev|tsx watch)/i

function basename(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? p.slice(idx + 1) : p
}

/** brew services 名称 → 进程名主干(去掉 @版本;postgresql → postgres 等别名) */
const BREW_STEM_ALIASES: Record<string, string> = {
  postgresql: 'postgres'
}
const BREW_STEM_SUFFIXES = ['', '-server', '-d', 'd', '-fpm', 'fpm']

/** brew services 名称与进程名的常见变形匹配(redis → redis-server;mysql@8.4 → mysqld;php@8.1 → php-fpm) */
export function matchesBrewService(command: string, brewServices: ReadonlySet<string>): string | null {
  const base = basename(command)
  for (const name of brewServices) {
    if (base === name) return name
    const rawStem = name.split('@')[0]
    const stem = BREW_STEM_ALIASES[rawStem] ?? rawStem
    if (BREW_STEM_SUFFIXES.some((s) => base === `${stem}${s}`)) return name
  }
  return null
}

export function classifyService(input: ClassifyInput, brewServices: ReadonlySet<string>): ClassifyResult {
  const base = basename(input.command)
  const cmd = input.cmd

  const brewHit = matchesBrewService(input.command, brewServices)
  if (brewHit) return { type: 'brew', kind: 'brew', evidence: base }

  if (base === 'node' || /^node(@|$)/.test(base)) {
    if (DEV_PATTERN.test(cmd)) return { type: 'node', kind: 'dev', evidence: base }
    return { type: 'node', kind: 'node', evidence: base }
  }

  if (/^python[\d.]*$/.test(base) || base === 'uvicorn' || base === 'gunicorn') {
    return { type: 'process', kind: 'python', evidence: base }
  }
  if (/^php(-fpm)?[\d.]*$/.test(base) || base === 'php-fpm') {
    return { type: 'process', kind: 'php', evidence: base }
  }
  if (base === 'java' || base === 'javaw') {
    return { type: 'process', kind: 'jvm', evidence: base }
  }
  if (/^ruby[\d.]*$/.test(base) || base === 'puma' || base === 'rails') {
    return { type: 'process', kind: 'ruby', evidence: base }
  }
  if (base.startsWith('com.docker')) {
    return { type: 'process', kind: 'docker', evidence: base }
  }
  return { type: 'process', kind: 'process', evidence: base }
}
