/**
 * App data store. Pages read a synchronous snapshot (`useDB`) and call the
 * mutation functions below. Two backends:
 *
 * - cloud (Supabase configured): the snapshot is loaded from the server after
 *   sign-in, every change is applied to the snapshot immediately and then sent
 *   to the server. Scans go through a local outbox so scanning keeps working
 *   when the connection drops; they upload as soon as it is back.
 * - local (no Supabase): everything lives in this browser's localStorage, with
 *   a pick-a-user demo login.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { randomExamCode } from '../omr/config'
import { emptyKey, type AnswerKey } from '../omr/grading'
import { api, CLOUD, fetchAll, fetchNameImages, fetchScans, fromScan, isNetworkError, supabase, thaiError } from './cloud'
import type { AllowedEmail, Classroom, Database, Exam, Role, ScanRecord, Settings, SheetType, Student, User } from './types'

const DB_KEY = 'scantest.db.v1'
const SESSION_KEY = 'scantest.session'
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

function emptyDB(): Database {
  return {
    version: 1,
    users: [],
    allowedEmails: [],
    scanCounts: {},
    classrooms: [],
    students: [],
    exams: [],
    scans: [],
    settings: { schoolName: 'โรงเรียนของฉัน', idDigits: 5 },
  }
}

function seed(): Database {
  const classroomId = uid()
  const names = ['ด.ช. กิตติ ใจดี', 'ด.ญ. ขวัญใจ รักเรียน', 'ด.ช. คณิน มั่นคง', 'ด.ญ. จันทร์เพ็ญ แสงทอง', 'ด.ช. ชนาธิป ศรีสุข']
  return {
    ...emptyDB(),
    users: [
      { id: uid(), name: 'ผู้ดูแลระบบ', email: 'admin@school.ac.th', role: 'admin' },
      { id: uid(), name: 'ครูตัวอย่าง', email: 'teacher@school.ac.th', role: 'teacher' },
    ],
    classrooms: [{ id: classroomId, name: 'ม.1/1 (ตัวอย่าง)' }],
    students: names.map((name, i) => ({ id: uid(), classroomId, number: i + 1, code: String(10001 + i), name })),
  }
}

function loadLocal(): Database {
  const db = readStorage<Database | null>(DB_KEY, null)
  return db && db.version === 1 ? { ...emptyDB(), ...db } : seed()
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
}

let db: Database = CLOUD ? emptyDB() : loadLocal()
let userId: string | null = CLOUD ? null : readStorage<string | null>(SESSION_KEY, null)
let app: AppState = { phase: CLOUD ? 'starting' : userId ? 'ready' : 'signed-out', error: null, outbox: 0 }
let outbox: ScanRecord[] = CLOUD ? readStorage<ScanRecord[]>(OUTBOX_KEY, []) : []
app = { ...app, outbox: outbox.length }
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

/** Send a change to the server; on failure show why and reload the true state. */
function remote(op: () => Promise<void>) {
  if (!CLOUD) return
  op().catch(async (err) => {
    setApp({ error: thaiError(err) })
    await reload()
  })
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

async function reload() {
  if (!CLOUD || !userId) return
  try {
    const data = await fetchAll(userId)
    const keepScans = db.scans.filter((s) => loadedScans.has(s.examId))
    const rest: Partial<Database> & { me?: User | null } = { ...data }
    delete rest.me
    commit({ ...emptyDB(), ...rest, scans: keepScans })
    setApp({ phase: 'ready' })
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

export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  const { error } = await supabase!.auth.signInWithPassword({ email, password })
  if (!error) return null
  return /fetch|network/i.test(error.message)
    ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต'
    : /invalid login/i.test(error.message)
    ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
    : /not confirmed/i.test(error.message)
      ? 'ยังไม่ได้ยืนยันอีเมล กรุณาเปิดลิงก์ในอีเมลก่อน'
      : error.message
}

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

/** Local mode: create a user. Cloud mode: pre-approve an email (they sign up themselves). */
export function addUser(u: Omit<User, 'id'>) {
  if (CLOUD) {
    const a: AllowedEmail = { email: u.email.trim().toLowerCase(), name: u.name || null, role: u.role }
    commit({ ...db, allowedEmails: [...db.allowedEmails.filter((x) => x.email !== a.email), a] })
    remote(() => api.upsertAllowedEmail(a))
    return
  }
  commit({ ...db, users: [...db.users, { ...u, id: uid() }] })
}

export function removeAllowedEmail(email: string) {
  commit({ ...db, allowedEmails: db.allowedEmails.filter((a) => a.email !== email) })
  remote(() => api.removeAllowedEmail(email))
}

export function updateUser(id: string, patch: { name?: string; role?: Role }) {
  commit({ ...db, users: db.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) })
  remote(() => api.updateProfile(id, patch))
}

export function removeUser(id: string) {
  commit({ ...db, users: db.users.filter((u) => u.id !== id) })
  remote(() => api.removeProfile(id))
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...db.settings, ...patch }
  commit({ ...db, settings })
  remote(() => api.updateSettings(settings))
}

/* ------------------------------------------------------------------ */
/* Classrooms & students (admin)                                       */
/* ------------------------------------------------------------------ */

export function addClassroom(name: string): Classroom {
  const c = { id: uid(), name }
  commit({ ...db, classrooms: [...db.classrooms, c] })
  remote(() => api.insertClassroom(c))
  return c
}

export function renameClassroom(id: string, name: string) {
  commit({ ...db, classrooms: db.classrooms.map((c) => (c.id === id ? { ...c, name } : c)) })
  remote(() => api.renameClassroom(id, name))
}

export function removeClassroom(id: string) {
  commit({
    ...db,
    classrooms: db.classrooms.filter((c) => c.id !== id),
    students: db.students.filter((s) => s.classroomId !== id),
  })
  remote(() => api.removeClassroom(id))
}

/** Add students; a row whose code already exists in the classroom updates that student. */
export function addStudents(classroomId: string, rows: Omit<Student, 'id' | 'classroomId'>[]) {
  const byCode = new Map(db.students.filter((s) => s.classroomId === classroomId).map((s) => [s.code, s]))
  const changed: Student[] = rows.map((r) => {
    const prev = byCode.get(r.code)
    return prev ? { ...prev, ...r } : { ...r, id: uid(), classroomId }
  })
  const ids = new Set(changed.map((s) => s.id))
  commit({ ...db, students: [...db.students.filter((s) => !ids.has(s.id)), ...changed] })
  remote(() => api.upsertStudents(changed))
}

export function removeStudent(id: string) {
  commit({ ...db, students: db.students.filter((s) => s.id !== id) })
  remote(() => api.removeStudent(id))
}

export function studentsOf(d: Database, classroomId: string): Student[] {
  return d.students.filter((s) => s.classroomId === classroomId).sort((a, b) => a.number - b.number)
}

/* ------------------------------------------------------------------ */
/* Exams                                                               */
/* ------------------------------------------------------------------ */

export function createExam(input: {
  title: string
  classroomId: string
  ownerId: string
  sheet: SheetType
  defaultPoints: number
  /** false = sheet has no ID grid; students are matched later from the name picture */
  useStudentId: boolean
}): Exam {
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
    idDigits: input.useStudentId ? db.settings.idDigits : 0,
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

export function visibleExams(d: Database, user: User): Exam[] {
  return d.exams.filter((e) => user.role === 'admin' || e.ownerId === user.id)
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
