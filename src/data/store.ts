/**
 * Local (browser-only) data store used while there is no Supabase project yet.
 * All reads/writes go through the functions below so the backend can later be
 * swapped for Supabase without touching the pages.
 */
import { useSyncExternalStore } from 'react'
import { randomExamCode } from '../omr/config'
import { emptyKey, type AnswerKey } from '../omr/grading'
import type { Classroom, Database, Exam, ScanRecord, Settings, SheetType, Student, User } from './types'

const DB_KEY = 'scantest.db.v1'
const SESSION_KEY = 'scantest.session'

function uid(): string {
  return crypto.randomUUID()
}

function seed(): Database {
  const classroomId = uid()
  const names = ['ด.ช. กิตติ ใจดี', 'ด.ญ. ขวัญใจ รักเรียน', 'ด.ช. คณิน มั่นคง', 'ด.ญ. จันทร์เพ็ญ แสงทอง', 'ด.ช. ชนาธิป ศรีสุข']
  return {
    version: 1,
    users: [
      { id: uid(), name: 'ผู้ดูแลระบบ', email: 'admin@school.ac.th', role: 'admin' },
      { id: uid(), name: 'ครูตัวอย่าง', email: 'teacher@school.ac.th', role: 'teacher' },
    ],
    classrooms: [{ id: classroomId, name: 'ม.1/1 (ตัวอย่าง)' }],
    students: names.map((name, i) => ({ id: uid(), classroomId, number: i + 1, code: String(10001 + i), name })),
    exams: [],
    scans: [],
    settings: { schoolName: 'โรงเรียนของฉัน', idDigits: 5 },
  }
}

function load(): Database {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      const db = JSON.parse(raw) as Database
      if (db.version === 1) return db
    }
  } catch {
    /* storage unavailable or corrupt: fall back to a fresh database */
  }
  return seed()
}

let db: Database = load()
let session: string | null = (() => {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
})()
const listeners = new Set<() => void>()

function commit(next: Database) {
  db = next
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    /* quota or private mode: keep working in memory */
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useDB(): Database {
  return useSyncExternalStore(subscribe, () => db)
}

export function useCurrentUser(): User | null {
  const d = useDB()
  const id = useSyncExternalStore(subscribe, () => session)
  return d.users.find((u) => u.id === id) ?? null
}

export function getDB(): Database {
  return db
}

/* ---- session ---- */

export function login(userId: string) {
  session = userId
  try {
    localStorage.setItem(SESSION_KEY, userId)
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export function logout() {
  session = null
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

/* ---- users & settings (admin) ---- */

export function addUser(u: Omit<User, 'id'>) {
  commit({ ...db, users: [...db.users, { ...u, id: uid() }] })
}

export function updateUser(id: string, patch: Partial<Omit<User, 'id'>>) {
  commit({ ...db, users: db.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) })
}

export function removeUser(id: string) {
  commit({ ...db, users: db.users.filter((u) => u.id !== id) })
}

export function updateSettings(patch: Partial<Settings>) {
  commit({ ...db, settings: { ...db.settings, ...patch } })
}

/* ---- classrooms & students (admin) ---- */

export function addClassroom(name: string): Classroom {
  const c = { id: uid(), name }
  commit({ ...db, classrooms: [...db.classrooms, c] })
  return c
}

export function renameClassroom(id: string, name: string) {
  commit({ ...db, classrooms: db.classrooms.map((c) => (c.id === id ? { ...c, name } : c)) })
}

export function removeClassroom(id: string) {
  commit({
    ...db,
    classrooms: db.classrooms.filter((c) => c.id !== id),
    students: db.students.filter((s) => s.classroomId !== id),
  })
}

export function addStudents(classroomId: string, rows: Omit<Student, 'id' | 'classroomId'>[]) {
  const existing = db.students.filter((s) => s.classroomId === classroomId)
  const byCode = new Map(existing.map((s) => [s.code, s]))
  const updated = [...db.students]
  for (const r of rows) {
    const prev = byCode.get(r.code)
    if (prev) {
      const i = updated.findIndex((s) => s.id === prev.id)
      updated[i] = { ...prev, ...r }
    } else {
      updated.push({ ...r, id: uid(), classroomId })
    }
  }
  commit({ ...db, students: updated })
}

export function removeStudent(id: string) {
  commit({ ...db, students: db.students.filter((s) => s.id !== id) })
}

export function studentsOf(d: Database, classroomId: string): Student[] {
  return d.students.filter((s) => s.classroomId === classroomId).sort((a, b) => a.number - b.number)
}

/* ---- exams ---- */

export function createExam(input: { title: string; classroomId: string; ownerId: string; sheet: SheetType; defaultPoints: number }): Exam {
  const used = new Set(db.exams.map((e) => e.code))
  let code = randomExamCode()
  while (used.has(code)) code = randomExamCode()
  const exam: Exam = {
    id: uid(),
    code,
    title: input.title,
    classroomId: input.classroomId,
    ownerId: input.ownerId,
    createdAt: new Date().toISOString(),
    sheet: input.sheet,
    idDigits: db.settings.idDigits,
    key: emptyKey(input.sheet.questions, input.defaultPoints),
  }
  commit({ ...db, exams: [exam, ...db.exams] })
  return exam
}

export function updateExam(id: string, patch: Partial<Pick<Exam, 'title' | 'classroomId'>> & { key?: AnswerKey }) {
  commit({ ...db, exams: db.exams.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
}

export function removeExam(id: string) {
  commit({ ...db, exams: db.exams.filter((e) => e.id !== id), scans: db.scans.filter((s) => s.examId !== id) })
}

export function visibleExams(d: Database, user: User): Exam[] {
  return d.exams.filter((e) => user.role === 'admin' || e.ownerId === user.id)
}

/* ---- scans ---- */

/** Save a scan. A student scanned again replaces their previous sheet for this exam. */
export function saveScan(rec: Omit<ScanRecord, 'id' | 'scannedAt'>): ScanRecord {
  const full: ScanRecord = { ...rec, id: uid(), scannedAt: new Date().toISOString() }
  const others = db.scans.filter(
    (s) => !(s.examId === rec.examId && rec.studentCode !== null && s.studentCode === rec.studentCode),
  )
  commit({ ...db, scans: [full, ...others] })
  return full
}

export function setScanStudent(scanId: string, studentCode: string) {
  const rec = db.scans.find((s) => s.id === scanId)
  if (!rec) return
  const others = db.scans.filter((s) => s.id !== scanId && !(s.examId === rec.examId && s.studentCode === studentCode))
  commit({ ...db, scans: [{ ...rec, studentCode }, ...others] })
}

export function removeScan(id: string) {
  commit({ ...db, scans: db.scans.filter((s) => s.id !== id) })
}

export function scansOf(d: Database, examId: string): ScanRecord[] {
  return d.scans.filter((s) => s.examId === examId)
}
