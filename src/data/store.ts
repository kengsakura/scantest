/**
 * App data store. Pages read a synchronous snapshot (`useDB`) and call the
 * mutation functions below. Two backends:
 *
 * - cloud (Supabase configured): the snapshot holds one term's classes, students
 *   and exams (the term being viewed), loaded after sign-in. Simple changes are
 *   applied to the snapshot immediately and then sent to the server; bulk changes
 *   (imports, new terms) run on the server and then reload. Scans go through a
 *   local outbox so scanning keeps working when the connection drops.
 * - local (no Supabase): everything lives in this browser's localStorage, with
 *   a pick-a-user demo login.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { randomExamCode } from '../omr/config'
import { emptyKey, type AnswerKey } from '../omr/grading'
import type { StudentRow } from '../lib/importers'
import { compareRooms, compareTerms, currentThaiTerm, fullName, type PromotionRow } from '../lib/terms'
import { api, CLOUD, fetchAll, fetchNameImages, fetchScans, fromScan, isNetworkError, loginEmail, supabase, thaiError } from './cloud'
import type {
  ClassStudent,
  Classroom,
  Database,
  Enrollment,
  Exam,
  Role,
  ScanRecord,
  Settings,
  SheetPreset,
  SheetType,
  Student,
  StudentStatus,
  Term,
  User,
} from './types'

const DB_KEY = 'scantest.db.v3'
const SESSION_KEY = 'scantest.session'
const VIEW_TERM_KEY = 'scantest.viewTerm'
const OUTBOX_KEY = 'scantest.outbox.v1'

export { CLOUD }

function uid(): string {
  return crypto.randomUUID()
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota or private mode: keep working in memory */
  }
}

export const DEFAULT_PRESETS: Omit<SheetPreset, 'id'>[] = [
  { name: '20 ข้อ 4 ตัวเลือก', questions: 20, choices: 4, labelStyle: 'thai', useStudentId: true, defaultPoints: 1, sort: 1 },
  { name: '30 ข้อ 4 ตัวเลือก', questions: 30, choices: 4, labelStyle: 'thai', useStudentId: true, defaultPoints: 1, sort: 2 },
  { name: '40 ข้อ 4 ตัวเลือก', questions: 40, choices: 4, labelStyle: 'thai', useStudentId: true, defaultPoints: 1, sort: 3 },
  { name: '50 ข้อ 5 ตัวเลือก', questions: 50, choices: 5, labelStyle: 'thai', useStudentId: true, defaultPoints: 1, sort: 4 },
  { name: 'ถูก/ผิด 20 ข้อ', questions: 20, choices: 2, labelStyle: 'truefalse', useStudentId: true, defaultPoints: 1, sort: 5 },
]

function emptyDB(): Database {
  return {
    version: 3,
    users: [],
    terms: [],
    classrooms: [],
    students: [],
    enrollments: [],
    presets: [],
    exams: [],
    scans: [],
    scanCounts: {},
    settings: { schoolName: 'โรงเรียนของฉัน', idDigits: 4, currentTermId: null, logo: null, sheetHeader: '' },
  }
}

function seed(): Database {
  const term: Term = { id: uid(), ...currentThaiTerm() }
  const classroom: Classroom = { id: uid(), termId: term.id, grade: 'ม.1', room: '1' }
  const people: [string, string, string][] = [
    ['ด.ช.', 'กิตติ', 'ใจดี'],
    ['ด.ญ.', 'ขวัญใจ', 'รักเรียน'],
    ['ด.ช.', 'คณิน', 'มั่นคง'],
    ['ด.ญ.', 'จันทร์เพ็ญ', 'แสงทอง'],
    ['ด.ช.', 'ชนาธิป', 'ศรีสุข'],
  ]
  const students: Student[] = people.map(([prefix, firstName, lastName], i) => ({
    id: uid(),
    code: String(1001 + i),
    prefix,
    firstName,
    lastName,
    status: 'active',
  }))
  return {
    ...emptyDB(),
    users: [
      { id: uid(), name: 'ผู้ดูแลระบบ', email: 'admin@scantest.local', username: 'admin', role: 'admin' },
      { id: uid(), name: 'ครูตัวอย่าง', email: 'teacher@scantest.local', username: 'teacher', role: 'teacher' },
    ],
    terms: [term],
    classrooms: [classroom],
    students,
    enrollments: students.map((s, i) => ({ id: uid(), termId: term.id, classroomId: classroom.id, studentId: s.id, number: i + 1 })),
    presets: DEFAULT_PRESETS.map((p) => ({ ...p, id: uid() })),
    settings: { ...emptyDB().settings, currentTermId: term.id, sheetHeader: 'โรงเรียนของฉัน' },
  }
}

