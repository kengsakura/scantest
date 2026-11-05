import { grade, type AnswerKey } from '../omr/grading'

export interface ItemStats {
  /** Share of students who got the question right, 0..1 (difficulty index p) */
  p: number
  /** Students choosing each choice (single marks only) */
  counts: number[]
  blank: number
  multiple: number
  /** Discrimination index: share correct in the top 27% minus the bottom 27% */
  d: number
}

export interface ExamStats {
  n: number
  mean: number
  sd: number
  min: number
  max: number
  /** KR-20 reliability on right/wrong items, null when it can't be computed */
  kr20: number | null
  items: ItemStats[]
}

export function analyse(answersPerPaper: number[][][], key: AnswerKey, choices: number): ExamStats {
  const graded = answersPerPaper.map((a) => ({ a, g: grade(a, key) }))
  const n = graded.length
  const scores = graded.map((x) => x.g.score)
  const mean = n ? scores.reduce((s, v) => s + v, 0) / n : 0
  const sd = n ? Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / n) : 0

  const ranked = [...graded].sort((a, b) => b.g.score - a.g.score)
  const g27 = Math.max(1, Math.round(n * 0.27))
  const upper = ranked.slice(0, g27)
  const lower = ranked.slice(-g27)

  const items: ItemStats[] = key.answers.map((_, i) => {
    const counts = Array.from({ length: choices }, () => 0)
    let blank = 0
    let multiple = 0
    let right = 0
    for (const { a, g } of graded) {
      const m = a[i] ?? []
      if (m.length === 0) blank++
      else if (m.length > 1) multiple++
      else counts[m[0]]++
      if (g.status[i] === 'correct' || g.status[i] === 'free') right++
    }
    const ok = (x: (typeof graded)[number]) => x.g.status[i] === 'correct' || x.g.status[i] === 'free'
    const d = n >= 2 ? (upper.filter(ok).length - lower.filter(ok).length) / g27 : 0
    return { p: n ? right / n : 0, counts, blank, multiple, d }
  })

  // KR-20 uses number-right totals over the non-free items
  const scored = key.answers.map((_, i) => i).filter((i) => !key.free[i])
  const k = scored.length
  const totals = graded.map((x) => scored.filter((i) => x.g.status[i] === 'correct').length)
  const tMean = n ? totals.reduce((s, v) => s + v, 0) / n : 0
  const variance = n ? totals.reduce((s, v) => s + (v - tMean) ** 2, 0) / n : 0
  const pq = scored.reduce((s, i) => s + items[i].p * (1 - items[i].p), 0)
  const kr20 = n >= 2 && k >= 2 && variance > 0 ? (k / (k - 1)) * (1 - pq / variance) : null

  return { n, mean, sd, min: n ? Math.min(...scores) : 0, max: n ? Math.max(...scores) : 0, kr20, items }
}
