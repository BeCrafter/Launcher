import { describe, it, expect } from 'vitest'
import { APP_NAME, APP_VERSION } from './constants'

describe('shared constants', () => {
  it('app name is stable', () => {
    expect(APP_NAME).toBe('Launcher')
  })

  it('version matches package.json', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
