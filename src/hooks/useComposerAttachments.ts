import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { PromptImage } from '@/types/api'

const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
export const MAX_COMPOSER_FILE_COUNT = 8
export const MAX_COMPOSER_IMAGE_SOURCE_BYTES = 1_350_000
/** Per-file and combined caps on inlined text so the prompt stays well under the RPC message limit. */
export const MAX_COMPOSER_TEXT_FILE_CHARS = 200_000
export const MAX_COMPOSER_TEXT_TOTAL_CHARS = 400_000

export interface ComposerImage extends PromptImage {
  id: string
  name: string
  size: number
}

export interface ComposerTextFile {
  id: string
  name: string
  size: number
  mimeType: string
  text: string
  truncated: boolean
}

interface UseComposerAttachmentsOptions {
  shortName: string
}

function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return window.btoa(binary)
}

const DOWNSCALE_RATIOS = [1, 0.75, 0.5, 0.35, 0.25]
const DOWNSCALE_QUALITIES = [0.85, 0.7, 0.55]

async function renderScaledBlob(
  bitmap: ImageBitmap,
  ratio: number,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
  const context = canvas.getContext('2d')
  if (!context) return null
  // JPEG has no alpha channel; transparent pixels need a matte or they turn black.
  if (mimeType === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality))
}

