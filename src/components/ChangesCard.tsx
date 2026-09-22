import { FileCode2, X } from 'lucide-react'
import type { GitStatus } from '@/types/api'

interface ChangesCardProps {
  git: GitStatus
  onOpenChanges(): void
  onClose?(): void
}

export function ChangesCard({ git, onOpenChanges, onClose }: ChangesCardProps) {
  const additions = git.files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = git.files.reduce((sum, file) => sum + file.deletions, 0)
  return <div className="changes-card">
    <button type="button" className="changes-card__open" onClick={onOpenChanges}>
      <FileCode2 size={12} />
      <strong>{git.files.length} {git.files.length === 1 ? 'file' : 'files'} changed</strong>
      <span className="changes-card__diff"><span className="diff-count diff-count--add">+{additions}</span><span className="diff-count diff-count--remove">−{deletions}</span></span>
    </button>
    {onClose ? <button type="button" className="changes-card__close" aria-label="Dismiss file changes" title="Dismiss file changes" onClick={onClose}><X size={11} /></button> : null}
  </div>
}
