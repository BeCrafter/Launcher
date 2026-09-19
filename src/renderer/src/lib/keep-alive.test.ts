import { describe, expect, it } from 'vitest'
import type { AgentForm } from '@shared/models'
import { keepAlivePreset, keepAlivePresetState } from './keep-alive'

const form = (keepAlive: boolean, mode: AgentForm['keepAliveMode'], dict: AgentForm['keepAliveDict']): Pick<AgentForm, 'triggers' | 'keepAliveMode' | 'keepAliveDict'> => ({
  triggers: { runAtLoad: false, keepAlive, watchPaths: false, startCalendarInterval: false, startInterval: null },
  keepAliveMode: mode,
  keepAliveDict: dict
})

describe('KeepAlive semantic presets', () => {
  it('maps bool and common dictionary forms to readable policies', () => {
    expect(keepAlivePreset(form(false, 'bool', { crashed: null, successfulExit: null }))).toBe('off')
    expect(keepAlivePreset(form(true, 'bool', { crashed: null, successfulExit: null }))).toBe('always')
    expect(keepAlivePreset(form(true, 'dict', { crashed: true, successfulExit: null }))).toBe('crashed')
    expect(keepAlivePreset(form(true, 'dict', { crashed: null, successfulExit: true }))).toBe('successfulExit')
    expect(keepAlivePreset(form(true, 'dict', { crashed: null, successfulExit: false }))).toBe('failedExit')
  })

  it('keeps combined or reverse conditions in the custom bucket', () => {
    expect(keepAlivePreset(form(true, 'dict', { crashed: true, successfulExit: false }))).toBe('custom')
    expect(keepAlivePreset(form(true, 'dict', { crashed: false, successfulExit: null }))).toBe('custom')
  })

  it('maps presets back without collapsing explicit false values', () => {
    expect(keepAlivePresetState('always')).toMatchObject({ keepAlive: true, mode: 'bool' })
    expect(keepAlivePresetState('crashed')).toMatchObject({ keepAlive: true, mode: 'dict', dict: { crashed: true, successfulExit: null } })
    expect(keepAlivePresetState('failedExit')).toMatchObject({ keepAlive: true, mode: 'dict', dict: { crashed: null, successfulExit: false } })
    expect(keepAlivePresetState('off')).toMatchObject({ keepAlive: false, mode: 'bool' })
  })
})
