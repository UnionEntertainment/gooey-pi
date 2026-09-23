import { Cloud, File, GitBranch, GitCommitHorizontal, LoaderCircle, RefreshCw, Tag } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatRelative } from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { layoutGitGraph, type GitGraphEdge, type GitGraphLayout } from '@/lib/git-graph'
import type { GitCommitDetail, GitCommitInfo, GitCommitRef, GitHistory, GitHistoryBranch, GitStatus } from '@/types/api'
import { EmptyState, IconButton } from '../ui'

const ROW_HEIGHT = 30
const LANE_WIDTH = 16
const GRAPH_PAD_X = 12
const LANE_COLORS = ['#4f8ef7', '#0f766e', '#3fb950', '#e8a13d', '#f778ba', '#39c5cf', '#d29922', '#f85149']

const laneColor = (lane: number): string => LANE_COLORS[lane % LANE_COLORS.length]!
const laneX = (lane: number): number => GRAPH_PAD_X + lane * LANE_WIDTH
const rowY = (row: number): number => row * ROW_HEIGHT + ROW_HEIGHT / 2

/** Child → parent edge: straight down the child lane, then a curve into the parent node. */
function edgePath(edge: GitGraphEdge, commitCount: number): string {
  const x1 = laneX(edge.fromLane)
  const y1 = rowY(edge.fromRow)
  const x2 = laneX(edge.toLane)
  const y2 = Math.min(rowY(edge.toRow), commitCount * ROW_HEIGHT)
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const bendY = Math.max(y1, y2 - ROW_HEIGHT)
  return `M ${x1} ${y1} L ${x1} ${bendY} C ${x1} ${bendY + ROW_HEIGHT / 2}, ${x2} ${y2 - ROW_HEIGHT / 2}, ${x2} ${y2}`
}

const RefBadge = memo(function RefBadge({ refEntry }: { refEntry: GitCommitRef }) {
  const icon = refEntry.kind === 'tag' ? <Tag size={9} /> : refEntry.kind === 'remote' ? <Cloud size={9} /> : <GitBranch size={9} />
  return <span className={`git-ref git-ref--${refEntry.kind}${refEntry.head ? ' is-head' : ''}`}>{icon}{refEntry.name}</span>
})

const CommitRow = memo(function CommitRow({ commit, selected, onSelect }: { commit: GitCommitInfo; selected: boolean; onSelect(sha: string): void }) {
  return (
    <button type="button" data-sha={commit.sha} className={`git-commit-row${selected ? ' is-selected' : ''}`} style={{ height: ROW_HEIGHT }} onClick={() => onSelect(commit.sha)}>
      <span className="git-commit-row__refs">{commit.refs.map((ref) => <RefBadge key={`${ref.kind}:${ref.name}`} refEntry={ref} />)}</span>
      <span className="git-commit-row__subject" title={commit.subject}>{commit.subject || '(no message)'}</span>
      <span className="git-commit-row__meta">{commit.author}</span>
      <span className="git-commit-row__meta">{commit.sha.slice(0, 7)}</span>
      <span className="git-commit-row__meta">{formatRelative(commit.timestamp * 1000)}</span>
    </button>
  )
})

const CommitGraph = memo(function CommitGraph({ commits, layout }: { commits: GitCommitInfo[]; layout: GitGraphLayout }) {
  const width = GRAPH_PAD_X * 2 + layout.lanes * LANE_WIDTH
  const height = commits.length * ROW_HEIGHT
  const nodeBySha = useMemo(() => new Map(layout.nodes.map((node) => [node.sha, node])), [layout])
  return (
    <svg className="git-graph" width={width} height={height} style={{ minWidth: width }} aria-hidden="true">
      {layout.edges.map((edge, index) => <path key={index} d={edgePath(edge, commits.length)} stroke={laneColor(edge.toLane)} strokeWidth={1.6} fill="none" />)}
      {commits.map((commit) => {
        const node = nodeBySha.get(commit.sha)
        if (!node) return null
        const color = laneColor(node.lane)
        const merge = commit.parents.length > 1
        return (
          <g key={commit.sha}>
            <circle cx={laneX(node.lane)} cy={rowY(node.row)} r={merge ? 4.6 : 4} fill={color} stroke={commit.head ? 'var(--text)' : 'none'} strokeWidth={commit.head ? 1.6 : 0} />
            {merge ? <circle cx={laneX(node.lane)} cy={rowY(node.row)} r={1.7} fill="var(--canvas)" /> : null}
          </g>
        )
      })}
    </svg>
  )
})

