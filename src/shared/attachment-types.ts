// 附件类型判定:main 的入参收敛与 renderer 的文件选择必须用同一套白名单,
// 否则会出现「输入框允许选、发到 main 被判非法」或反过来的漂移。

const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif'
])

const TEXT_EXTS = new Set([
  'txt',
  'text',
  'md',
  'markdown',
  'mdx',
  'json',
  'jsonl',
  'log',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'xml',
  'plist',
  'ini',
  'conf',
  'cfg',
  'toml',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'sh',
  'zsh',
  'bash',
  'fish',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sql',
  'env',
  'gitignore',
  'dockerfile',
  'makefile',
  'diff',
  'patch'
])

const TEXT_MIMES = new Set([
  'application/json',
  'application/jsonl',
  'application/xml',
  'application/x-plist',
  'application/x-yaml',
  'application/toml',
  'application/javascript',
  'application/typescript',
  'application/x-sh',
  'application/sql'
])

export function normalizeAttachmentMime(v: unknown): string {
  if (typeof v !== 'string') return ''
  const m = v.trim().toLowerCase()
  return m === 'image/jpg' ? 'image/jpeg' : m
}

export function attachmentExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 图片:MIME 白名单;MIME 为空时按扩展名兜底(SVG 永远不在白名单里) */
export function isSupportedImageName(name: string, mime: string): boolean {
  if (IMAGE_MIMES.has(mime)) return true
  return mime === '' && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(attachmentExt(name))
}

/** 文本:扩展名或 MIME 任一命中即可(很多系统给 .md/.log 的 MIME 是空) */
export function isSupportedTextName(name: string, mime: string): boolean {
  if (TEXT_EXTS.has(attachmentExt(name)) || TEXT_EXTS.has(name.toLowerCase())) return true
  if (mime.startsWith('text/')) return true
  return TEXT_MIMES.has(mime)
}