function loadLocal(): Database {
  const saved = readStorage<Database | null>(DB_KEY, null)
  return saved && saved.version === 3 ? { ...emptyDB(), ...saved } : seed()
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type Phase = 'starting' | 'signed-out' | 'loading' | 'ready'

export interface AppState {
  phase: Phase
  /** Last error to show the user (cleared by dismissError) */
  error: string | null
  /** Scans saved on this device that have not reached the server yet */
  outbox: number
  /** The term whose classes and exams are shown (not necessarily the school's current term) */
  viewTermId: string | null
}

let db: Database = CLOUD ? emptyDB() : loadLocal()
let userId: string | null = CLOUD ? null : readStorage<string | null>(SESSION_KEY, null)
let outbox: ScanRecord[] = CLOUD ? readStorage<ScanRecord[]>(OUTBOX_KEY, []) : []
let app: AppState = {
  phase: CLOUD ? 'starting' : userId ? 'ready' : 'signed-out',
  error: null,
  outbox: outbox.length,
  viewTermId: readStorage<string | null>(VIEW_TERM_KEY, null),
}
const loadedScans = new Set<string>()

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

function commit(next: Database) {
  db = next
  if (!CLOUD) writeStorage(DB_KEY, db)
  emit()
}

function setApp(patch: Partial<AppState>) {
  app = { ...app, ...patch }
  emit()
}

export function useDB(): Database {
  return useSyncExternalStore(subscribe, () => db)
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, () => app)
}

export function useCurrentUser(): User | null {
  const d = useDB()
  const id = useSyncExternalStore(subscribe, () => userId)
  return d.users.find((u) => u.id === id) ?? null
}

export function getDB(): Database {
  return db
}

export function dismissError() {
  setApp({ error: null })
}

export function showError(message: string) {
  setApp({ error: message })
}

/** Send a change to the server; on failure show why and reload the true state. */
function remote(op: () => Promise<unknown>) {
  if (!CLOUD) return
  op().catch(async (err) => {
    setApp({ error: thaiError(err) })
    await reload()
  })
}

/** Run a bulk change: in the cloud it runs on the server and the data is reloaded afterwards. */
async function bulk(cloudOp: () => Promise<void>, localOp: () => void): Promise<string | null> {
  if (!CLOUD) {
    localOp()
    return null
  }
  try {
    await cloudOp()
    await reload()
    return null
  } catch (err) {
    await reload()
    return thaiError(err)
  }
}

/* ------------------------------------------------------------------ */
/* Terms being viewed                                                  */
/* ------------------------------------------------------------------ */

/** The term in view: the one picked on this device, else the school's current term, else the latest. */
export function viewTermOf(d: Database, wanted: string | null): Term | null {
  const sorted = [...d.terms].sort(compareTerms)
  return d.terms.find((t) => t.id === wanted) ?? d.terms.find((t) => t.id === d.settings.currentTermId) ?? sorted.at(-1) ?? null
}

export function useViewTerm(): Term | null {
  const d = useDB()
  const { viewTermId } = useAppState()
  return viewTermOf(d, viewTermId)
}

