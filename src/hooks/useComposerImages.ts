import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { PromptImage } from '@/types/api'

const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
export const MAX_COMPOSER_FILE_COUNT = 8
export const MAX_COMPOSER_IMAGE_SOURCE_BYTES = 1_350_000

export interface ComposerImage extends PromptImage {
  id: string
  name: string
  size: number
}

export interface ComposerUnsupportedFile {
  id: string
  name: string
  size: number
  mimeType: string
}

interface UseComposerImagesOptions {
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

function isFileDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

export function useComposerImages({ shortName }: UseComposerImagesOptions) {
  const [images, setImages] = useState<ComposerImage[]>([])
  const [unsupportedFiles, setUnsupportedFiles] = useState<ComposerUnsupportedFile[]>([])
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const imagesRef = useRef<ComposerImage[]>([])
  const unsupportedFilesRef = useRef<ComposerUnsupportedFile[]>([])
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
    if (imagesRef.current.length + unsupportedFilesRef.current.length + reservedCountRef.current + files.length > MAX_COMPOSER_FILE_COUNT) {
      updateError(`You can attach up to ${MAX_COMPOSER_FILE_COUNT} files.`)
      return
    }

    const imageFiles = files.filter((file) => supportedImageTypes.has(file.type.toLowerCase()))
    const otherFiles = files.filter((file) => !supportedImageTypes.has(file.type.toLowerCase()))
    if (otherFiles.length > 0) {
      const added = otherFiles.map((file, index): ComposerUnsupportedFile => ({
        id: crypto.randomUUID(),
        name: file.name || `Attached file ${index + 1}`,
        size: file.size,
        mimeType: file.type.toLowerCase() || 'application/octet-stream',
      }))
      const next = [...unsupportedFilesRef.current, ...added]
      unsupportedFilesRef.current = next
      setUnsupportedFiles(next)
      setError('')
    }
    if (imageFiles.length === 0) return

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
      if (rejected === imageFiles.length) updateError('These images are too large to send. Attach smaller images (about 1.3 MB total).')
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
    unsupportedFilesRef.current = []
    setImages([])
    setUnsupportedFiles([])
  }, [])

  const remove = useCallback((id: string) => {
    const nextImages = imagesRef.current.filter((image) => image.id !== id)
    const nextFiles = unsupportedFilesRef.current.filter((file) => file.id !== id)
    imagesRef.current = nextImages
    unsupportedFilesRef.current = nextFiles
    setImages(nextImages)
    setUnsupportedFiles(nextFiles)
    updateError('')
  }, [updateError])

  const restoreWithinLimits = useCallback((restored: ComposerImage[]) => {
    const current = imagesRef.current
    const currentIds = new Set(current.map((image) => image.id))
    let count = current.length + unsupportedFilesRef.current.length + reservedCountRef.current
    let bytes = current.reduce((sum, image) => sum + image.size, 0) + reservedBytesRef.current
    const accepted: ComposerImage[] = []
    let omitted = 0
    for (const image of restored) {
      if (currentIds.has(image.id)) continue
      if (count >= MAX_COMPOSER_FILE_COUNT || bytes + image.size > MAX_COMPOSER_IMAGE_SOURCE_BYTES) {
        omitted += 1
        continue
      }
      accepted.push(image)
      currentIds.add(image.id)
      count += 1
      bytes += image.size
    }
    if (accepted.length > 0) {
      const next = [...accepted, ...current]
      imagesRef.current = next
      setImages(next)
    }
    return { restored: accepted.length, omitted }
  }, [])

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragging(true)
  }, [])

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (dragDepthRef.current === 0) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragging(false)
  }, [])

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setDragging(false)
    void ingest(Array.from(event.dataTransfer.files))
  }, [ingest])

  return {
    images,
    imagesRef,
    unsupportedFiles,
    unsupportedFilesRef,
    error,
    setError: updateError,
    processing,
    hasPending: () => pendingBatchesRef.current > 0,
    dragging,
    ingest,
    clear,
    remove,
    restoreWithinLimits,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
