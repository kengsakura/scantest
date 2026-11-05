import type { LabelStyle } from '../omr/config'
import type { AnswerKey } from '../omr/grading'

/** 'pending' = can't use the app (self sign-up awaiting approval, or disabled by an admin) */
export type Role = 'admin' | 'teacher' | 'pending'

export interface User {
  id: string
  name: string
  email: string
  /** Sign-in name for accounts the admin created; null for e-mail accounts */
  username: string | null
  role: Role
}

/** ภาคเรียน `semester` of ปีการศึกษา `year` (Buddhist year) */
export interface Term {
  id: string
  year: number
  semester: number
}

/** A class in one term, e.g. ม.1 / 2 */
export interface Classroom {
  id: string
  termId: string
  grade: string
  room: string
}

export type StudentStatus = 'active' | 'graduated' | 'left'

/** A student as a person, across all terms */
export interface Student {
  id: string
  /** เลขประจำตัว */
  code: string
  prefix: string
  firstName: string
  lastName: string
  status: StudentStatus
}

/** Which class (and เลขที่) a student is in for one term */
export interface Enrollment {
  id: string
  termId: string
  classroomId: string
  studentId: string
  number: number
}

/** A student as listed in one class: person + enrollment */
export interface ClassStudent {
  id: string
  enrollmentId: string
  classroomId: string
  number: number
  code: string
  prefix: string
  firstName: string
  lastName: string
  /** prefix + first + last name */
  name: string
}

export interface SheetType {
  questions: number
  choices: number
  labelStyle: LabelStyle
}

/** Answer-sheet preset prepared by the admin */
export interface SheetPreset extends SheetType {
  id: string
  name: string
  useStudentId: boolean
  defaultPoints: number
  sort: number
}

export interface Exam {
  id: string
  /** Code printed in the sheet's QR so scans can't land in the wrong exam */
  code: string
  title: string
  termId: string
  classroomId: string
  ownerId: string
  createdAt: string
  sheet: SheetType
  /** Student-ID digits on this exam's sheets; 0 = no ID grid, students are matched from the name picture */
  idDigits: number
  presetId: string | null
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
  /** Small image (data URL) of the handwritten name/class area, to identify the student by eye.
   *  undefined = not loaded yet, null = none */
  nameImage?: string | null
}

export interface Settings {
  schoolName: string
  idDigits: number
  currentTermId: string | null
  /** School logo printed on answer sheets (small data URL), null = none */
  logo: string | null
  /** Line printed above the exam title on answer sheets ('' = none) */
  sheetHeader: string
}

export interface Database {
  version: 3
  users: User[]
  terms: Term[]
  /** Classrooms / enrollments / exams of the term being viewed (cloud) or of all terms (local) */
  classrooms: Classroom[]
  students: Student[]
  enrollments: Enrollment[]
  presets: SheetPreset[]
  exams: Exam[]
  scans: ScanRecord[]
  /** Scans per exam as counted by the server (cloud mode, before an exam's scans are loaded) */
  scanCounts: Record<string, number>
  settings: Settings
}
