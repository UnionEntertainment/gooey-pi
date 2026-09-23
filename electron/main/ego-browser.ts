import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

export const EGO_BROWSER_INSTALL_URL = 'https://lite.ego.app/'

export interface EgoBrowserStatus {
  available: boolean
  detail: string
  installUrl: string
}

/**
 * Existence probe for the ego lite CLI. The agent invokes `ego-browser` from
 * its own shell, so GooeyPi only needs to know whether the command resolves;
 * `~/.local/bin` is where onboarding registers it and is checked explicitly
 * because GUI-spawned environments often lack it on PATH.
 */
export async function probeEgoBrowser(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): Promise<EgoBrowserStatus> {
  const executable = platform === 'win32' ? 'ego-browser.exe' : 'ego-browser'
  const candidates: string[] = []
  if (env.EGO_BROWSER_PATH && isAbsolute(env.EGO_BROWSER_PATH)) candidates.push(env.EGO_BROWSER_PATH)
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir) candidates.push(join(dir, executable))
  }
  candidates.push(join(home, '.local', 'bin', executable))
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK)
      return { available: true, detail: `ego-browser found at ${candidate}`, installUrl: EGO_BROWSER_INSTALL_URL }
    } catch { /* try the next candidate */ }
  }
  return { available: false, detail: 'ego lite is not installed or the ego-browser command is not on PATH', installUrl: EGO_BROWSER_INSTALL_URL }
}