export function setViewTerm(id: string) {
  writeStorage(VIEW_TERM_KEY, id)
  setApp({ viewTermId: id })
  if (CLOUD) {
    loadedScans.clear()
    setApp({ phase: 'loading' })
    void reload()
  }
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

async function reload() {
  if (!CLOUD || !userId) return
  try {
    const snap = await fetchAll(userId, app.viewTermId)
    const keepScans = db.scans.filter((s) => loadedScans.has(s.examId))
    commit({
      ...emptyDB(),
      users: snap.users ?? [],
      terms: snap.terms ?? [],
      settings: snap.settings ?? emptyDB().settings,
      presets: snap.presets ?? [],
      classrooms: snap.classrooms ?? [],
      enrollments: snap.enrollments ?? [],
      students: snap.students ?? [],
      exams: snap.exams ?? [],
      scanCounts: snap.scanCounts ?? {},
      scans: keepScans,
    })
    setApp({ phase: 'ready', viewTermId: snap.termId ?? app.viewTermId })
    await Promise.all([...loadedScans].map((id) => loadScans(id)))
  } catch (err) {
    setApp({ phase: 'ready', error: thaiError(err) })
  }
}

if (CLOUD && supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    const id = session?.user.id ?? null
    if (id === userId && app.phase !== 'starting') return
    userId = id
    loadedScans.clear()
    if (!id) {
      commit(emptyDB())
      setApp({ phase: 'signed-out' })
      return
    }
    setApp({ phase: 'loading' })
    // don't call Supabase from inside the auth callback (it can deadlock)
    setTimeout(() => {
      void reload()
      void flushOutbox()
    }, 0)
  })
}

/** Local demo mode: sign in as an existing user. */
export function login(id: string) {
  userId = id
  writeStorage(SESSION_KEY, id)
  setApp({ phase: 'ready' })
}

/** Sign in with a username (admin-made account) or an e-mail address. */
export async function signInWithPassword(username: string, password: string): Promise<string | null> {
  const { error } = await supabase!.auth.signInWithPassword({ email: loginEmail(username), password })
  if (!error) return null
  return /fetch|network/i.test(error.message)
    ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต'
    : /invalid login/i.test(error.message)
      ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
      : /not confirmed/i.test(error.message)
        ? 'ยังไม่ได้ยืนยันอีเมล กรุณาเปิดลิงก์ในอีเมลก่อน'
        : error.message
}

/** First-time setup only: the very first account to sign up becomes the admin. */
export async function signUp(email: string, password: string, name: string): Promise<{ error: string | null; needsConfirm: boolean }> {
  const { data, error } = await supabase!.auth.signUp({
    email,
    password,
    options: { data: { full_name: name }, emailRedirectTo: window.location.origin },
  })
  if (error)
    return {
      error: /fetch|network/i.test(error.message)
        ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต'
        : /already registered/i.test(error.message)
          ? 'อีเมลนี้สมัครแล้ว ให้เข้าสู่ระบบแทน'
          : /signups? not allowed|disabled/i.test(error.message)
            ? 'ปิดการสมัครแล้ว ให้ผู้ดูแลระบบสร้างบัญชีให้'
            : /password/i.test(error.message)
              ? 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร'
              : error.message,
      needsConfirm: false,
    }
  return { error: null, needsConfirm: !data.session }
}

export function logout() {
  if (CLOUD && outbox.length > 0) {
    const ok = confirm(
      `ยังมีผลสแกน ${outbox.length} แผ่นที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ (อาจเพราะไม่มีอินเทอร์เน็ต)\nถ้าออกจากระบบตอนนี้ ผลสแกนเหล่านี้จะหายไป\n\nยืนยันออกจากระบบ?`,
    )
    if (!ok) return
    outbox = []
    saveOutbox()
  }
  if (CLOUD) {
    void supabase!.auth.signOut()
    return
  }
  userId = null
  writeStorage(SESSION_KEY, null)
  setApp({ phase: 'signed-out' })
}

/* ------------------------------------------------------------------ */
/* Users & settings (admin)                                            */
/* ------------------------------------------------------------------ */

export interface NewUser {
  username: string
  password: string
  name: string
  role: 'admin' | 'teacher'
}

/** Create an account the person signs in to with a username and password. Returns an error message or null. */
export async function createUser(u: NewUser): Promise<string | null> {
  const username = u.username.trim().toLowerCase()
  if (!CLOUD) {
    if (db.users.some((x) => x.username === username)) return `ชื่อผู้ใช้ ${username} มีอยู่แล้ว`
    commit({ ...db, users: [...db.users, { id: uid(), name: u.name, email: loginEmail(username), username, role: u.role }] })
    return null
  }
  try {
    await api.createUser(username, u.password, u.name, u.role)
    await reload()
    return null
  } catch (err) {
    return thaiError(err)
  }
}

export async function setUserPassword(id: string, password: string): Promise<string | null> {
  if (!CLOUD) return null // demo mode has no passwords
  try {
    await api.setPassword(id, password)
    return null
  } catch (err) {
    return thaiError(err)
  }
}

