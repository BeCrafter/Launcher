// utif 没有官方类型;只声明我们用到的五个成员。
declare module 'utif' {
  export interface UTIFImage {
    width: number
    height: number
    [key: string]: unknown
  }
  export function decode(buffer: ArrayBuffer | Uint8Array): UTIFImage[]
  export function decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: UTIFImage): void
  export function toRGBA8(ifd: UTIFImage): Uint8Array
  const UTIF: {
    decode: typeof decode
    decodeImage: typeof decodeImage
    toRGBA8: typeof toRGBA8
  }
  export default UTIF
}
