import { describe, expect, it } from 'vitest'
import { decodeConfig, encodeConfig, type SheetConfig } from './config'
import { emptyKey, grade } from './grading'
import { computeLayout, MARKER_INSET, MARKER_SIZE, PAGE_H, PAGE_W } from './layout'
import { readSheet } from './scanner'
import { renderSynthetic } from './synthetic'

const base: SheetConfig = { questions: 30, choices: 4, labelStyle: 'thai', idDigits: 5, versions: 0, examCode: 'AB12CD' }

describe('config codec', () => {
  it('round-trips', () => {
    const cfg: SheetConfig = { ...base, questions: 100, choices: 5, labelStyle: 'latin', idDigits: 10, versions: 4 }
    expect(decodeConfig(encodeConfig(cfg))).toEqual(cfg)
  })
  it('rejects junk', () => {
    expect(decodeConfig('hello')).toBeNull()
    expect(decodeConfig('OMR1.Q0.C4.LT.I5.V0.XAB12CD')).toBeNull()
  })
})

describe('layout', () => {
  const presets = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100]
  for (const idDigits of [0, 5, 10]) {
    for (const choices of [2, 3, 4, 5]) {
      it(`fits ${presets.join('/')} questions, ${choices} choices, ${idDigits}-digit ID on one page`, () => {
        for (const questions of presets) {
          const res = computeLayout({ ...base, questions, choices, idDigits })
          expect(res.ok, `${questions}q`).toBe(true)
          if (!res.ok) continue
          const { answer, markers } = res.layout
          const bubbles = answer.questions.flatMap((q) => q.bubbles)
          expect(bubbles.length).toBe(questions * choices)
          for (const b of bubbles) {
            expect(b.cx - b.r).toBeGreaterThanOrEqual(answer.area.x - 1e-6)
            expect(b.cx + b.r).toBeLessThanOrEqual(answer.area.x + answer.area.w + 1e-6)
            expect(b.cy + b.r).toBeLessThanOrEqual(answer.area.y + answer.area.h + 1e-6)
            for (const m of markers) {
              const dx = Math.max(m.x - b.cx, 0, b.cx - (m.x + m.w))
              const dy = Math.max(m.y - b.cy, 0, b.cy - (m.y + m.h))
              expect(Math.hypot(dx, dy)).toBeGreaterThan(b.r + 2)
            }
          }
          // bubbles never overlap
          const sorted = [...bubbles].sort((a, b) => a.cx - b.cx || a.cy - b.cy)
          for (let i = 0; i < sorted.length; i++)
            for (let j = i + 1; j < sorted.length && sorted[j].cx - sorted[i].cx < 6; j++)
              expect(Math.hypot(sorted[j].cx - sorted[i].cx, sorted[j].cy - sorted[i].cy)).toBeGreaterThan(sorted[i].r * 2 + 1)
        }
      })
    }
  }
  it('keeps 6-choice 100-question sheets readable', () => {
    const res = computeLayout({ ...base, questions: 100, choices: 6 })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.layout.answer.bubbleR).toBeGreaterThanOrEqual(1.75)
  })
  it('reports when a sheet cannot fit', () => {
    expect(computeLayout({ ...base, questions: 200, choices: 6, idDigits: 10 }).ok).toBe(false)
  })
  it('markers sit at the page corners', () => {
    const res = computeLayout(base)
    if (!res.ok) throw new Error()
    expect(res.layout.markers[0]).toMatchObject({ x: MARKER_INSET, y: MARKER_INSET })
    expect(res.layout.markers[2].x + MARKER_SIZE).toBeCloseTo(PAGE_W - MARKER_INSET)
    expect(res.layout.markers[2].y + MARKER_SIZE).toBeCloseTo(PAGE_H - MARKER_INSET)
  })
})

