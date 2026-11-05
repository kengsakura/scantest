import type { SheetConfig } from '../omr/config'
import type { Exam } from '../data/types'

export function examConfig(exam: Exam): SheetConfig {
  return {
    questions: exam.sheet.questions,
    choices: exam.sheet.choices,
    labelStyle: exam.sheet.labelStyle,
    idDigits: exam.idDigits,
    versions: 0,
    examCode: exam.code,
  }
}

export function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}
