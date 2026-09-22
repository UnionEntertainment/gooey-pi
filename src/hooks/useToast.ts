import { useState } from 'react'

export const TOAST_DURATION_MS = 2_500

// The Toast component owns the auto-dismiss timer so expiry can play the exit
// animation; this hook only tracks the current message.
export function useToast() {
  const [toast, setToast] = useState<string | null>(null)
  return { toast, setToast }
}
