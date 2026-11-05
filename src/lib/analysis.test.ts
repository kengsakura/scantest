import { describe, expect, it } from 'vitest'
import { emptyKey } from '../omr/grading'
import { analyse } from './analysis'

describe('item analysis', () => {
  const key = emptyKey(3)
  key.answers = [0, 1, 2]

  it('computes difficulty, choice counts and discrimination', () => {
    // 4 strong students get everything right; 4 weak ones only q1 right
    const strong = [[0], [1], [2]]
    const weak = [[0], [0], []]
    const s = analyse([strong, strong, strong, strong, weak, weak, weak, weak], key, 4)
    expect(s.n).toBe(8)
    expect(s.items[0].p).toBe(1)
    expect(s.items[0].d).toBe(0) // everyone right: doesn't discriminate
    expect(s.items[1].p).toBe(0.5)
    expect(s.items[1].counts).toEqual([4, 4, 0, 0])
    expect(s.items[1].d).toBe(1) // top group all right, bottom all wrong
    expect(s.items[2].blank).toBe(4)
    expect(s.mean).toBe(2)
    expect(s.kr20).not.toBeNull()
  })

  it('counts multiple marks separately and handles no papers', () => {
    expect(analyse([[[0, 1], [1], [2]]], key, 4).items[0].multiple).toBe(1)
    const empty = analyse([], key, 4)
    expect(empty.n).toBe(0)
    expect(empty.kr20).toBeNull()
  })
})