export async function deleteUser(id: string): Promise<string | null> {
  if (!CLOUD) {
    if (db.exams.some((e) => e.ownerId === id)) return 'ครูคนนี้มีข้อสอบอยู่ ให้ปิดการใช้งานแทนการลบ'
    commit({ ...db, users: db.users.filter((u) => u.id !== id) })
    return null
  }
  try {
    await api.deleteUser(id)
    await reload()
    return null
  } catch (err) {
    return thaiError(err)
  }
}

export function updateUser(id: string, patch: { name?: string; role?: Role }) {
  commit({ ...db, users: db.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) })
  remote(() => api.updateProfile(id, patch))
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...db.settings, ...patch }
  commit({ ...db, settings })
  remote(() => api.updateSettings(settings))
}

/* ------------------------------------------------------------------ */
/* Terms (admin)                                                       */
/* ------------------------------------------------------------------ */

export type NewTermPlan =
  | { mode: 'empty' }
  /** next semester of the same year: same classes, same students */
  | { mode: 'copy'; fromTermId: string }
  /** new school year: classes move up a grade, top grade graduates */
  | { mode: 'promote'; fromTermId: string; rows: PromotionRow[] }

/** Classes and enrollments for a new term, derived from another term's roster. */
export function planNewTermRoster(
  termId: string,
  roster: { classrooms: Classroom[]; enrollments: Enrollment[] },
  plan: NewTermPlan,
): { classrooms: Classroom[]; enrollments: Omit<Enrollment, 'id'>[]; graduates: string[] } {
  if (plan.mode === 'empty') return { classrooms: [], enrollments: [], graduates: [] }
  const classrooms = new Map<string, Classroom>()
  const classFor = (grade: string, room: string) => {
    const k = `${grade}\u0000${room}`
    if (!classrooms.has(k)) classrooms.set(k, { id: uid(), termId, grade, room })
    return classrooms.get(k)!
  }
  const enrollments: Omit<Enrollment, 'id'>[] = []
  const graduates: string[] = []
  for (const from of roster.classrooms) {
    const target = plan.mode === 'copy' ? { kind: 'class' as const, grade: from.grade, room: from.room } : plan.rows.find((r) => r.classroomId === from.id)?.target
    const members = roster.enrollments.filter((e) => e.classroomId === from.id)
    if (!target || target.kind === 'skip') continue
    if (target.kind === 'graduate') {
      graduates.push(...members.map((e) => e.studentId))
      continue
    }
    const to = classFor(target.grade, target.room)
    for (const e of members) enrollments.push({ termId, classroomId: to.id, studentId: e.studentId, number: e.number })
  }
  return { classrooms: [...classrooms.values()], enrollments, graduates }
}

/** Open a new term and make it the current one. Returns an error message or null. */
export async function createTerm(t: { year: number; semester: number }, plan: NewTermPlan): Promise<string | null> {
  if (db.terms.some((x) => x.year === t.year && x.semester === t.semester)) return `ภาคเรียน ${t.semester}/${t.year} มีอยู่แล้ว`
  const term: Term = { id: uid(), year: t.year, semester: t.semester }
  const err = await bulk(
    async () => {
      const roster = plan.mode === 'empty' ? { classrooms: [], enrollments: [] } : await api.fetchTermRoster(plan.fromTermId)
      const next = planNewTermRoster(term.id, roster, plan)
      await api.insertTerm(term)
      await api.insertClassrooms(next.classrooms)
      await api.upsertEnrollments(next.enrollments)
      if (next.graduates.length) await api.setStudentsStatus(next.graduates, 'graduated')
      await api.updateSettings({ ...db.settings, currentTermId: term.id })
      app = { ...app, viewTermId: term.id }
    },
    () => {
      const roster = plan.mode === 'empty' ? { classrooms: [], enrollments: [] } : rosterOf(db, plan.fromTermId)
      const next = planNewTermRoster(term.id, roster, plan)
      const grads = new Set(next.graduates)
      commit({
        ...db,
        terms: [...db.terms, term],
        classrooms: [...db.classrooms, ...next.classrooms],
        enrollments: [...db.enrollments, ...next.enrollments.map((e) => ({ ...e, id: uid() }))],
        students: db.students.map((s) => (grads.has(s.id) ? { ...s, status: 'graduated' as const } : s)),
        settings: { ...db.settings, currentTermId: term.id },
      })
      setApp({ viewTermId: term.id })
    },
  )
  writeStorage(VIEW_TERM_KEY, term.id)
  return err
}

