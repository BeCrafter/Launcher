// 主题/语言展示标签(demo utils.js themeLabel/languageLabel;键解析后由调用方经 t() 翻译)
export function themeLabelKey(theme: string): string {
  const map: Record<string, string> = {
    system: 'settings.theme.system',
    light: 'settings.theme.light',
    dark: 'settings.theme.dark'
  }
  return map[theme] ?? theme
}

export function languageLabel(lang: string, t: (k: string) => string): string {
  return lang === 'en-US' ? 'English' : t('common.chinese')
}
