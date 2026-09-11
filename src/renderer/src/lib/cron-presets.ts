// cron 快速预设(demo cronPresets 的真实化落位;文案键沿用 i18n 字典)
import type { CronPreset } from '@shared/models'

export const CRON_PRESETS: CronPreset[] = [
  { labelKey: 'cron.preset.minute', expr: '* * * * *', descKey: 'cron.preset.minuteDesc' },
  { labelKey: 'cron.preset.hourly', expr: '0 * * * *', descKey: 'cron.preset.hourlyDesc' },
  { labelKey: 'cron.preset.daily9', expr: '0 9 * * *', descKey: 'cron.preset.daily9Desc' },
  { labelKey: 'cron.preset.monday', expr: '0 9 * * 1', descKey: 'cron.preset.mondayDesc' },
  { labelKey: 'cron.preset.monthly1', expr: '0 0 1 * *', descKey: 'cron.preset.monthly1Desc' },
  { labelKey: 'cron.preset.weekday', expr: '0 9 * * 1-5', descKey: 'cron.preset.weekdayDesc' }
]
