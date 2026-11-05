import type { LabelStyle } from '../omr/config'
import type { AnswerKey } from '../omr/grading'

/** 'pending' = signed up but not yet approved by an admin (cloud mode only) */
export type Role = 'admin' | 'teacher' | 'pending'

export interface User {
  id: string
  name: string
  email: string
  role: Role
}

export interface Classroom {
  id: string
  /** e.g. ม.3/1 */
  name: string
}

export interface Student {
  id: string
  classroomId: string
  /** เลขที่ */
  number: number
  /** รหัสนักเรียน (digits only, length = settings.idDigits) */
  code: string
  name: string
}

export interface SheetType {
  questions: number
  choices: number
  labelStyle: LabelStyle
}

export interface Exam {
  id: string
  /** Code printed in the sheet's QR so scans can't land in the wrong exam */
  code: string
  title: string
  classroomId: string
  ownerId: string
  createdAt: string
  sheet: SheetType
  /** Student-ID digits at the time the exam was created (sheets keep their layout) */
  idDigits: number
  key: AnswerKey
}

export interface ScanRecord {
  id: string
  examId: string
  /** Student ID as bubbled, or chosen by the teacher when the bubbles were unreadable */
  studentCode: string | null
  /** Marked choices per question */
  answers: number[][]
  /** Questions the scanner was unsure about (1-based) */
  uncertain: number[]
  scannedAt: string
  scannedBy: string
}

export interface Settings {
  schoolName: string
  idDigits: number
}

/** Email an admin pre-approved; signing up with it skips the approval step */
export interface AllowedEmail {
  email: string
  name: string | null
  role: Role
}

export interface Database {
  version: 1
  users: User[]
  allowedEmails: AllowedEmail[]
  /** Scans per exam as counted by the server (cloud mode, before an exam's scans are loaded) */
  scanCounts: Record<string, number>
  classrooms: Classroom[]
  students: Student[]
  exams: Exam[]
  scans: ScanRecord[]
  settings: Settings
}
