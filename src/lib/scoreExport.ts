/**
 * Score tables for one exam: what the export page shows, copies and writes to Excel.
 * Students are listed by เลขที่; students without a scanned sheet get empty scores.
 */
import type { ClassStudent, ScanRecord } from '../data/types'
import { grade, maxScore, type AnswerKey, type QuestionStatus } from '../omr/grading'
import type { Cell, SheetSpec } from './xlsx'

export interface ExportOptions {
  /** simple: points per question; full: answer, right/wrong and points per question */
  mode: 'simple' | 'full'
  /** Also give the total rescaled to this full score (e.g. 20), null = don't */
  convertTo: number | null
  decimals: 0 | 1 | 2
}

export interface ScoreTable {
  /** Header rows (1 for simple, 3 for full: question, field, answer key) */
  head: Cell[][]
  /** One row per student, in เลขที่ order */
  body: Cell[][]
  /** Totals per student (converted when asked), null = no sheet */
  totals: (number | null)[]
  merges: string[]
  colWidths: number[]
  maxScore: number
}

export const RESULT_TEXT: Record<QuestionStatus, string> = {
  correct: 'ถูก',
  wrong: 'ผิด',
  blank: 'ไม่ตอบ',
  multiple: 'ฝนหลายข้อ',
  free: 'ฟรี',
}

export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round((n + Number.EPSILON) * f) / f
}

function col(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export function buildScoreTable(
  students: ClassStudent[],
  scans: ScanRecord[],
  key: AnswerKey,
  labels: string[],
  opts: ExportOptions,
): ScoreTable {
  const full = maxScore(key)
  const q = key.answers.length
  const byCode = new Map(scans.filter((s) => s.studentCode).map((s) => [s.studentCode!, s]))
  const label = (c: number | null) => (c === null ? '' : labels[c])
  const convert = (score: number) => (opts.convertTo && full > 0 ? roundTo((score / full) * opts.convertTo, opts.decimals) : null)
  const totalHead = `รวม (เต็ม ${full})`
  const convHead = opts.convertTo ? [`คะแนนแปลง (เต็ม ${opts.convertTo})`] : []
  const people = ['เลขที่', 'เลขประจำตัว', 'ชื่อ-สกุล']

  const head: Cell[][] = []
  const merges: string[] = []
  if (opts.mode === 'simple') {
    head.push([...people, ...key.answers.map((_, i) => `ข้อ ${i + 1}`), totalHead, ...convHead])
  } else {
    const r1: Cell[] = ['', '', '']
    const r2: Cell[] = [...people]
    const r3: Cell[] = ['', '', 'เฉลย']
    key.answers.forEach((a, i) => {
      const c0 = 3 + i * 3
      r1.push(`ข้อ ${i + 1}`, '', '')
      merges.push(`${col(c0)}1:${col(c0 + 2)}1`)
      r2.push('ตอบ', 'ผล', 'คะแนน')
      r3.push(key.free[i] ? 'ฟรี' : label(a), '', key.points[i])
    })
    r1.push('', ...convHead.map(() => ''))
    r2.push(totalHead, ...convHead)
    r3.push(full, ...(opts.convertTo ? [opts.convertTo] : []))
    head.push(r1, r2, r3)
  }

  const totals: (number | null)[] = []
  const body = students.map((st) => {
    const scan = byCode.get(st.code)
    const row: Cell[] = [st.number || '', st.code, st.name]
    if (!scan) {
      totals.push(null)
      return [...row, ...Array(opts.mode === 'simple' ? q : q * 3).fill(''), '', ...convHead.map(() => '')]
    }
    const g = grade(scan.answers, key)
    const earned = (i: number) => (g.status[i] === 'correct' || g.status[i] === 'free' ? key.points[i] : 0)
    if (opts.mode === 'simple') key.answers.forEach((_, i) => row.push(earned(i)))
    else
      key.answers.forEach((_, i) => {
        row.push((scan.answers[i] ?? []).map((c) => labels[c]).join(','), RESULT_TEXT[g.status[i]], earned(i))
      })
    const conv = convert(g.score)
    totals.push(conv ?? g.score)
    row.push(g.score, ...(opts.convertTo ? [conv] : []))
    return row
  })

  const colWidths = [7, 12, 28, ...Array(opts.mode === 'simple' ? q : q * 3).fill(opts.mode === 'simple' ? 6 : 7), 12, ...convHead.map(() => 16)]
  return { head, body, totals, merges, colWidths, maxScore: full }
}

/** Tab-separated text for pasting into Excel / Google Sheets / school grade programs. */
export function toTsv(rows: Cell[][]): string {
  return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).replace(/[\t\n]/g, ' '))).join('\t')).join('\n')
}

/** Totals one per line in เลขที่ order (blank line for students without a sheet), ready to paste into a column. */
export function totalsText(totals: (number | null)[]): string {
  return totals.map((t) => (t === null ? '' : String(t))).join('\n')
}

export function scoreSheets(
  table: ScoreTable,
  info: { title: string; classroom: string; term: string },
  key: AnswerKey,
  labels: string[],
): SheetSpec[] {
  const titleRows: Cell[][] = [[`${info.title} · ${info.classroom} · ภาคเรียน ${info.term}`], []]
  const offset = titleRows.length
  const shift = (ref: string) => ref.replace(/\d+/g, (n) => String(Number(n) + offset))
  return [
    {
      name: 'คะแนน',
      rows: [...titleRows, ...table.head, ...table.body],
      boldRows: [0, ...table.head.map((_, i) => offset + i)],
      merges: table.merges.map((m) => m.split(':').map(shift).join(':')),
      colWidths: table.colWidths,
      freeze: { rows: offset + table.head.length, cols: 3 },
    },
    {
      name: 'เฉลย',
      rows: [
        ['ข้อ', 'เฉลย', 'คะแนนเต็ม'],
        ...key.answers.map((a, i) => [i + 1, key.free[i] ? 'ฟรี (ได้คะแนนทุกคน)' : a === null ? '' : labels[a], key.points[i]]),
        ['รวม', '', table.maxScore],
      ],
      boldRows: [0],
      colWidths: [8, 22, 12],
    },
  ]
}
