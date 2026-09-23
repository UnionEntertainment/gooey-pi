import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PetDefinition, PrimeWorkApi } from '@/types/api'

export type PetActivity = 'idle' | 'running-left' | 'running-right' | 'speaking' | 'working' | 'waiting' | 'jumping' | 'failed'

const ANIMATIONS: Record<PetActivity, { row: number; frameDurations: readonly number[] }> = {
  idle: { row: 0, frameDurations: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left': { row: 2, frameDurations: [120, 120, 120, 120, 120, 120, 120, 220] },
  speaking: { row: 3, frameDurations: [140, 140, 140, 280] },
  jumping: { row: 4, frameDurations: [140, 140, 140, 140, 280] },
  failed: { row: 5, frameDurations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, frameDurations: [150, 150, 150, 150, 150, 260] },
  working: { row: 8, frameDurations: [150, 150, 150, 150, 150, 280] },
}

function useMediaReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  return reduced
}

function SpritesheetPet({ dataUrl, activity, size, reduceMotion }: { dataUrl: string; activity: PetActivity; size: number; reduceMotion: boolean }) {
  const animation = ANIMATIONS[activity]
  const height = Math.round(size * 208 / 192)
  const imageRef = useRef<HTMLImageElement>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const image = imageRef.current
    const root = rootRef.current
    if (!image || !root) return
    const applyFrame = (frameIndex: number) => {
      image.style.transform = `translate(${-frameIndex * size}px, ${-animation.row * height}px)`
    }
    applyFrame(0)
    if (reduceMotion || animation.frameDurations.length <= 1) return
    let frameIndex = 0
    let timer = 0
    let visible = typeof IntersectionObserver === 'undefined'
    const scheduleNextFrame = () => {
      timer = window.setTimeout(() => {
        frameIndex = (frameIndex + 1) % animation.frameDurations.length
        applyFrame(frameIndex)
        scheduleNextFrame()
      }, animation.frameDurations[frameIndex])
    }
    const syncTimer = () => {
      window.clearTimeout(timer)
      timer = 0
      if (visible && !document.hidden) scheduleNextFrame()
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true
      syncTimer()
    })
    observer?.observe(root)
    document.addEventListener('visibilitychange', syncTimer)
    syncTimer()
    return () => {
      window.clearTimeout(timer)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', syncTimer)
    }
  }, [activity, animation, reduceMotion, size, height])
  return (
    <span ref={rootRef} className="pet-sprite" style={{ width: size, height } as CSSProperties} aria-hidden="true">
      <img
        ref={imageRef}
        src={dataUrl}
        alt=""
        draggable={false}
        style={{
          width: size * 8,
          height: height * 9,
          transform: `translate(0px, ${-animation.row * height}px)`,
        }}
      />
    </span>
  )
}

function OrbPet({ activity, size, reduceMotion }: { activity: PetActivity; size: number; reduceMotion: boolean }) {
  return (
    <span className={`pet-orb pet-orb--${activity}${reduceMotion ? ' is-reduced-motion' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <i /><i /><i />
    </span>
  )
}

export function PetAvatar({ pet, pets, activity = 'idle', size = 92, reduceMotion = false }: {
  pet: PetDefinition
  pets: PrimeWorkApi['pets'] | null
  activity?: PetActivity
  size?: number
  reduceMotion?: boolean
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setDataUrl(null)
    if (pet.kind !== 'spritesheet' || !pets) return () => { active = false }
    void pets.sprite(pet.id).then((value) => { if (active) setDataUrl(value) }).catch(() => { if (active) setDataUrl(null) })
    return () => { active = false }
  }, [pet.id, pet.kind, pets])
  const mediaReducedMotion = useMediaReducedMotion()
  const reduced = reduceMotion || mediaReducedMotion
  if (pet.kind === 'orb') return <OrbPet activity={activity} size={size} reduceMotion={reduced} />
  if (dataUrl) return <SpritesheetPet dataUrl={dataUrl} activity={activity} size={size} reduceMotion={reduced} />
  return <span className="pet-placeholder" style={{ width: size, height: Math.round(size * 208 / 192) }} aria-hidden="true" />
}
