export interface AnswerKey {
  /** Correct choice index per question; null = not set yet */
  answers: (number | null)[]
  /** Points per question */
  points: number[]
  /** Free questions: everyone gets the points whatever they marked */
  free: boolean[]
}

export type QuestionStatus = 'correct' | 'wrong' | 'blank' | 'multiple' | 'free'

export interface GradeResult {
  score: number
  maxScore: number
  correct: number
  status: QuestionStatus[]
}

export function emptyKey(questions: number, defaultPoints = 1): AnswerKey {
  return {
    answers: Array(questions).fill(null),
    points: Array(questions).fill(defaultPoints),
    free: Array(questions).fill(false),
  }
}

/** Questions that still need an answer before the key can be used (1-based). */
export function missingAnswers(key: AnswerKey): number[] {
  return key.answers.flatMap((a, i) => (a === null && !key.free[i] ? [i + 1] : []))
}

export function maxScore(key: AnswerKey): number {
  return round(key.points.reduce((s, p) => s + p, 0))
}

/**
 * Grade one sheet. Rules:
 * - free question: full points no matter what (even blank or multiple)
 * - exactly one mark equal to the key: full points
 * - blank, more than one mark, or a different mark: 0
 */
export function grade(marks: number[][], key: AnswerKey): GradeResult {
  let score = 0
  let correct = 0
  const status = key.answers.map((ans, i): QuestionStatus => {
    const m = marks[i] ?? []
    if (key.free[i]) {
      score += key.points[i]
      return 'free'
    }
    if (m.length === 0) return 'blank'
    if (m.length > 1) return 'multiple'
    if (ans !== null && m[0] === ans) {
      score += key.points[i]
      correct++
      return 'correct'
    }
    return 'wrong'
  })
  return { score: round(score), maxScore: maxScore(key), correct, status }
}

function round(n: number) {
  return Math.round(n * 100) / 100
}
