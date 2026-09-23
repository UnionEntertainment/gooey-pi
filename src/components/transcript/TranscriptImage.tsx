import { useMemo, useState } from 'react'
import { ImageLightbox } from '../ui'

interface TranscriptImageProps {
  source: string
  alt: string
}

/**
 * Reads pixel dimensions straight out of a data URL's encoded header so the
 * preview can reserve its exact box before the image decodes — no layout
 * shift. Supports the formats imageSource() admits: PNG, GIF, JPEG, WebP.
 */
function dataUrlImageSize(source: string): { width: number; height: number } | undefined {
  const comma = source.indexOf(',')
  if (comma < 0) return undefined
  try {
    const binary = atob(source.slice(comma + 1, comma + 1 + 4096))
    const byte = (index: number) => binary.charCodeAt(index)
    const u16 = (index: number) => (byte(index) << 8) | byte(index + 1)
    const u16le = (index: number) => byte(index) | (byte(index + 1) << 8)
    const u32 = (index: number) => ((byte(index) << 24) | (byte(index + 1) << 16) | (byte(index + 2) << 8) | byte(index + 3)) >>> 0
    if (binary.length >= 24 && binary.startsWith('\x89PNG')) return { width: u32(16), height: u32(20) }
    if (binary.length >= 10 && (binary.startsWith('GIF87a') || binary.startsWith('GIF89a'))) return { width: u16le(6), height: u16le(8) }
    if (binary.length >= 4 && byte(0) === 0xff && byte(1) === 0xd8) {
      let offset = 2
      while (offset + 9 < binary.length) {
        if (byte(offset) !== 0xff) { offset += 1; continue }
        const marker = byte(offset + 1)
        if (marker === 0x00 || marker === 0xff) { offset += 1; continue }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue }
        const length = u16(offset + 2)
        if (length < 2) return undefined
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: u16(offset + 7), height: u16(offset + 5) }
        }
        offset += 2 + length
      }
      return undefined
    }
    if (binary.length >= 30 && binary.startsWith('RIFF') && binary.slice(8, 12) === 'WEBP') {
      const chunk = binary.slice(12, 16)
      if (chunk === 'VP8 ' && binary.length >= 30) return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff }
      if (chunk === 'VP8L' && binary.length >= 25) {
        const bits = u32(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
      if (chunk === 'VP8X' && binary.length >= 30) {
        const width = byte(24) | (byte(25) << 8) | (byte(26) << 16)
        const height = byte(27) | (byte(28) << 8) | (byte(29) << 16)
        return { width: width + 1, height: height + 1 }
      }
    }
  } catch {
    // Malformed data URL: fall through and let the image size itself.
  }
  return undefined
}

export function TranscriptImage({ source, alt }: TranscriptImageProps) {
  const [open, setOpen] = useState(false)
  const size = useMemo(() => dataUrlImageSize(source), [source])

  return <>
    <button type="button" className="image-part__preview" aria-label="Expand pasted image" onClick={() => setOpen(true)}>
      <img className="image-part" src={source} alt={alt} width={size?.width} height={size?.height} loading="lazy" decoding="async" />
    </button>
    {open ? <ImageLightbox source={source} alt={alt} title="Expanded pasted image" onClose={() => setOpen(false)} /> : null}
  </>
}
