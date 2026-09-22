import { createDecipheriv, createECDH, randomUUID, type ECDH } from 'node:crypto'
import { hostname, userInfo } from 'node:os'
import { isRecord, requireString } from './validation'

const SUPABASE_DASHBOARD_URL = 'https://supabase.com/dashboard'
const SUPABASE_API_URL = 'https://api.supabase.com'
const SUPABASE_USER_AGENT = 'GooeyPi'
const LOGIN_REQUEST_TIMEOUT_MS = 10_000
const SESSION_TTL_MS = 10 * 60_000
const MAX_PENDING_SESSIONS = 8
const MAX_CODE_ATTEMPTS = 5
const MAX_TOKEN_NAME_LENGTH = 128
const MAX_CODE_LENGTH = 64

export interface SupabaseLoginStart {
  sessionId: string
  url: string
}

export interface SupabaseProjectRef {
  ref: string
  name: string
}

interface PendingLogin {
  ecdh: ECDH
  createdAt: number
  attempts: number
}

function defaultTokenName(): string {
  const timestamp = Math.floor(Date.now() / 1_000)
  try {
    const user = userInfo().username
    const host = hostname()
    if (user && host) return `gooeypi_${user}@${host}_${timestamp}`
  } catch { /* fall through to the fallback name */ }
  return `gooeypi_${timestamp}`
}

/**
 * Supabase's browser authorization flow, the same one `supabase login` runs:
 * the app generates a P-256 ECDH keypair, the dashboard encrypts a freshly
 * minted access token to that public key, and the app polls the platform API
 * with the session id plus the verification code shown to the user. The token
 * is AES-256-GCM encrypted end to end; api.supabase.com never sees plaintext.
 */
export class SupabaseAuthService {
  private readonly pending = new Map<string, PendingLogin>()
  private readonly openExternal: (url: string) => Promise<void>

  constructor(options: { openExternal?: (url: string) => Promise<void> } = {}) {
    this.openExternal = options.openExternal ?? (async () => undefined)
  }

  async startLogin(tokenNameValue?: unknown): Promise<SupabaseLoginStart> {
    const tokenName = tokenNameValue === undefined
      ? defaultTokenName()
      : requireString(tokenNameValue, 'token name', { min: 1, max: MAX_TOKEN_NAME_LENGTH, trim: true })
    if (/[\0\r\n\u2028\u2029]/.test(tokenName)) throw new TypeError('token name is invalid')

    this.sweepExpired()
    if (this.pending.size >= MAX_PENDING_SESSIONS) throw new TypeError('Too many Supabase sign-ins are already in progress; finish or wait for one to expire')

    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const sessionId = randomUUID()
    const url = `${SUPABASE_DASHBOARD_URL}/cli/login?session_id=${sessionId}&token_name=${encodeURIComponent(tokenName)}&public_key=${ecdh.getPublicKey('hex', 'uncompressed')}`

    this.pending.set(sessionId, { ecdh, createdAt: Date.now(), attempts: 0 })
    try {
      await this.openExternal(url)
    } catch (error) {
      this.pending.delete(sessionId)
      throw error
    }
    return { sessionId, url }
  }

  async completeLogin(sessionIdValue: unknown, codeValue: unknown): Promise<{ token: string }> {
    const sessionId = requireString(sessionIdValue, 'session id', { min: 1, max: 64, trim: true })
    const code = requireString(codeValue, 'verification code', { min: 1, max: MAX_CODE_LENGTH, trim: true })
    const pending = this.pending.get(sessionId)
    if (!pending) throw new TypeError('This Supabase sign-in expired or was never started; start a new connection')
    if (Date.now() - pending.createdAt > SESSION_TTL_MS) {
      this.pending.delete(sessionId)
      throw new TypeError('This Supabase sign-in expired; start a new connection')
    }
    pending.attempts += 1
    if (pending.attempts > MAX_CODE_ATTEMPTS) {
      this.pending.delete(sessionId)
      throw new TypeError('Too many verification attempts; start a new connection')
    }

    const response = await fetch(`${SUPABASE_API_URL}/platform/cli/login/${sessionId}?device_code=${encodeURIComponent(code)}`, {
      headers: { 'User-Agent': SUPABASE_USER_AGENT },
      signal: AbortSignal.timeout(LOGIN_REQUEST_TIMEOUT_MS),
    })
    if (response.status !== 200) {
      const body = await response.text().catch(() => '')
      throw new TypeError(`Supabase verification failed (status ${response.status})${body ? `: ${body.slice(0, 300)}` : ''}`)
    }
    const body: unknown = await response.json()
    if (!isRecord(body)
      || typeof body.access_token !== 'string'
      || typeof body.public_key !== 'string'
      || typeof body.nonce !== 'string') {
      throw new TypeError('Supabase returned an unexpected login response')
    }

    const sharedSecret = pending.ecdh.computeSecret(Buffer.from(body.public_key, 'hex'))
    // Go's aesgcm.Open expects the 16-byte GCM tag appended to the ciphertext;
    // Node wants it supplied separately via setAuthTag.
    const ciphertextHex = body.access_token.slice(0, -32)
    const authTagHex = body.access_token.slice(-32)
    const decipher = createDecipheriv('aes-256-gcm', sharedSecret, Buffer.from(body.nonce, 'hex'))
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
    const token = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf-8')

    this.pending.delete(sessionId)
    return { token }
  }

  /** Lists the projects a token can see so the renderer can offer a picker. */
  async listProjects(tokenValue: unknown): Promise<SupabaseProjectRef[]> {
    const token = requireString(tokenValue, 'access token', { min: 1, max: 4_096, trim: true })
    const response = await fetch(`${SUPABASE_API_URL}/v1/projects`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': SUPABASE_USER_AGENT },
      signal: AbortSignal.timeout(LOGIN_REQUEST_TIMEOUT_MS),
    })
    if (response.status !== 200) {
      const body = await response.text().catch(() => '')
      throw new TypeError(`Supabase project listing failed (status ${response.status})${body ? `: ${body.slice(0, 300)}` : ''}`)
    }
    const body: unknown = await response.json()
    if (!Array.isArray(body)) throw new TypeError('Supabase returned an unexpected projects response')
    return body.slice(0, 200).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') return []
      return [{ ref: entry.id.slice(0, 64), name: entry.name.slice(0, 120) }]
    })
  }

  private sweepExpired(): void {
    const now = Date.now()
    for (const [sessionId, pending] of this.pending) {
      if (now - pending.createdAt > SESSION_TTL_MS) this.pending.delete(sessionId)
    }
  }
}