function rosterOf(d: Database, termId: string) {
  return { classrooms: d.classrooms.filter((c) => c.termId === termId), enrollments: d.enrollments.filter((e) => e.termId === termId) }
}

export function setCurrentTerm(id: string) {
  updateSettings({ currentTermId: id })
}

/** Delete a term that has no exams (its classes and enrollments go with it). */
export async function deleteTerm(id: string): Promise<string | null> {
  if (db.settings.currentTermId === id) return 'ลบภาคเรียนปัจจุบันไม่ได้ ให้ตั้งภาคเรียนอื่นเป็นปัจจุบันก่อน'
  if (db.exams.some((e) => e.termId === id)) return 'ภาคเรียนนี้มีข้อสอบอยู่ ลบไม่ได้'
  return bulk(
    () => api.removeTerm(id),
    () =>
      commit({
        ...db,
        terms: db.terms.filter((t) => t.id !== id),
        classrooms: db.classrooms.filter((c) => c.termId !== id),
        enrollments: db.enrollments.filter((e) => e.termId !== id),
      }),
  )
}

/* ------------------------------------------------------------------ */
/* Classes & students (admin)                                          */
/* ------------------------------------------------------------------ */

export function classroomsOf(d: Database, termId: string | undefined): Classroom[] {
  return d.classrooms.filter((c) => c.termId === termId).sort(compareRooms)
}

export function studentsOf(d: Database, classroomId: string): ClassStudent[] {
  const byId = new Map(d.students.map((s) => [s.id, s]))
  return d.enrollments
    .filter((e) => e.classroomId === classroomId)
    .flatMap((e): ClassStudent[] => {
      const s = byId.get(e.studentId)
      return s
        ? [{ id: s.id, enrollmentId: e.id, classroomId: e.classroomId, number: e.number, code: s.code, prefix: s.prefix, firstName: s.firstName, lastName: s.lastName, name: fullName(s) }]
        : []
    })
    .sort((a, b) => a.number - b.number || a.code.localeCompare(b.code))
}

export function addClassroom(termId: string, grade: string, room: string): Classroom | string {
  if (db.classrooms.some((c) => c.termId === termId && c.grade === grade && c.room === room)) return `ห้อง ${grade}/${room} มีอยู่แล้ว`
  const c: Classroom = { id: uid(), termId, grade, room }
  commit({ ...db, classrooms: [...db.classrooms, c] })
  remote(() => api.insertClassrooms([c]))
  return c
}

export function updateClassroom(c: Classroom) {
  commit({ ...db, classrooms: db.classrooms.map((x) => (x.id === c.id ? c : x)) })
  remote(() => api.updateClassroom(c))
}

export function removeClassroom(id: string) {
  commit({ ...db, classrooms: db.classrooms.filter((c) => c.id !== id), enrollments: db.enrollments.filter((e) => e.classroomId !== id) })
  remote(() => api.removeClassroom(id))
}

/**
 * Add or update students for a term from imported rows: students are matched by
 * เลขประจำตัว, classes are created as needed, and each student is put in their class
 * (moved, if they were in another class this term). Returns an error message or null.
 */
