import { GENERIC_CODE, type SheetConfig } from '../omr/config'
import type { Database, Exam } from '../data/types'
import type { SheetTexts } from '../sheet/AnswerSheet'
import { roomLabel, termLabel } from './terms'

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

/** "ม.1/2", or a placeholder when the exam's class was deleted. */
export function examRoomLabel(db: Database, exam: Exam): string {
  const c = db.classrooms.find((x) => x.id === exam.classroomId)
  return c ? roomLabel(c) : 'ไม่ระบุห้อง'
}

/** What is printed on an exam's answer sheets besides the student fields. */
export function examSheetTexts(db: Database, exam: Exam): SheetTexts {
  const c = db.classrooms.find((x) => x.id === exam.classroomId)
  const term = db.terms.find((t) => t.id === exam.termId)
  return {
    title: exam.title,
    classroom: c ? roomLabel(c) : undefined,
    header: db.settings.sheetHeader || undefined,
    logo: db.settings.logo,
    footer: [db.settings.schoolName, term && `ภาคเรียน ${termLabel(term)}`, `รหัสแบบ ${exam.code}`, `${exam.sheet.questions} ข้อ`]
      .filter(Boolean)
      .join(' · '),
  }
}

/**
 * Can a scanned sheet be graded for this exam? Sheets printed for the exam carry its
 * code; general-purpose sheets fit any exam with the same layout.
 */
export function sheetFitsExam(cfg: SheetConfig, exam: Exam): string | null {
  if (cfg.examCode === exam.code) return null
  if (cfg.examCode !== GENERIC_CODE) return `กระดาษนี้พิมพ์สำหรับข้อสอบอื่น (รหัส ${cfg.examCode}) ไม่ใช่ข้อสอบนี้ (${exam.code})`
  const want = examConfig(exam)
  if (cfg.questions !== want.questions || cfg.choices !== want.choices || cfg.idDigits !== want.idDigits) {
    const id = (n: number) => (n ? `ฝนรหัส ${n} หลัก` : 'เขียนชื่อ')
    return `กระดาษเป็นแบบ ${cfg.questions} ข้อ ${cfg.choices} ตัวเลือก ${id(cfg.idDigits)} แต่ข้อสอบนี้เป็นแบบ ${want.questions} ข้อ ${want.choices} ตัวเลือก ${id(want.idDigits)}`
  }
  return null
}
