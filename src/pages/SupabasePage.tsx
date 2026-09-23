import { AlertTriangle, ArrowLeft, Check, ChevronRight, ExternalLink, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CapabilityMutationInput, HarnessId, McpConnectionInput, McpStateInput, SkillRecord } from '@/types/api'
import { PRIME_MCP_MANAGEMENT_UNAVAILABLE_DETAIL } from '@/lib/mcp-policy'
import { EmptyState, Modal } from '@/components/ui'

const SUPABASE_PACKAGE = '@supabase/mcp-server-supabase'
const SUPABASE_DOCS_URL = 'https://supabase.com/docs/guides/ai-tools/mcp'

const SUGGESTED_PROMPTS = [
  'Use Supabase to set up auth and protected routes for my app.',
  'Review my Supabase schema and RLS policies for security issues.',
  'Optimize my Postgres queries and indexes using Supabase best practices.',
]

type McpScope = 'user' | 'project'

function SupabaseMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 109 113" aria-hidden="true">
      <path
        fill="#3ecf8e"
        d="M63.71 110.61c-2.39 3.01-7.29 1.35-7.41-2.6l-1.38-44.39h30.45c5.8 0 9.03-6.66 5.41-11.17L45.36 2.43c-2.39-3.01-7.29-1.35-7.41 2.6l1.38 44.39H8.88c-5.8 0-9.03 6.66-5.41 11.17l60.24 50.02z"
      />
    </svg>
  )
}

function connectionName(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^[-_.:]+|[-_.:]+$/g, '')
  const base = slug.startsWith('supabase') ? slug : `supabase-${slug}`
  return base.slice(0, 64)
}

interface SupabasePageProps {
  harness: HarnessId
  skills: SkillRecord[]
  activeProjectPath?: string
  piMcpAdapterInstalled: boolean
  onBack(): void
  onRefresh(): Promise<void>
  onOpenExternal(url: string): void
  onConnectMcp(input: McpConnectionInput): Promise<{ ok: boolean; output: string }>
  onSetMcpEnabled(input: McpStateInput): Promise<{ ok: boolean; output: string }>
  onMutateCapability(input: CapabilityMutationInput): Promise<{ ok: boolean; output: string }>
  onSuggestion(prompt: string): void
  onSupabaseLoginStart(tokenName?: string): Promise<{ sessionId: string; url: string }>
  onSupabaseLoginComplete(sessionId: string, code: string): Promise<{ token: string }>
  onSupabaseListProjects(token: string): Promise<{ ref: string; name: string }[]>
}