function BranchSection({ title, branches, onSelect }: { title: string; branches: GitHistoryBranch[]; onSelect(branch: GitHistoryBranch): void }) {
  if (!branches.length) return null
  return (
    <div className="git-branches__section">
      <h4>{title}</h4>
      {branches.map((branch) => (
        <button type="button" key={branch.name} className={branch.current ? 'is-current' : ''} onClick={() => onSelect(branch)} title={branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name}>
          {branch.remote ? <Cloud size={12} /> : <GitBranch size={12} />}
          <span>{branch.name}</span>
          {branch.ahead ? <small>↑{branch.ahead}</small> : null}
          {branch.behind ? <small>↓{branch.behind}</small> : null}
          {branch.current ? <i>current</i> : null}
        </button>
      ))}
    </div>
  )
}

function CommitDetailPane({ detail, loading, error, commit, onRetry }: { detail: GitCommitDetail | undefined; loading: boolean; error: string; commit: GitCommitInfo | undefined; onRetry(): void }) {
  return (
    <div className="git-detail">
      <div className="git-detail__header">
        <GitCommitHorizontal size={14} />
        <strong>{commit?.subject || 'Commit details'}</strong>
        <code>{(commit?.sha ?? detail?.sha ?? '').slice(0, 10)}</code>
      </div>
      {commit ? <div className="git-detail__meta">
        <span>{commit.author}{commit.email ? ` <${commit.email}>` : ''}</span>
        <span>{new Date(commit.timestamp * 1000).toLocaleString()} · {formatRelative(commit.timestamp * 1000)}</span>
        {commit.parents.length ? <span>{commit.parents.length > 1 ? 'Merge of' : 'Parent'} {commit.parents.map((parent) => parent.slice(0, 7)).join(', ')}</span> : <span>Root commit</span>}
      </div> : null}
      {loading ? <div className="diff-loading"><LoaderCircle className="spin" size={14} /> Loading commit…</div> : error ? (
        <div className="git-detail__error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}><RefreshCw size={12} /> Retry</button></div>
      ) : (
        <>
          {detail?.body && detail.body !== commit?.subject ? <pre className="git-detail__body">{detail.body}</pre> : null}
          <div className="git-detail__files scroll-area">
            {detail?.files.map((file) => <div key={file.path} className="git-detail__file"><File size={12} /><span title={file.path}>{file.path}</span><small className="additions">+{file.additions}</small><small className="deletions">−{file.deletions}</small></div>)}
            {detail && !detail.files.length ? <p className="git-detail__empty">{commit && commit.parents.length > 1 ? 'Merge commit — no combined diff.' : 'No file changes recorded.'}</p> : null}
            {detail?.truncated ? <p className="git-detail__empty">File list truncated.</p> : null}
          </div>
        </>
      )}
    </div>
  )
}

