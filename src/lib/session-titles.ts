const MANUAL_TITLES_KEY = 'prime-work.manual-session-titles'
const MAX_MANUAL_TITLES = 500

function readManualTitles(): string[] {
  try {
    const raw = window.localStorage.getItem(MANUAL_TITLES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/**
 * Sessions the user named by hand keep their title: prompt-driven retitling
 * skips them. Auto-titled sessions are not recorded, so a later manual rename
 * is the only signal needed.
 */
export function markSessionTitleManual(filePath: string): void {
  try {
    const titles = [filePath, ...readManualTitles().filter((item) => item !== filePath)]
    window.localStorage.setItem(MANUAL_TITLES_KEY, JSON.stringify(titles.slice(0, MAX_MANUAL_TITLES)))
  } catch { /* storage unavailable */ }
}

export function sessionTitleIsManual(filePath: string): boolean {
  return readManualTitles().includes(filePath)
}
