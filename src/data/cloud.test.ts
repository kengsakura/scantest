import { describe, expect, it } from 'vitest'
import { selectAll } from './cloud'

describe('selectAll', () => {
  const fake = (total: number, calls: [number, number][]) => () => ({
    range: async (from: number, to: number) => {
      calls.push([from, to])
      const data = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i)
      return { data, error: null }
    },
  })

  it('reads past the 1000-row cap page by page', async () => {
    const calls: [number, number][] = []
    const rows = await selectAll<number>(fake(2345, calls))
    expect(rows.length).toBe(2345)
    expect(rows[2344]).toBe(2344)
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('stops after one request for small tables, including exactly 1000 rows', async () => {
    const small: [number, number][] = []
    expect((await selectAll<number>(fake(12, small))).length).toBe(12)
    expect(small.length).toBe(1)
    const exact: [number, number][] = []
    expect((await selectAll<number>(fake(1000, exact))).length).toBe(1000)
    expect(exact.length).toBe(2) // second request returns 0 rows
  })

  it('throws on a server error', async () => {
    await expect(selectAll(() => ({ range: async () => ({ data: null, error: { message: 'boom', code: '42501' } }) }))).rejects.toThrow('boom')
  })
})
