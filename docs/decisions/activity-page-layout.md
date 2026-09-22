# Activity page layout — decided from /proto/activity

- **Direction:** Table as the main view; Kanban as a persisted alternate mode (`prime-work.activity-mode`), toggled via an icon group in the tools row.
- **Table:** fixed-layout columns — Status (icon + label), Session (title + truncated preview), Project, Updated. Sortable headers, default Updated desc. Rows are `role="button"` with `aria-label="Open <title>"`; per-row clear appears on hover/focus.
- **Kanban:** four status columns (Needs attention / Running / Finished / Idle) with counts; compact cards (icon, 2-line title, 2-line preview, project + time); wide container.
- **Rejected:**
  - Grouped list (round 1): recency order broke across sections; single-item sections cost a header each.
  - Cards (round 1): ~40% fewer rows per viewport; too airy for a triage surface.
  - Inbox single-line (round 1): preview reduced to a sliver; status reduced to a dot — too much information lost.
  - Timeline (round 2): status demoted to a dot + flag; attention items don't cluster — wrong for a page whose job is surfacing what needs action.
- **Kept from baseline:** filter segmented (All / Needs attention / Running), filter input, Clear all, per-item clear, unread "New" pill, signature-based clearing.

## Reviewed state — decided from /proto/activity round 2

- **Direction:** Read — implicit reviewed state, email-style.
- Unreviewed rows: violet dot in a leading column + full-weight title. Reviewed rows: grey dot, dimmed title/preview/meta/status.
- Reviewed is keyed to the session revision (`eventRevision ?? updatedAt`) in `prime-work.activity-reviewed` — new activity on a thread makes it unreviewed again automatically.
- Opening a thread marks it reviewed; the dot toggles manually. Same treatment on kanban cards (dot before the icon chip).
- **Rejected:** Checklist (checkbox column reads as a task list, adds chrome to every row); Split (rows jumping between sections fights column sorting and spatial memory).