export async function importStudentRows(termId: string, rows: StudentRow[]): Promise<string | null> {
  return bulk(
    async () => {
      const ids = await api.upsertStudents(rows)
      const existing = new Map(db.classrooms.filter((c) => c.termId === termId).map((c) => [`${c.grade}\u0000${c.room}`, c]))
      const created: Classroom[] = []
      for (const r of rows) {
        const k = `${r.grade}\u0000${r.room}`
        if (!existing.has(k)) {
          const c = { id: uid(), termId, grade: r.grade, room: r.room }
          existing.set(k, c)
          created.push(c)
        }
      }
      await api.insertClassrooms(created)
      await api.upsertEnrollments(
        rows.map((r) => ({ termId, classroomId: existing.get(`${r.grade}\u0000${r.room}`)!.id, studentId: ids.get(r.code)!, number: r.number })),
      )
    },
    () => {
      let { students, classrooms, enrollments } = db
      const byCode = new Map(students.map((s) => [s.code, s]))
      for (const r of rows) {
        const prev = byCode.get(r.code)
        const s: Student = { id: prev?.id ?? uid(), code: r.code, prefix: r.prefix, firstName: r.firstName, lastName: r.lastName, status: 'active' }
        byCode.set(r.code, s)
        let c = classrooms.find((x) => x.termId === termId && x.grade === r.grade && x.room === r.room)
        if (!c) {
          c = { id: uid(), termId, grade: r.grade, room: r.room }
          classrooms = [...classrooms, c]
        }
        enrollments = [
          ...enrollments.filter((e) => !(e.termId === termId && e.studentId === s.id)),
          { id: uid(), termId, classroomId: c.id, studentId: s.id, number: r.number },
        ]
      }
      students = [...byCode.values()]
      commit({ ...db, students, classrooms, enrollments })
    },
  )
}

/** Edit a student's details and their เลขที่ in this class. */
export function updateClassStudent(cs: ClassStudent, patch: { code?: string; prefix?: string; firstName?: string; lastName?: string; number?: number }) {
  const student = db.students.find((s) => s.id === cs.id)
  const enrollment = db.enrollments.find((e) => e.id === cs.enrollmentId)
  if (!student || !enrollment) return
  const { number, ...personal } = patch
  const s: Student = { ...student, ...personal }
  const e: Enrollment = { ...enrollment, number: number ?? enrollment.number }
  commit({ ...db, students: db.students.map((x) => (x.id === s.id ? s : x)), enrollments: db.enrollments.map((x) => (x.id === e.id ? e : x)) })
  remote(async () => {
    await api.updateStudent(s)
    if (e.number !== enrollment.number) await api.updateEnrollment(e)
  })
}

export function moveStudent(enrollmentId: string, classroomId: string) {
  const e = db.enrollments.find((x) => x.id === enrollmentId)
  if (!e) return
  const moved = { ...e, classroomId }
  commit({ ...db, enrollments: db.enrollments.map((x) => (x.id === e.id ? moved : x)) })
  remote(() => api.updateEnrollment(moved))
}

/** Take a student out of a class for this term (e.g. moved school). Their record and past terms stay. */
export function removeFromClass(enrollmentId: string, status: StudentStatus = 'left') {
  const e = db.enrollments.find((x) => x.id === enrollmentId)
  if (!e) return
  commit({
    ...db,
    enrollments: db.enrollments.filter((x) => x.id !== enrollmentId),
    students: db.students.map((s) => (s.id === e.studentId ? { ...s, status } : s)),
  })
  remote(async () => {
    await api.removeEnrollment(enrollmentId)
    await api.setStudentsStatus([e.studentId], status)
  })
}

/* ------------------------------------------------------------------ */
/* Answer-sheet presets (admin)                                        */
/* ------------------------------------------------------------------ */

export function savePreset(p: Omit<SheetPreset, 'id' | 'sort'> & { id?: string }): SheetPreset {
  const prev = db.presets.find((x) => x.id === p.id)
  const preset: SheetPreset = { ...p, id: p.id ?? uid(), sort: prev?.sort ?? Math.max(0, ...db.presets.map((x) => x.sort)) + 1 }
  commit({ ...db, presets: prev ? db.presets.map((x) => (x.id === preset.id ? preset : x)) : [...db.presets, preset] })
  remote(() => api.upsertPreset(preset))
  return preset
}

export function removePreset(id: string) {
  commit({ ...db, presets: db.presets.filter((p) => p.id !== id) })
  remote(() => api.removePreset(id))
}