export function GitPanel({ cwd, git, onRefreshGit }: { cwd?: string; git: GitStatus; onRefreshGit(): Promise<void> | void }) {
  const [history, setHistory] = useState<GitHistory>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedSha, setSelectedSha] = useState<string>()
  const [detail, setDetail] = useState<GitCommitDetail>()
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailRetry, setDetailRetry] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // `git` is a fresh object whenever App refreshes status (terminal events,
  // session transitions, manual refresh), so history refetches alongside it.
  useEffect(() => {
    if (!cwd || !git.isRepo || git.error || !window.prime) { setHistory(undefined); setError(''); return }
    let cancelled = false
    setLoading(true)
    window.prime.git.history(cwd)
      .then((value) => { if (!cancelled) { setHistory(value); setError('') } })
      .catch((cause) => { if (!cancelled) setError(errorMessage(cause)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cwd, git])

  const selectedCommit = history?.commits.find((commit) => commit.sha === selectedSha)
  useEffect(() => {
    if (!cwd || !selectedSha || !window.prime) { setDetail(undefined); setDetailError(''); return }
    let cancelled = false
    setDetailLoading(true)
    setDetailError('')
    window.prime.git.commitDetail(cwd, selectedSha)
      .then((value) => { if (!cancelled) setDetail(value) })
      .catch((cause) => { if (!cancelled) { setDetail(undefined); setDetailError(errorMessage(cause)) } })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [cwd, selectedSha, detailRetry])

  // A branch head can sit outside the loaded commit window; synthesize a
  // header row from the fetched detail so the pane still renders.
  const detailCommit = selectedCommit ?? (detail ? { sha: detail.sha, parents: detail.parents, author: detail.author, email: detail.email, timestamp: detail.timestamp, subject: detail.body.split('\n')[0] ?? '', refs: [] } : undefined)

  const selectBranch = useCallback((branch: GitHistoryBranch) => {
    setSelectedSha(branch.sha)
    scrollRef.current?.querySelector(`[data-sha="${branch.sha}"]`)?.scrollIntoView({ block: 'center' })
  }, [])

  const layout = useMemo(() => history ? layoutGitGraph(history.commits) : undefined, [history])

  if (!git.isRepo) return <EmptyState icon={<GitBranch size={24} />} title="No Git repository">Open a project backed by Git to browse its commits and branches.</EmptyState>
  if (git.error || error) {
    return <EmptyState
      icon={<GitBranch size={24} />}
      title="Git history unavailable"
      action={<button type="button" className="button" onClick={() => void onRefreshGit()}><RefreshCw size={13} /> Try again</button>}
    >{git.error || error}</EmptyState>
  }

  const local = history?.branches.filter((branch) => !branch.remote) ?? []
  const remote = history?.branches.filter((branch) => branch.remote) ?? []
  const graphWidth = layout ? GRAPH_PAD_X * 2 + layout.lanes * LANE_WIDTH : 0

  return (
    <div className="git-panel">
      <div className="changes-toolbar">
        <div><strong><GitBranch size={13} /> {git.branch ?? 'Repository'}</strong>{git.ahead ? <small>{git.ahead} ahead</small> : null}{git.behind ? <small>{git.behind} behind</small> : null}</div>
        <IconButton label="Refresh history" onClick={() => void onRefreshGit()}><RefreshCw size={14} /></IconButton>
      </div>
      <div className="git-panel__body">
        <div className="git-branches scroll-area">
          <BranchSection title="Local" branches={local} onSelect={selectBranch} />
          <BranchSection title="Remote" branches={remote} onSelect={selectBranch} />
          {history && !history.branches.length ? <p className="git-branches__empty">No branches.</p> : null}
        </div>
        <div className="git-history scroll-area" ref={scrollRef}>
          {loading && !history ? <div className="diff-loading"><LoaderCircle className="spin" size={15} /> Loading history…</div> : null}
          {history && !history.commits.length ? <p className="git-history__empty">No commits yet. The first commit will appear here.</p> : null}
          {history?.commits.length ? (
            <div className="git-history__rows" style={{ paddingLeft: graphWidth }}>
              <div className="git-history__graph">{layout ? <CommitGraph commits={history.commits} layout={layout} /> : null}</div>
              {history.commits.map((commit) => <CommitRow key={commit.sha} commit={commit} selected={commit.sha === selectedSha} onSelect={setSelectedSha} />)}
              {history.truncated ? <p className="git-history__truncated">Showing the most recent {history.commits.length} commits.</p> : null}
            </div>
          ) : null}
        </div>
      </div>
      {selectedSha ? <CommitDetailPane detail={detail} loading={detailLoading} error={detailError} commit={detailCommit} onRetry={() => setDetailRetry((value) => value + 1)} /> : null}
    </div>
  )
}
