import type { GitCommitInfo } from '@/types/api'

export interface GitGraphNode { sha: string; row: number; lane: number }
export interface GitGraphEdge { fromRow: number; fromLane: number; toRow: number; toLane: number; parentSha: string }
export interface GitGraphLayout { nodes: GitGraphNode[]; edges: GitGraphEdge[]; lanes: number }

/**
 * Lane assignment for the commit graph, GitKraken-style: each commit occupies
 * the lane that expected it (or the first free lane), its first parent
 * continues that lane, and additional parents keep their existing lane or open
 * a new one. Edges point child → parent; parents beyond the loaded window get
 * `toRow = commits.length` so the edge runs off the bottom of the graph.
 */
export function layoutGitGraph(commits: GitCommitInfo[]): GitGraphLayout {
  const lanes: Array<string | undefined> = []
  const nodes: GitGraphNode[] = []
  const edges: GitGraphEdge[] = []
  const rows = new Map<string, number>()

  const freeLane = (): number => {
    const gap = lanes.indexOf(undefined)
    if (gap >= 0) return gap
    lanes.push(undefined)
    return lanes.length - 1
  }

  commits.forEach((commit, row) => {
    rows.set(commit.sha, row)
    let lane = lanes.indexOf(commit.sha)
    if (lane < 0) lane = freeLane()
    lanes[lane] = undefined
    nodes.push({ sha: commit.sha, row, lane })

    commit.parents.forEach((parent, index) => {
      let toLane = lanes.indexOf(parent)
      if (toLane < 0) {
        toLane = index === 0 ? lane : freeLane()
        lanes[toLane] = parent
      }
      edges.push({ fromRow: row, fromLane: lane, toRow: -1, toLane, parentSha: parent })
    })
  })

  for (const edge of edges) edge.toRow = rows.get(edge.parentSha) ?? commits.length
  return { nodes, edges, lanes: Math.max(lanes.length, 1) }
}
