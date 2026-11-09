// 文件行的小工具:扩展名 → 图标。纯函数,渲染层与单测共用。
//
// 图标只表达「大致是什么」:精确类型在使用者脑子里,行里再写字反而挤。
// 认不出来的扩展名一律用通用文件图标,不做按 MIME 的猜测(本地文件没有可靠的 MIME)。

const ICONS: Record<string, string> = {
  // 图片
  png: 'fa-file-image',
  jpg: 'fa-file-image',
  jpeg: 'fa-file-image',
  gif: 'fa-file-image',
  webp: 'fa-file-image',
  avif: 'fa-file-image',
  bmp: 'fa-file-image',
  svg: 'fa-file-image',
  // 文档
  pdf: 'fa-file-pdf',
  doc: 'fa-file-word',
  docx: 'fa-file-word',
  xls: 'fa-file-excel',
  xlsx: 'fa-file-excel',
  ppt: 'fa-file-powerpoint',
  pptx: 'fa-file-powerpoint',
  txt: 'fa-file-lines',
  rtf: 'fa-file-lines',
  md: 'fa-file-lines',
  // 媒体
  mp4: 'fa-file-video',
  webm: 'fa-file-video',
  mov: 'fa-file-video',
  m4v: 'fa-file-video',
  ogv: 'fa-file-video',
  mp3: 'fa-file-audio',
  m4a: 'fa-file-audio',
  wav: 'fa-file-audio',
  ogg: 'fa-file-audio',
  oga: 'fa-file-audio',
  flac: 'fa-file-audio',
  aac: 'fa-file-audio',
  // 压缩包
  zip: 'fa-file-zipper',
  rar: 'fa-file-zipper',
  '7z': 'fa-file-zipper',
  gz: 'fa-file-zipper',
  tar: 'fa-file-zipper',
  // 代码 / 网页
  html: 'fa-file-code',
  htm: 'fa-file-code',
  json: 'fa-file-code',
  js: 'fa-file-code',
  ts: 'fa-file-code',
  css: 'fa-file-code',
  py: 'fa-file-code',
  sh: 'fa-file-code',
  yml: 'fa-file-code',
  yaml: 'fa-file-code'
}

export function noteFileIcon(ext: string): string {
  return ICONS[ext.toLowerCase()] ?? 'fa-file'
}
