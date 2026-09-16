import { describe, expect, it } from 'vitest'
import {
  cronLogDir,
  cronLogLegacyPath,
  cronLogTemplate,
  isCronLogTemplate,
  isLauncherCronLogPath,
  matchCronLogFile
} from './cron-log'

const HOME = '/Users/tester'
const ID = '2e6cedd4'

describe('cron-log 路径契约', () => {
  it('模板含壳展开的日期(%Y%m%d%H)与裸 %;未转义前的原形', () => {
    expect(cronLogTemplate(HOME, ID)).toBe(`${cronLogDir(HOME)}/${ID}-$(date +%Y%m%d%H).log`)
    expect(isCronLogTemplate(`${cronLogDir(HOME)}/${ID}-$(date +%Y%m%d%H).log`)).toBe(true)
    expect(isCronLogTemplate(cronLogLegacyPath(HOME, ID))).toBe(false)
  })

  it('matchCronLogFile:新式 10 位小时戳与旧式都命中(位宽必须与 %Y%m%d%H 一致)', () => {
    expect(matchCronLogFile(ID, `${ID}-2026091310.log`)).toBe(true) // 年月日时 = 10 位
    expect(matchCronLogFile(ID, `${ID}.log`)).toBe(true) // 旧式单文件
    expect(matchCronLogFile(ID, `${ID}-20260913.log`)).toBe(false) // 8 位不是本模板
    expect(matchCronLogFile(ID, 'other-2026091310.log')).toBe(false)
  })

  it('重复任务 id(带 -N 后缀)互不串:abc 不匹配 abc-1 的日志', () => {
    expect(matchCronLogFile('abc', 'abc-1-2026091310.log')).toBe(false)
    expect(matchCronLogFile('abc-1', 'abc-1-2026091310.log')).toBe(true)
    expect(matchCronLogFile('abc', 'abc.log')).toBe(true)
  })

  it('日志目录判定(应用自有重定向识别用)', () => {
    expect(isLauncherCronLogPath(HOME, `${cronLogDir(HOME)}/x.log`)).toBe(true)
    expect(isLauncherCronLogPath(HOME, '/var/log/x.log')).toBe(false)
  })
})
