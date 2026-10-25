// `/` 菜单的行:内置技能 + 一个「添加本地文件」操作。
//
// 抽出来是因为输入框自己也要判断「查询词还能匹配到东西吗」:
// 中文里的 `/` 不一定是命令(「上午/下午」「输入/输出」),边界放宽到中文之后,
// 只有能匹配到菜单项时才把菜单留着。两边必须用同一套匹配规则 ——
// 否则会出现「菜单开着却一行都没有」或「有匹配却不弹」。
import type { AiSkillInfo } from '@shared/ai'
import type { QueryHit } from '@shared/ai-inline'

export interface SlashSkillRow {
  type: 'skill'
  skill: AiSkillInfo
  label: string
  desc: string
  haystack: string
}

export interface SlashFileRow {
  type: 'file'
  label: string
  desc: string
  haystack: string
}

export type SlashRow = SlashSkillRow | SlashFileRow

/** 按查询词过滤后的菜单行;空查询返回全部 */
export function slashRows(
  query: string,
  skills: AiSkillInfo[],
  t: (key: string) => string
): SlashRow[] {
  const q = query.trim().toLowerCase()
  const hit = (haystack: string): boolean => q === '' || haystack.toLowerCase().includes(q)
  const skillRows: SlashSkillRow[] = skills
    .map((skill) => {
      const label = t(skill.nameKey)
      const desc = t(skill.descKey)
      return {
        type: 'skill' as const,
        skill,
        label,
        desc,
        haystack: `${label} ${desc} ${skill.id} ${skill.tag} ${skill.nameKey}`
      }
    })
    .filter((r) => hit(r.haystack))
  const fileRow: SlashFileRow = {
    type: 'file',
    label: t('ai.slash.file'),
    desc: t('ai.slash.fileDesc'),
    haystack: `file upload attach ${t('ai.slash.file')} ${t('ai.slash.fileDesc')} 文件 上传 附件`
  }
  return [...skillRows, ...(hit(fileRow.haystack) ? [fileRow] : [])]
}

/**
 * 这个 `/` 该不该开菜单。
 *
 * 行首/空白后/chip 后一律算命令(查询词匹配不到时仍显示空态,是给用户看的反馈);
 * 中文之后只在「查询词为空」或「还有匹配项」时才算 —— 中文里的 `/` 常常只是并列
 * (「上午/下午」「输入/输出」),不能跟着整句话把菜单挂着。
 */
export function isSlashCommand(
  hit: QueryHit,
  skills: AiSkillInfo[],
  t: (key: string) => string
): boolean {
  if (hit.boundary !== 'cjk') return true
  return hit.query === '' || slashRows(hit.query, skills, t).length > 0
}