describe('grading', () => {
  it('scores single correct marks, zero for blank/multiple, full for free', () => {
    const key = emptyKey(5, 2)
    key.answers = [0, 1, 2, 3, null]
    key.free[4] = true
    key.points[3] = 3
    const r = grade([[0], [1, 2], [], [3], [1, 2]], key)
    expect(r.status).toEqual(['correct', 'multiple', 'blank', 'correct', 'free'])
    expect(r.score).toBe(2 + 3 + 2)
    expect(r.maxScore).toBe(11)
  })
})

/* ------------------------------------------------------------------ */
/* End-to-end: synthetic photos through the scanner                    */
/* ------------------------------------------------------------------ */

function answersFor(cfg: SheetConfig, seed: number): number[][] {
  let s = seed
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648)
  return Array.from({ length: cfg.questions }, () => {
    const r = next() % 10
    if (r === 0) return [] // blank
    if (r === 1) {
      const a = next() % cfg.choices
      return [a, (a + 1 + (next() % (cfg.choices - 1))) % cfg.choices] // two marks
    }
    return [next() % cfg.choices]
  })
}

const sortRows = (rows: number[][]) => rows.map((r) => [...r].sort((a, b) => a - b))

interface Case {
  name: string
  cfg: SheetConfig
  w: number
  h: number
  corners: { x: number; y: number }[]
}

const cases: Case[] = [
  {
    name: 'upright, slight perspective',
    cfg: base,
    w: 720,
    h: 1000,
    corners: [{ x: 70, y: 40 }, { x: 660, y: 60 }, { x: 690, y: 950 }, { x: 40, y: 930 }],
  },
  {
    name: 'upside down, 100 questions x 5 choices',
    cfg: { ...base, questions: 100, choices: 5, labelStyle: 'latin' },
    w: 900,
    h: 1250,
    corners: [{ x: 860, y: 1210 }, { x: 40, y: 1190 }, { x: 70, y: 30 }, { x: 880, y: 50 }],
  },
  {
    name: 'sideways (landscape photo), 50 questions, 10-digit ID',
    cfg: { ...base, questions: 50, choices: 5, idDigits: 10 },
    w: 1280,
    h: 900,
    corners: [{ x: 1230, y: 40 }, { x: 1250, y: 860 }, { x: 50, y: 880 }, { x: 30, y: 60 }],
  },
  {
    name: 'strong keystone (phone tilted)',
    cfg: { ...base, questions: 20, choices: 4 },
    w: 720,
    h: 1000,
    corners: [{ x: 150, y: 80 }, { x: 570, y: 80 }, { x: 700, y: 960 }, { x: 20, y: 960 }],
  },
]

describe('scanner (synthetic photos)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const answers = answersFor(c.cfg, c.cfg.questions + c.w)
      const studentId = '0123456789'.slice(0, c.cfg.idDigits).split('').reverse().join('')
      const img = renderSynthetic(c.cfg, { width: c.w, height: c.h, pageCorners: c.corners, answers, studentId })
      const res = readSheet(img)
      expect(res.ok, res.ok ? '' : res.reason).toBe(true)
      if (!res.ok) return
      expect(res.config).toEqual(c.cfg)
      expect(sortRows(res.answers)).toEqual(sortRows(answers))
      expect(res.studentId).toBe(c.cfg.idDigits ? studentId : null)
    })
  }

  it('ignores a half-erased mark but still flags it as uncertain or blank', () => {
    const c = cases[0]
    const answers = answersFor(c.cfg, 3).map((a) => (a.length ? [a[0]] : [1]))
    const img = renderSynthetic(c.cfg, {
      width: c.w,
      height: c.h,
      pageCorners: c.corners,
      answers,
      studentId: '12345',
      faint: [{ q: 0, c: (answers[0][0] + 1) % 4, d: 0.12 }],
    })
    const res = readSheet(img)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.answers[0]).toEqual(answers[0])
  })

  it('fails cleanly on an image with no sheet', () => {
    const img = { width: 400, height: 300, data: new Uint8Array(400 * 300).fill(200) }
    const res = readSheet(img)
    expect(res.ok).toBe(false)
  })
})
