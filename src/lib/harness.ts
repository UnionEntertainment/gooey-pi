import type { HarnessId, OmpApprovalMode } from '@/types/api'

export const HARNESS_SELECTOR_ORDER: readonly HarnessId[] = ['pi', 'omp', 'prime']

/** Product name shown in window chrome and the brand switcher. */
export const HARNESS_PRODUCT_NAMES: Record<HarnessId, string> = { prime: 'Prime Work', omp: 'OMP Work', pi: 'Pi Work' }

/** The agent each harness runs, used in settings and error copy. */
export const HARNESS_AGENT_NAMES: Record<HarnessId, string> = { prime: 'Prime Agent', omp: 'OMP', pi: 'Pi' }

/** Short conversational name ("Prime is working"). */
export const HARNESS_SHORT_NAMES: Record<HarnessId, string> = { prime: 'Prime', omp: 'OMP', pi: 'Pi' }

/** Labels for the OMP --approval-mode override, shared by settings and the composer control. */
export const OMP_APPROVAL_MODE_LABELS: Record<OmpApprovalMode, string> = {
  'inherit': 'Inherit omp config',
  'always-ask': 'Always ask',
  'write': 'Prompt for exec only (write)',
  'yolo': 'YOLO (never prompt)',
}