export function SupabasePage({ harness, skills, activeProjectPath, piMcpAdapterInstalled, onBack, onRefresh, onOpenExternal, onConnectMcp, onSetMcpEnabled, onMutateCapability, onSuggestion, onSupabaseLoginStart, onSupabaseLoginComplete, onSupabaseListProjects }: SupabasePageProps) {
  const [connectOpen, setConnectOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [readOnly, setReadOnly] = useState(true)
  const [scope, setScope] = useState<McpScope>('user')
  const [connecting, setConnecting] = useState(false)
  const [result, setResult] = useState('')
  const [alert, setAlert] = useState('')
  const [updating, setUpdating] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<SkillRecord | null>(null)
  const [authStep, setAuthStep] = useState<'form' | 'verify' | 'project'>('form')
  const [authSession, setAuthSession] = useState<{ sessionId: string; url: string } | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [authError, setAuthError] = useState('')
  const [usePat, setUsePat] = useState(false)
  const [token, setToken] = useState('')
  const [authorizedToken, setAuthorizedToken] = useState('')
  const [projects, setProjects] = useState<{ ref: string; name: string }[] | null>(null)
  const [projectRef, setProjectRef] = useState('')
  const [manualRef, setManualRef] = useState('')

  const connections = useMemo(() => skills.filter((skill) => skill.kind === 'mcp' && /^supabase([_.:-]|$)/i.test(skill.name)), [skills])
  const canConnect = harness === 'omp' || harness === 'pi' && piMcpAdapterInstalled
  const connectBlockDetail = harness === 'prime'
    ? PRIME_MCP_MANAGEMENT_UNAVAILABLE_DETAIL
    : harness === 'pi' && !piMcpAdapterInstalled
      ? 'Enable Pi MCP Adapter on the Capabilities page before connecting Supabase.'
      : ''

  const name = connectionName(label)
  const canSubmit = Boolean(canConnect && label.trim() && name.length > 'supabase-'.length && (scope !== 'project' || activeProjectPath) && (usePat ? token.trim() : true))

  const resetAuth = () => {
    setAuthStep('form')
    setAuthSession(null)
    setAuthCode('')
    setAuthError('')
    setAuthorizedToken('')
    setProjects(null)
    setProjectRef('')
    setManualRef('')
  }

  const loadProjects = async (accessToken: string) => {
    setAuthorizedToken(accessToken)
    setAuthError('')
    try {
      setProjects(await onSupabaseListProjects(accessToken))
    } catch {
      setProjects(null)
    }
    setAuthStep('project')
  }

  const saveConnection = async (accessToken: string, ref: string): Promise<boolean> => {
    const args = ['-y', SUPABASE_PACKAGE]
    if (ref) args.push('--project-ref', ref)
    if (readOnly) args.push('--read-only')
    const response = await onConnectMcp({
      name,
      scope,
      projectPath: scope === 'project' ? activeProjectPath : undefined,
      type: 'stdio',
      command: 'npx',
      args,
      env: { SUPABASE_ACCESS_TOKEN: accessToken },
    })
    setResult(response.output)
    if (response.ok) {
      setLabel('')
      setToken('')
      resetAuth()
      await onRefresh()
    }
    return response.ok
  }

  const connect = async () => {
    if (!canSubmit) return
    setConnecting(true)
    setResult('')
    setAuthError('')
    try {
      if (usePat) {
        await loadProjects(token.trim())
      } else {
        const session = await onSupabaseLoginStart(label.trim())
        setAuthSession(session)
        setAuthStep('verify')
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Supabase sign-in could not be started.')
    } finally {
      setConnecting(false)
    }
  }

  const verify = async () => {
    if (!authSession || !authCode.trim() || connecting) return
    setConnecting(true)
    setAuthError('')
    try {
      const { token: accessToken } = await onSupabaseLoginComplete(authSession.sessionId, authCode.trim())
      await loadProjects(accessToken)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Verification failed.')
    } finally {
      setConnecting(false)
    }
  }

  const finishConnect = async () => {
    if (!authorizedToken || connecting) return
    setConnecting(true)
    setAuthError('')
    try {
      await saveConnection(authorizedToken, projects === null ? manualRef.trim() : projectRef)
    } finally {
      setConnecting(false)
    }
  }

  const setEnabled = async (skill: SkillRecord, enabled: boolean) => {
    if (updating) return
    setUpdating(skill.id)
    setAlert('')
    try {
      const response = await onSetMcpEnabled({
        name: skill.name,
        scope: skill.location === 'project' ? 'project' : 'user',
        projectPath: skill.location === 'project' ? activeProjectPath : undefined,
        enabled,
      })
      if (!response.ok) setAlert(response.output)
    } finally {
      setUpdating('')
    }
  }

  const remove = async (skill: SkillRecord) => {
    setConfirmRemove(null)
    if (updating) return
    setUpdating(skill.id)
    setAlert('')
    try {
      const response = await onMutateCapability({
        kind: 'mcp',
        action: 'remove',
        name: skill.name,
        ...(skill.definitionKey !== undefined ? { definitionKey: skill.definitionKey } : {}),
        scope: skill.location === 'project' ? 'project' : 'user',
        projectPath: skill.location === 'project' ? activeProjectPath : undefined,
      })
      if (!response.ok) setAlert(response.output)
      else await onRefresh()
    } finally {
      setUpdating('')
    }
  }

  return (
    <div className="page plugin-page scroll-area">
      <div className="page-container plugin-container">
        <header className="plugin-header">
          <div>
            <button type="button" className="button supabase-back" onClick={onBack}><ArrowLeft size={13}/> Capabilities</button>
            <div className="supabase-identity">
              <SupabaseMark/>
              <div>
                <h1>Supabase</h1>
                <p>Manage and query databases</p>
              </div>
            </div>
          </div>
          <div>
            <button type="button" className="button" onClick={() => onOpenExternal(SUPABASE_DOCS_URL)}><ExternalLink size={13}/> Docs</button>
            <button type="button" className="button button--primary" disabled={!canConnect} title={connectBlockDetail || undefined} onClick={() => { setResult(''); setConnectOpen(true) }}><Plus size={14}/> Connect account</button>
          </div>
        </header>

        <p className="supabase-description">Connect one or more Supabase accounts as local MCP servers. Each connection uses its own personal access token, so separate accounts stay isolated. New sessions can then manage tables, run queries, review RLS policies, and inspect logs for the connected projects.</p>

        <div className="supabase-prompts">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" onClick={() => onSuggestion(prompt)}>
              <SupabaseMark size={15}/>
              <span>{prompt}</span>
              <ChevronRight size={14}/>
            </button>
          ))}
        </div>

        {connectBlockDetail ? <p className="connection-warning"><ShieldCheck size={13}/> {connectBlockDetail}</p> : null}
        {alert ? <p className="page-inline-error" role="alert"><AlertTriangle size={13}/> {alert}</p> : null}

        <div className="directory-heading"><h2>Connections</h2><span>{connections.length} connected</span></div>
        {connections.length ? (
          <div className="directory-list">{connections.map((skill) => {
            const external = skill.availability?.available === false
            return (
              <article key={skill.id}>
                <span className="directory-icon directory-icon--mcp"><SupabaseMark size={16}/></span>
                <div>
                  <div><h3>{skill.name}</h3><span>{skill.location}</span></div>
                  <p>{external ? skill.availability?.detail : skill.description}</p>
                </div>
                <div className="capability-actions">
                  {skill.location !== 'bundled' && skill.location !== 'system' && skill.definitionRemovalAvailable !== false
                    ? <button type="button" className="plugin-remove" aria-label={`Remove ${skill.name}`} disabled={Boolean(updating)} onClick={() => setConfirmRemove(skill)}><Trash2 size={13}/></button>
                    : null}
                  {external
                    ? <span className="plugin-toggle" role="img" aria-label={`Externally managed ${skill.name}`}><ShieldCheck aria-hidden="true" size={14}/></span>
                    : <button type="button" className={skill.enabled ? 'plugin-toggle is-enabled' : 'plugin-toggle'} aria-label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`} aria-pressed={skill.enabled} disabled={Boolean(updating)} onClick={() => void setEnabled(skill, !skill.enabled)}>{updating === skill.id ? <RefreshCw className="spin" size={14}/> : skill.enabled ? <><Check className="plugin-toggle__check" size={14}/><X className="plugin-toggle__disable" size={14}/></> : <Plus className="plugin-toggle__plus" size={14}/>}</button>}
                </div>
              </article>
            )
          })}</div>
        ) : <EmptyState icon={<SupabaseMark size={23}/>} title="No Supabase accounts connected">Connect an account with a personal access token to let {harness === 'omp' ? 'OMP' : 'Pi'} manage and query your Supabase projects.</EmptyState>}

        <div className="directory-heading"><h2>Information</h2></div>
        <dl className="supabase-info">
          <div><dt>Developer</dt><dd>Supabase</dd></div>
          <div><dt>Category</dt><dd>Developer Tools</dd></div>
          <div><dt>Transport</dt><dd>Local stdio MCP (<code>{SUPABASE_PACKAGE}</code>)</dd></div>
          <div><dt>Website</dt><dd><button type="button" className="supabase-link" onClick={() => onOpenExternal('https://supabase.com')}>supabase.com</button></dd></div>
          <div><dt>MCP documentation</dt><dd><button type="button" className="supabase-link" onClick={() => onOpenExternal(SUPABASE_DOCS_URL)}>supabase.com/docs</button></dd></div>
        </dl>

        {confirmRemove ? <Modal title={`Remove ${confirmRemove.name}?`} onClose={() => setConfirmRemove(null)} footer={<><button type="button" className="button" onClick={() => setConfirmRemove(null)}>Cancel</button><button type="button" className="button button--danger" onClick={() => void remove(confirmRemove)}>Yes, remove completely</button></>}><p className="modal-intro">Are you sure? This removes only the server definition; the personal access token stored in the definition is removed with it. Other MCP entries are kept.</p></Modal> : null}

        {connectOpen ? (
          <Modal
            title={authStep === 'verify' ? 'Authorize Supabase' : authStep === 'project' ? 'Choose a project' : 'Connect a Supabase account'}
            onClose={() => { setConnectOpen(false); resetAuth() }}
            canClose={() => !connecting}
            footer={authStep === 'verify'
              ? <><button type="button" className="button" disabled={connecting} onClick={resetAuth}><ArrowLeft size={13}/> Back</button><button type="submit" form="supabase-connect-form" className="button button--primary" disabled={!authCode.trim() || connecting}>{connecting ? 'Verifying…' : 'Verify and continue'}</button></>
              : authStep === 'project'
                ? <><button type="button" className="button" disabled={connecting} onClick={resetAuth}><ArrowLeft size={13}/> Back</button><button type="submit" form="supabase-connect-form" className="button button--primary" disabled={connecting}>{connecting ? 'Connecting…' : 'Connect'}</button></>
                : <><button type="button" className="button" disabled={connecting} onClick={() => { setConnectOpen(false); resetAuth() }}>Cancel</button><button type="submit" form="supabase-connect-form" className="button button--primary" disabled={!canSubmit || connecting}>{connecting ? 'Connecting…' : usePat ? 'Continue' : 'Continue in browser'}</button></>}
          >
            {authStep === 'verify' ? (
              <form id="supabase-connect-form" className="add-tool-form" onSubmit={(event) => { event.preventDefault(); void verify() }}>
                <p className="modal-intro">Approve the connection in your browser, then paste the verification code shown on the confirmation page.</p>
                {authSession ? <small className="field-help">If the browser did not open, use this link: <button type="button" className="supabase-link" onClick={() => onOpenExternal(authSession.url)}>supabase.com/dashboard/cli/login</button></small> : null}
                <label className="field"><span>Verification code</span><input data-autofocus value={authCode} onChange={(event) => setAuthCode(event.target.value)} placeholder="Paste the code from your browser"/></label>
                {authError ? <p className="page-inline-error" role="alert"><AlertTriangle size={13}/> {authError}</p> : null}
              </form>
            ) : authStep === 'project' ? (
              <form id="supabase-connect-form" className="add-tool-form" onSubmit={(event) => { event.preventDefault(); void finishConnect() }}>
                <p className="modal-intro">Authorized. Choose which project <code>{name}</code> can manage, or keep access to every project on the account.</p>
                {projects === null ? (
                  <>
                    <label className="field"><span>Project ref <small>(optional)</small></span><input data-autofocus value={manualRef} onChange={(event) => setManualRef(event.target.value)} placeholder="abcdefghijklmnopqrst"/></label>
                    <small className="field-help">The project list could not be loaded; enter a ref manually or leave empty for all projects.</small>
                  </>
                ) : (
                  <label className="field"><span>Project</span><select data-autofocus value={projectRef} onChange={(event) => setProjectRef(event.target.value)}>
                    <option value="">All projects on this account</option>
                    {projects.map((project) => <option key={project.ref} value={project.ref}>{project.name} ({project.ref})</option>)}
                  </select></label>
                )}
                <small className="field-help">Scoping to one project is recommended, especially for production.</small>
                {authError ? <p className="page-inline-error" role="alert"><AlertTriangle size={13}/> {authError}</p> : null}
              </form>
            ) : (
              <form id="supabase-connect-form" className="add-tool-form" onSubmit={(event) => { event.preventDefault(); void connect() }}>
                <p className="modal-intro">GooeyPi opens Supabase in your browser to authorize a token, then saves a local MCP server running <code>{SUPABASE_PACKAGE}</code>. The token never leaves this machine except to Supabase.</p>
                <label className="field"><span>Connection label</span><input data-autofocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Acme Corp"/></label>
                {label.trim() ? <small className="field-help">Saved as MCP server <code>{name || 'supabase-…'}</code>.</small> : null}
                {usePat ? <label className="field"><span>Personal access token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="sbp_…" autoComplete="off"/></label> : null}
                <label className="field field--inline"><input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)}/><span>Read-only database queries</span></label>
                <label className="field"><span>Available in</span><select value={scope} onChange={(event) => setScope(event.target.value as McpScope)}><option value="user">All projects (personal)</option><option value="project" disabled={!activeProjectPath}>Current project</option></select></label>
                <p className="field-help"><button type="button" className="supabase-link" onClick={() => setUsePat(!usePat)}>{usePat ? 'Use browser sign-in instead' : 'Use a personal access token instead'}</button></p>
                {authError ? <p className="page-inline-error" role="alert"><AlertTriangle size={13}/> {authError}</p> : null}
                <p className="connection-warning"><ShieldCheck size={13}/> The authorized token is stored in the harness MCP configuration file on this machine. Only connect accounts you trust.</p>
              </form>
            )}
            {result ? <pre className="install-output" role="status">{result}</pre> : null}
          </Modal>
        ) : null}
      </div>
    </div>
  )
}
