// 架构标签:main 返回 process.arch → demo 同款展示文案(utils.js archLabel 语义)
export function archLabel(arch: string): string {
  return arch === 'arm64' ? 'Apple Silicon' : arch === 'x64' ? 'Intel' : arch
}