export function movePreset(id: string, dir: -1 | 1) {
  const list = [...db.presets].sort((a, b) => a.sort - b.sort)
  const i = list.findIndex((p) => p.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  const presets = list.map((p, k) => ({ ...p, sort: k + 1 }))
  commit({ ...db, presets })
  remote(async () => {
    for (const p of [presets[i], presets[j]]) await api.upsertPreset(p)
  })
}

export function sortedPresets(d: Database): SheetPreset[] {
  return [...d.presets].sort((a, b) => a.sort - b.sort)
}

/* ------------------------------------------------------------------ */
/* Exams                                                               */
/* ------------------------------------------------------------------ */

export function createExam(input: {
  title: string
  termId: string
  classroomId: string
  ownerId: string
  sheet: SheetType
  defaultPoints: number
  /** false = sheet has no ID grid; students are matched later from the name picture */
  useStudentId: boolean
  presetId: string | null
}): Exam {
  const used = new Set(db.exams.map((e) => e.code))
  let code = randomExamCode()
  while (used.has(code)) code = randomExamCode()
  const exam: Exam = {
    id: uid(),
    code,
    title: input.title,
    termId: input.termId,
    classroomId: input.classroomId,
    ownerId: input.ownerId,
    createdAt: new Date().toISOString(),
    sheet: input.sheet,
    idDigits: input.useStudentId ? db.settings.idDigits : 0,
    presetId: input.presetId,
    key: emptyKey(input.sheet.questions, input.defaultPoints),
  }
  commit({ ...db, exams: [exam, ...db.exams] })
  remote(() => api.insertExam(exam))
  return exam
}

export function updateExam(id: string, patch: Partial<Pick<Exam, 'title' | 'classroomId'>> & { key?: AnswerKey }) {
  const exams = db.exams.map((e) => (e.id === id ? { ...e, ...patch } : e))
  commit({ ...db, exams })
  const exam = exams.find((e) => e.id === id)
  if (exam) remote(() => api.updateExam(exam))
}

export function removeExam(id: string) {
  commit({ ...db, exams: db.exams.filter((e) => e.id !== id), scans: db.scans.filter((s) => s.examId !== id) })
  remote(() => api.removeExam(id))
}

/** Exams the user may see in a term: their own, or all for admins. */
export function visibleExams(d: Database, user: User, termId: string | undefined): Exam[] {
  return d.exams.filter((e) => e.termId === termId && (user.role === 'admin' || e.ownerId === user.id))
}

/* ------------------------------------------------------------------ */
/* Scans                                                               */
/* ------------------------------------------------------------------ */

const nameImages = new Map<string, string | null>()
const requestedImages = new Set<string>()
let imageBatch = new Set<string>()
let imageTimer = 0

/** Collect the pictures requested during one render pass and fetch them in a single query. */
function requestNameImage(id: string) {
  if (requestedImages.has(id)) return
  requestedImages.add(id)
  imageBatch.add(id)
  if (!imageTimer) imageTimer = window.setTimeout(flushImageBatch, 20)
}

async function flushImageBatch() {
  imageTimer = 0
  const ids = [...imageBatch]
  imageBatch = new Set()
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    try {
      const found = await fetchNameImages(chunk)
      for (const id of chunk) nameImages.set(id, found.get(id) ?? null)
    } catch {
      chunk.forEach((id) => requestedImages.delete(id)) // allow a retry on next view
    }
    emit()
  }
}

/** The scan's name picture, fetched from the server the first time it is needed. */
export function useNameImage(scan: ScanRecord | null): string | null | undefined {
  const id = scan?.id
  const fetched = useSyncExternalStore(subscribe, () => (id ? nameImages.get(id) : undefined))
  const missing = scan !== null && scan.nameImage === undefined
  useEffect(() => {
    if (CLOUD && id && missing) requestNameImage(id)
  }, [id, missing])
  if (!scan) return null
  if (scan.nameImage !== undefined) return scan.nameImage
  if (!CLOUD) return null // nothing to fetch in local demo mode
  return fetched
}

export function scansOf(d: Database, examId: string): ScanRecord[] {
  return d.scans.filter((s) => s.examId === examId).sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))
}

/** Number of scanned sheets, also before the exam's scans have been loaded. */
export function scanCount(d: Database, examId: string): number {
  if (!CLOUD || loadedScans.has(examId)) return scansOf(d, examId).length
  return d.scanCounts[examId] ?? 0
}

function replaceScan(list: ScanRecord[], rec: ScanRecord): ScanRecord[] {
  return [
    rec,
    ...list.filter((s) => s.id !== rec.id && !(s.examId === rec.examId && rec.studentCode !== null && s.studentCode === rec.studentCode)),
  ]
}

