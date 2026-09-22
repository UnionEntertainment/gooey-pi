import type { GitCommitDetail, GitCommitInfo, GitCommitRef, GitHistoryBranch } from '../../src/types/api'

/**
 * Pure parsers for `git log`/`git show`/`for-each-ref` output produced by
 * GitService.history and GitService.commitDetail. Kept spawn-free so the
 * record formats can be unit-tested without a repository.
 *
 * Log records are NUL-delimited (`-z` + `%x00` fields):
 *   sha \0 parents \0 author \0 email \0 timestamp \0 decorations \0 subject \0
 * Ref records are NUL-delimited fields:
 *   refname \0 short \0 sha \0 HEAD \0 upstream \0 track \0 symref \0
 * Commit detail records are NUL-delimited fields:
 *   sha \0 parents \0 author \0 email \0 timestamp \0 body \0 <numstat -z>
 */

export function nextNulField(output: string, cursor: number): { value: string; cursor: number } {
  const end = output.indexOf('\0', cursor)
  if (end < 0) return { value: output.slice(cursor), cursor: output.length }
  return { value: output.slice(cursor, end), cursor: end + 1 }
}

function parseDecorations(value: string): { refs: GitCommitRef[]; head: boolean } {
  const refs: GitCommitRef[] = []
  let head = false
  // %D renders "HEAD -> main, origin/main, tag: v1" with no wrapping parens.
  const trimmed = value.trim().replace(/^\(|\)$/g, '')
  if (!trimmed) return { refs, head }
  for (const entry of trimmed.split(',')) {
    const name = entry.trim()
    if (!name) continue
    if (name === 'HEAD') { head = true; continue }
    if (name.startsWith('HEAD -> ')) {
      head = true
      refs.push({ name: name.slice('HEAD -> '.length), kind: 'local', head: true })
      continue
    }
    if (name.startsWith('tag: ')) { refs.push({ name: name.slice('tag: '.length), kind: 'tag' }); continue }
    refs.push({ name, kind: name.includes('/') ? 'remote' : 'local' })
  }
  return { refs, head }
}

export function parseHistoryLog(output: string, maxCommits: number): { commits: GitCommitInfo[]; truncated: boolean } {
  const commits: GitCommitInfo[] = []
  let truncated = false
  let cursor = 0
  while (cursor < output.length) {
    // -z terminates each record with an extra NUL after the format's own
    // trailing %x00, so a leading empty field is a record separator: skip it
    // alone rather than consuming a whole record.
    const first = nextNulField(output, cursor)
    cursor = first.cursor
    if (!first.value.trim()) continue
    const fields = [first.value]
    for (let index = 0; index < 6; index += 1) {
      const field = nextNulField(output, cursor)
      fields.push(field.value)
      cursor = field.cursor
    }
    const [sha, parents, author, email, timestamp, decorations, subject] = fields
    if (commits.length >= maxCommits) { truncated = true; break }
    const parsed = parseDecorations(decorations ?? '')
    commits.push({
      sha: sha.trim(),
      parents: (parents ?? '').split(' ').filter(Boolean),
      author: author ?? '',
      email: email ?? '',
      timestamp: Number.parseInt(timestamp ?? '', 10) || 0,
      subject: (subject ?? '').replace(/^\n+/, ''),
      refs: parsed.refs,
      head: parsed.head,
    })
  }
  return { commits, truncated }
}

function parseTrack(value: string): { ahead?: number; behind?: number } {
  const ahead = value.match(/ahead (\d+)/)
  const behind = value.match(/behind (\d+)/)
  return {
    ahead: ahead ? Number(ahead[1]) : undefined,
    behind: behind ? Number(behind[1]) : undefined,
  }
}

export function parseRefList(output: string, maxRefs: number): GitHistoryBranch[] {
  const branches: GitHistoryBranch[] = []
  const fields = output.split('\0')
  for (let index = 0; index + 6 < fields.length; index += 7) {
    const refname = fields[index].replace(/^\n+/, '')
    const name = fields[index + 1].replace(/^\n+|\n+$/g, '')
    const sha = fields[index + 2]
    const head = fields[index + 3].trim() === '*'
    const upstream = fields[index + 4]
    const track = fields[index + 5]
    const symref = fields[index + 6]
    if (!name || symref) continue // skip symbolic refs such as origin/HEAD
    const remote = refname.startsWith('refs/remotes/')
    if (!remote && !refname.startsWith('refs/heads/')) continue
    if (name.length > 255 || /[\0\r\n]/.test(name)) throw new Error('Git branch list returned an invalid ref')
    branches.push({ name, sha, remote, current: head, upstream: upstream || undefined, ...parseTrack(track) })
    if (branches.length > maxRefs) throw new Error('Git branch list exceeded the safety limit')
  }
  return branches
}

export function parseCommitDetail(output: string, maxFiles: number): GitCommitDetail {
  let cursor = 0
  const fields: string[] = []
  for (let index = 0; index < 6; index += 1) {
    const field = nextNulField(output, cursor)
    fields.push(field.value)
    cursor = field.cursor
  }
  const [sha, parents, author, email, timestamp, body] = fields
  const files: GitCommitDetail['files'] = []
  let truncated = false
  // The remainder starts with the newline git emits after the format, then
  // numstat records of `add\tdelete\tpath\0` (renames: `add\tdelete\t\0old\0new\0`).
  while (cursor < output.length) {
    const header = nextNulField(output, cursor)
    cursor = header.cursor
    const record = header.value.replace(/^\n+/, '')
    if (!record) continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    const additions = Number.parseInt(record.slice(0, firstTab), 10)
    const deletions = Number.parseInt(record.slice(firstTab + 1, secondTab), 10)
    let path = record.slice(secondTab + 1)
    if (!path) {
      const oldPath = nextNulField(output, cursor)
      const newPath = nextNulField(output, oldPath.cursor)
      cursor = newPath.cursor
      path = newPath.value || oldPath.value
    }
    if (!path) continue
    if (files.length >= maxFiles) { truncated = true; break }
    files.push({ path, additions: Number.isFinite(additions) ? additions : 0, deletions: Number.isFinite(deletions) ? deletions : 0 })
  }
  return {
    sha: (sha ?? '').trim(),
    parents: (parents ?? '').split(' ').filter(Boolean),
    author: author ?? '',
    email: email ?? '',
    timestamp: Number.parseInt(timestamp ?? '', 10) || 0,
    body: (body ?? '').replace(/^\n+|\n+$/g, ''),
    files,
    truncated,
  }
}
