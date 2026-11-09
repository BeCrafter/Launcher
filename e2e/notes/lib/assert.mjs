// 断言只做三件事:失败信息说清楚「期望 / 实际」,并带上定位用例的上下文。
// 不引测试框架 —— 用例是数据驱动的,runner 需要拿到结构化失败原因。

export class CaseFailure extends Error {
  constructor(message) {
    super(message)
    this.name = 'CaseFailure'
  }
}

function format(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  return JSON.stringify(value, null, 2)
}

export function ok(condition, message) {
  if (!condition) throw new CaseFailure(message)
}

/** 深比较用 JSON:用例里断言的都是可序列化的数组 / 对象。 */
export function eq(actual, expected, message) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) {
    throw new CaseFailure(`${message}\n  期望: ${format(expected)}\n  实际: ${format(actual)}`)
  }
}

export function ne(actual, forbidden, message) {
  if (JSON.stringify(actual) === JSON.stringify(forbidden)) {
    throw new CaseFailure(`${message}\n  不应等于: ${format(forbidden)}`)
  }
}

export function includes(haystack, needle, message) {
  if (!String(haystack).includes(needle)) {
    throw new CaseFailure(`${message}\n  期望包含: ${format(needle)}\n  实际: ${format(haystack)}`)
  }
}

export function excludes(haystack, needle, message) {
  if (String(haystack).includes(needle)) {
    throw new CaseFailure(`${message}\n  不应包含: ${format(needle)}\n  实际: ${format(haystack)}`)
  }
}

export function truthy(value, message) {
  if (!value) throw new CaseFailure(`${message}\n  实际: ${format(value)}`)
}

export function falsy(value, message) {
  if (value) throw new CaseFailure(`${message}\n  实际: ${format(value)}`)
}
