import { createCipheriv, createECDH, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupabaseAuthService } from '../../electron/main/supabase-auth'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks() })

describe('SupabaseAuthService', () => {
  it('builds the dashboard authorization URL and opens it', async () => {
    const opened: string[] = []
    const service = new SupabaseAuthService({ openExternal: async (url) => { opened.push(url) } })

    const start = await service.startLogin('Acme Corp')

    expect(opened).toEqual([start.url])
    const url = new URL(start.url)
    expect(url.origin + url.pathname).toBe('https://supabase.com/dashboard/cli/login')
    expect(url.searchParams.get('session_id')).toBe(start.sessionId)
    expect(url.searchParams.get('token_name')).toBe('Acme Corp')
    expect(url.searchParams.get('public_key')).toMatch(/^[0-9a-f]{130}$/)
  })

  it('rejects completion for unknown sessions and oversized codes', async () => {
    const service = new SupabaseAuthService()
    await expect(service.completeLogin('missing', '123456')).rejects.toThrow(/expired or was never started/)
    const start = await service.startLogin()
    await expect(service.completeLogin(start.sessionId, '')).rejects.toThrow(/verification code/)
    await expect(service.completeLogin(start.sessionId, 'x'.repeat(65))).rejects.toThrow(/verification code/)
  })

  it('decrypts the access token exactly like the Supabase CLI flow', async () => {
    const service = new SupabaseAuthService({ openExternal: async () => undefined })
    const start = await service.startLogin()
    const appPublicKey = new URL(start.url).searchParams.get('public_key')!

    // Simulate the dashboard: its own ECDH pair, shared secret with the app's
    // public key, AES-256-GCM with the tag appended to the ciphertext.
    const dashboard = createECDH('prime256v1')
    dashboard.generateKeys()
    const sharedSecret = dashboard.computeSecret(Buffer.from(appPublicKey, 'hex'))
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', sharedSecret, nonce)
    const ciphertext = Buffer.concat([cipher.update('sbp_oauth_test_token', 'utf-8'), cipher.final(), cipher.getAuthTag()])

    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      expect(url).toBe(`https://api.supabase.com/platform/cli/login/${start.sessionId}?device_code=123456`)
      return new Response(JSON.stringify({
        access_token: ciphertext.toString('hex'),
        public_key: dashboard.getPublicKey('hex', 'uncompressed'),
        nonce: nonce.toString('hex'),
      }), { status: 200 })
    }) as typeof fetch

    const result = await service.completeLogin(start.sessionId, '123456')
    expect(result.token).toBe('sbp_oauth_test_token')
    await expect(service.completeLogin(start.sessionId, '123456')).rejects.toThrow(/expired or was never started/)
  })

  it('surfaces verification failures without consuming the session', async () => {
    const service = new SupabaseAuthService({ openExternal: async () => undefined })
    const start = await service.startLogin()
    globalThis.fetch = vi.fn(async () => new Response('invalid code', { status: 403 })) as typeof fetch

    await expect(service.completeLogin(start.sessionId, 'bad')).rejects.toThrow(/status 403/)
    // The session survives a bad code so the user can retry.
    await expect(service.completeLogin(start.sessionId, 'also-bad')).rejects.toThrow(/status 403/)
  })

  it('lists projects for the picker with the authorized token', async () => {
    const service = new SupabaseAuthService()
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      expect(url).toBe('https://api.supabase.com/v1/projects')
      expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sbp_test')
      return new Response(JSON.stringify([
        { id: 'abcdefghijklmnop', name: 'gustopick' },
        { id: 'qrstuvwxyzabcdef', name: 'staging' },
        { unexpected: true },
      ]), { status: 200 })
    }) as typeof fetch

    await expect(service.listProjects('sbp_test')).resolves.toEqual([
      { ref: 'abcdefghijklmnop', name: 'gustopick' },
      { ref: 'qrstuvwxyzabcdef', name: 'staging' },
    ])
  })

  it('surfaces project listing failures', async () => {
    const service = new SupabaseAuthService()
    globalThis.fetch = vi.fn(async () => new Response('unauthorized', { status: 401 })) as typeof fetch
    await expect(service.listProjects('sbp_bad')).rejects.toThrow(/status 401/)
  })
})
