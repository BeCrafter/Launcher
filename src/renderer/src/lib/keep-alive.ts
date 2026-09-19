import type { AgentForm, KeepAliveDict, KeepAliveMode } from '@shared/models'

/** User-facing policies mapped to launchd's KeepAlive representations. */
export type KeepAlivePreset = 'off' | 'always' | 'crashed' | 'successfulExit' | 'failedExit' | 'custom'

export interface KeepAlivePresetState {
  keepAlive: boolean
  mode: KeepAliveMode
  dict: KeepAliveDict
}

const EMPTY_DICT: KeepAliveDict = { crashed: null, successfulExit: null }

function dict(crashed: boolean | null, successfulExit: boolean | null): KeepAlivePresetState {
  return { keepAlive: true, mode: 'dict', dict: { crashed, successfulExit } }
}

/** Collapse the raw plist representation into a small set of understandable policies. */
export function keepAlivePreset(form: Pick<AgentForm, 'triggers' | 'keepAliveMode' | 'keepAliveDict'>): KeepAlivePreset {
  if (!form.triggers.keepAlive) return 'off'
  if (form.keepAliveMode === 'bool') return 'always'
  const { crashed, successfulExit } = form.keepAliveDict
  if (crashed === true && successfulExit === null) return 'crashed'
  if (crashed === null && successfulExit === true) return 'successfulExit'
  if (crashed === null && successfulExit === false) return 'failedExit'
  return 'custom'
}

/** Convert a user-facing preset back to the exact bool/dict shape expected by plistFromForm. */
export function keepAlivePresetState(preset: KeepAlivePreset): KeepAlivePresetState {
  switch (preset) {
    case 'always':
      return { keepAlive: true, mode: 'bool', dict: { ...EMPTY_DICT } }
    case 'crashed':
      return dict(true, null)
    case 'successfulExit':
      return dict(null, true)
    case 'failedExit':
      return dict(null, false)
    case 'custom':
      return { keepAlive: true, mode: 'dict', dict: { ...EMPTY_DICT } }
    case 'off':
    default:
      return { keepAlive: false, mode: 'bool', dict: { ...EMPTY_DICT } }
  }
}
