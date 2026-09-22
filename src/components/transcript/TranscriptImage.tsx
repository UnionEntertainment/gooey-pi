import { useState } from 'react'
import { ImageLightbox } from '../ui'

interface TranscriptImageProps {
  source: string
  alt: string
}

export function TranscriptImage({ source, alt }: TranscriptImageProps) {
  const [open, setOpen] = useState(false)

  return <>
    <button type="button" className="image-part__preview" aria-label="Expand pasted image" onClick={() => setOpen(true)}>
      <img className="image-part" src={source} alt={alt} />
    </button>
    {open ? <ImageLightbox source={source} alt={alt} title="Expanded pasted image" onClose={() => setOpen(false)} /> : null}
  </>
}