async function downscaleImage(
  file: File,
  maxBytes: number,
): Promise<{ data: string; size: number; mimeType: 'image/webp' | 'image/jpeg' } | null> {
  // A GIF flattened through canvas loses its animation, so it keeps the size error.
  if (file.type.toLowerCase() === 'image/gif' || maxBytes <= 0) return null
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(file)
    try {
      for (const ratio of DOWNSCALE_RATIOS) {
        for (const quality of DOWNSCALE_QUALITIES) {
          for (const mimeType of ['image/webp', 'image/jpeg'] as const) {
            const blob = await renderScaledBlob(bitmap, ratio, mimeType, quality)
            if (blob && blob.size <= maxBytes) {
              return { data: base64FromBuffer(await blob.arrayBuffer()), size: blob.size, mimeType }
            }
          }
        }
      }
      return null
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

const SNIFF_BYTES = 8192

/**
 * Reads a file as text, or returns null when the content looks binary. UTF-16
 * BOMs get their own decoder; everything else is treated as UTF-8 and rejected
 * when the first chunk carries NUL bytes or a heavy control-character ratio.
 */
async function readTextFile(file: File): Promise<{ text: string; truncated: boolean } | null> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
  const utf16 = head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
  if (!utf16) {
    let control = 0
    for (const byte of head) {
      if (byte === 0) return null
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1
    }
    if (control / Math.max(1, head.length) > 0.05) return null
  }
  const encoding = utf16 ? (head[0] === 0xff ? 'utf-16le' : 'utf-16be') : 'utf-8'
  // UTF-16 decodes to roughly half the byte count; read enough extra to cover
  // the per-file character cap before trimming.
  const byteLimit = utf16 ? MAX_COMPOSER_TEXT_FILE_CHARS * 2 + 4 : MAX_COMPOSER_TEXT_FILE_CHARS + 4
  const buffer = await file.slice(0, byteLimit).arrayBuffer()
  const text = new TextDecoder(encoding).decode(buffer)
  return text.length > MAX_COMPOSER_TEXT_FILE_CHARS
    ? { text: text.slice(0, MAX_COMPOSER_TEXT_FILE_CHARS), truncated: true }
    : { text, truncated: file.size > byteLimit }
}

function isFileDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

export function useComposerAttachments({ shortName }: UseComposerAttachmentsOptions) {
  const [images, setImages] = useState<ComposerImage[]>([])
  const [textFiles, setTextFiles] = useState<ComposerTextFile[]>([])
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const imagesRef = useRef<ComposerImage[]>([])
  const textFilesRef = useRef<ComposerTextFile[]>([])
  const pendingBatchesRef = useRef(0)
  const errorRevisionRef = useRef(0)
  const reservedCountRef = useRef(0)
  const reservedBytesRef = useRef(0)
  const dragDepthRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const updateError = useCallback((message: string) => {
    errorRevisionRef.current += 1
    setError(message)
  }, [])

  const ingest = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return
    const startingErrorRevision = errorRevisionRef.current
    if (imagesRef.current.length + textFilesRef.current.length + reservedCountRef.current + files.length > MAX_COMPOSER_FILE_COUNT) {
      updateError(`You can attach up to ${MAX_COMPOSER_FILE_COUNT} files.`)
      return
    }

    const imageFiles = files.filter((file) => supportedImageTypes.has(file.type.toLowerCase()))
    const otherFiles = files.filter((file) => !supportedImageTypes.has(file.type.toLowerCase()))
    const rejectedNames: string[] = []
    if (otherFiles.length > 0) {
      reservedCountRef.current += otherFiles.length
      pendingBatchesRef.current += 1
      setProcessing(true)
      try {
        const added: ComposerTextFile[] = []
        let textChars = textFilesRef.current.reduce((sum, file) => sum + file.text.length, 0)
        for (const [index, file] of otherFiles.entries()) {
          const name = file.name || `Attached file ${index + 1}`
          const remaining = MAX_COMPOSER_TEXT_TOTAL_CHARS - textChars
          if (remaining <= 0) {
            rejectedNames.push(name)
            continue
          }
          const read = await readTextFile(file)
          if (!read) {
            rejectedNames.push(name)
            continue
          }
          const truncated = read.truncated || read.text.length > remaining
          added.push({
            id: crypto.randomUUID(),
            name,
            size: file.size,
            mimeType: file.type.toLowerCase() || 'text/plain',
            text: read.text.slice(0, remaining),
            truncated,
          })
          textChars += Math.min(read.text.length, remaining)
        }
        if (!mountedRef.current) return
        if (added.length > 0) {
          const next = [...textFilesRef.current, ...added]
          textFilesRef.current = next
          setTextFiles(next)
        }
      } catch {
        if (mountedRef.current) updateError(`${shortName} could not read the file.`)
      } finally {
        reservedCountRef.current -= otherFiles.length
        pendingBatchesRef.current -= 1
        if (mountedRef.current && pendingBatchesRef.current === 0) setProcessing(false)
      }
    }
    if (imageFiles.length === 0) {
      if (rejectedNames.length > 0) {
        updateError(`${rejectedNames.join(', ')} cannot be attached. Only text files and images are supported.`)
      } else if (otherFiles.length > 0 && errorRevisionRef.current === startingErrorRevision) {
        setError('')
      }
      return
    }

    const sourceBytes = imageFiles.reduce((sum, file) => sum + file.size, 0)

    reservedCountRef.current += imageFiles.length
    reservedBytesRef.current += sourceBytes
    pendingBatchesRef.current += 1
    setProcessing(true)
    try {
      const added: ComposerImage[] = []
      let acceptedBytes = 0
      let rejected = 0
      for (const [index, file] of imageFiles.entries()) {
        // In-flight batches reserve their raw source size as an upper bound, so
        // only this batch's own reservation is excluded from its budget.
        const remaining = MAX_COMPOSER_IMAGE_SOURCE_BYTES
          - imagesRef.current.reduce((sum, image) => sum + image.size, 0)
          - (reservedBytesRef.current - sourceBytes)
          - acceptedBytes
        const name = file.name || `Attached image ${index + 1}`
        if (file.size <= remaining) {
          added.push({
            id: crypto.randomUUID(),
            name,
            size: file.size,
            type: 'image',
            mimeType: file.type.toLowerCase(),
            data: base64FromBuffer(await file.arrayBuffer()),
          })
          acceptedBytes += file.size
          continue
        }
        const scaled = await downscaleImage(file, remaining)
        if (!scaled) {
          rejected += 1
          continue
        }
        added.push({ id: crypto.randomUUID(), name, size: scaled.size, type: 'image', mimeType: scaled.mimeType, data: scaled.data })
        acceptedBytes += scaled.size
      }
      if (!mountedRef.current) return
      if (added.length > 0) {
        const next = [...imagesRef.current, ...added]
        imagesRef.current = next
        setImages(next)
      }
      if (rejectedNames.length > 0) updateError(`${rejectedNames.join(', ')} cannot be attached. Only text files and images are supported.`)
      else if (rejected === imageFiles.length) updateError('These images are too large to send. Attach smaller images (about 1.3 MB total).')
      else if (rejected > 0) updateError(`Skipped ${rejected} image${rejected === 1 ? '' : 's'} that stayed over the size limit after scaling down.`)
      else if (errorRevisionRef.current === startingErrorRevision) setError('')
    } catch {
      if (mountedRef.current) updateError(`${shortName} could not read the image.`)
    } finally {
      reservedCountRef.current -= imageFiles.length
      reservedBytesRef.current -= sourceBytes
      pendingBatchesRef.current -= 1
      if (mountedRef.current && pendingBatchesRef.current === 0) setProcessing(false)
    }
  }, [shortName, updateError])

  const clear = useCallback(() => {
    imagesRef.current = []
    textFilesRef.current = []
    setImages([])
    setTextFiles([])
  }, [])

  const remove = useCallback((id: string) => {
    const nextImages = imagesRef.current.filter((image) => image.id !== id)
    const nextFiles = textFilesRef.current.filter((file) => file.id !== id)
    imagesRef.current = nextImages
    textFilesRef.current = nextFiles
    setImages(nextImages)
    setTextFiles(nextFiles)
    updateError('')
  }, [updateError])

  const restoreWithinLimits = useCallback((restored: ComposerImage[]) => {
    const current = imagesRef.current
    const currentIds = new Set(current.map((image) => image.id))
    let count = current.length + textFilesRef.current.length + reservedCountRef.current
    let bytes = current.reduce((sum, image) => sum + image.size, 0) + reservedBytesRef.current
    const accepted: ComposerImage[] = []
    let omitted = 0
    for (const image of restored) {
      if (currentIds.has(image.id)) continue
      if (count >= MAX_COMPOSER_FILE_COUNT || bytes + image.size > MAX_COMPOSER_IMAGE_SOURCE_BYTES) {
        omitted += 1
        continue
      }
      count += 1
      bytes += image.size
      accepted.push(image)
    }
    if (accepted.length > 0) {
      const next = [...accepted, ...current]
      imagesRef.current = next
      setImages(next)
    }
    return { restored: accepted.length, omitted }
  }, [])

  const restoreTextFiles = useCallback((restored: ComposerTextFile[]) => {
    const current = textFilesRef.current
    const currentIds = new Set(current.map((file) => file.id))
    let count = current.length + imagesRef.current.length + reservedCountRef.current
    let textChars = current.reduce((sum, file) => sum + file.text.length, 0)
    const accepted = restored.filter((file) => {
      if (currentIds.has(file.id) || count >= MAX_COMPOSER_FILE_COUNT || textChars + file.text.length > MAX_COMPOSER_TEXT_TOTAL_CHARS) return false
      count += 1
      textChars += file.text.length
      return true
    })
    if (accepted.length === 0) return
    const next = [...accepted, ...current]
    textFilesRef.current = next
    setTextFiles(next)
  }, [])

  const dragHandlers = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      dragDepthRef.current += 1
      setDragging(true)
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event)) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setDragging(false)
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      dragDepthRef.current = 0
      setDragging(false)
      void ingest(Array.from(event.dataTransfer.files))
    },
  }

  return {
    images,
    imagesRef,
    textFiles,
    textFilesRef,
    error,
    setError: updateError,
    processing,
    hasPending: () => pendingBatchesRef.current > 0,
    dragging,
    ingest,
    clear,
    remove,
    restoreWithinLimits,
    restoreTextFiles,
    dragHandlers,
  }
}