async function loadScans(examId: string) {
  try {
    const known = new Map(db.scans.map((s) => [s.id, s]))
    // list queries skip name pictures: keep any we already have in memory
    const remoteScans = (await fetchScans(examId)).map((s) => {
      const prev = known.get(s.id)
      return prev?.nameImage !== undefined ? { ...s, nameImage: prev.nameImage } : s
    })
    loadedScans.add(examId)
    // keep scans still waiting in the outbox on top of what the server has
    let scans = [...db.scans.filter((s) => s.examId !== examId), ...remoteScans]
    for (const pending of outbox.filter((s) => s.examId === examId)) scans = replaceScan(scans, pending)
    commit({ ...db, scans })
  } catch (err) {
    setApp({ error: thaiError(err) })
  }
}

/** Load an exam's scans and keep them live while the page is open (cloud mode). */
export function useExamScans(examId: string) {
  const phase = useAppState().phase
  useEffect(() => {
    if (!CLOUD || !supabase || phase !== 'ready') return
    void loadScans(examId)
    const channel = supabase
      .channel(`scans-${examId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scans', filter: `exam_id=eq.${examId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id?: string }).id
          if (id) commit({ ...db, scans: db.scans.filter((s) => s.id !== id) })
        } else {
          commit({ ...db, scans: replaceScan(db.scans, fromScan(payload.new as Parameters<typeof fromScan>[0])) })
        }
      })
      .subscribe()
    return () => {
      void supabase!.removeChannel(channel)
    }
  }, [examId, phase])
}

function saveOutbox() {
  writeStorage(OUTBOX_KEY, outbox)
  setApp({ outbox: outbox.length })
}

let flushing = false
async function flushOutbox() {
  if (!CLOUD || flushing || !userId || outbox.length === 0) return
  flushing = true
  try {
    while (outbox.length > 0) {
      const rec = outbox[0]
      try {
        await api.saveScan(rec)
      } catch (err) {
        if (isNetworkError(err)) break // offline: keep it and retry later
        setApp({ error: thaiError(err) }) // rejected by the server: don't retry forever
      }
      // compare by reference: if the entry was edited meanwhile, the new version stays queued
      outbox = outbox.filter((s) => s !== rec)
      saveOutbox()
    }
  } finally {
    flushing = false
  }
}

if (CLOUD) {
  window.addEventListener('online', () => void flushOutbox())
  setInterval(() => void flushOutbox(), 15000)
}

/** Save a scan. A student scanned again replaces their previous sheet for this exam. */
export function saveScan(rec: Omit<ScanRecord, 'id' | 'scannedAt'>): ScanRecord {
  const full: ScanRecord = { ...rec, id: uid(), scannedAt: new Date().toISOString() }
  commit({ ...db, scans: replaceScan(db.scans, full) })
  if (CLOUD) {
    outbox = replaceScan(outbox, full)
    saveOutbox()
    void flushOutbox()
  }
  return full
}

export function setScanStudent(scanId: string, studentCode: string) {
  const rec = db.scans.find((s) => s.id === scanId)
  if (!rec) return
  const updated = { ...rec, studentCode }
  commit({ ...db, scans: replaceScan(db.scans, updated) })
  if (!CLOUD) return
  if (outbox.some((s) => s.id === scanId)) {
    outbox = replaceScan(outbox, updated)
    saveOutbox()
    void flushOutbox()
  } else {
    remote(() => api.setScanStudent(rec, studentCode))
  }
}

/** Teacher corrected the marks read from a sheet ("แก้คำตอบ"). */
export function updateScanAnswers(scanId: string, answers: number[][]) {
  const rec = db.scans.find((s) => s.id === scanId)
  if (!rec) return
  const updated = { ...rec, answers, uncertain: [] }
  commit({ ...db, scans: replaceScan(db.scans, updated) })
  if (!CLOUD) return
  if (outbox.some((s) => s.id === scanId)) {
    outbox = replaceScan(outbox, updated)
    saveOutbox()
    void flushOutbox()
  } else {
    remote(() => api.updateScanAnswers(scanId, answers))
  }
}

export function removeScan(id: string) {
  commit({ ...db, scans: db.scans.filter((s) => s.id !== id) })
  if (!CLOUD) return
  if (outbox.some((s) => s.id === id)) {
    outbox = outbox.filter((s) => s.id !== id)
    saveOutbox()
  } else {
    remote(() => api.removeScan(id))
  }
}
