import { describe, expect, it } from 'vitest'
import { layoutGitGraph } from '../../src/lib/git-graph'
import type { GitCommitInfo } from '../../src/types/api'

const commit = (sha: string, parents: string[] = []): GitCommitInfo => ({
  sha,
  parents,
  author: 'Test',
  email: 'test@example.com',
  timestamp: 0,
  subject: sha,
  refs: [],
})

describe('layoutGitGraph', () => {
  it('keeps a linear history in a single lane', () => {
    const layout = layoutGitGraph([commit('c', ['b']), commit('b', ['a']), commit('a')])
    expect(layout.lanes).toBe(1)
    expect(layout.nodes.map((node) => node.lane)).toEqual([0, 0, 0])
    expect(layout.edges).toEqual([
      { fromRow: 0, fromLane: 0, toRow: 1, toLane: 0, parentSha: 'b' },
      { fromRow: 1, fromLane: 0, toRow: 2, toLane: 0, parentSha: 'a' },
    ])
  })

  it('opens a second lane for a merge side parent and rejoins at the merge base', () => {
    // m merges s into the main line; both share base b.
    const layout = layoutGitGraph([commit('m', ['t', 's']), commit('s', ['b']), commit('t', ['b']), commit('b')])
    const merge = layout.nodes.find((node) => node.sha === 'm')!
    const side = layout.nodes.find((node) => node.sha === 's')!
    expect(merge.lane).toBe(0)
    expect(side.lane).toBe(1)
    const sideEdge = layout.edges.find((edge) => edge.fromRow === 0 && edge.parentSha === 's')!
    expect(sideEdge.toLane).toBe(1)
    expect(sideEdge.toRow).toBe(1)
    // The side branch keeps its lane through the shared base.
    const base = layout.nodes.find((node) => node.sha === 'b')!
    expect(base.lane).toBe(1)
    expect(layout.edges.filter((edge) => edge.parentSha === 'b').every((edge) => edge.toRow === 3)).toBe(true)
  })

  it('points edges past the loaded window at the bottom row', () => {
    const layout = layoutGitGraph([commit('c', ['missing'])])
    expect(layout.edges[0]).toMatchObject({ toRow: 1 })
  })
})
