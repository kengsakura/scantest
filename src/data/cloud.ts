/**
 * Supabase adapter: client, row <-> app type mapping and queries.
 * Active when VITE_SUPABASE_URL and VITE_SUPABASE_KEY are set at build time;
 * otherwise the app runs in local demo mode.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AnswerKey } from '../omr/grading'
import type { AllowedEmail, Classroom, Database, Exam, ScanRecord, Settings, SheetType, Student, User } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null

export const CLOUD = supabase !== null

/* ---- rows ---- */

interface ProfileRow {
  id: string
  email: string
  name: string
  role: User['role']
}
interface StudentRow {
  id: string
  classroom_id: string
  number: number
  code: string
  name: string
}
interface ExamRow {
  id: string
  code: string
  title: string
  classroom_id: string | null
  owner_id: string
  created_at: string
  sheet: SheetType
  id_digits: number
  key: AnswerKey
}
interface ScanRow {
  id: string
  exam_id: string
  student_code: string | null
  answers: number[][]
  uncertain: number[]
  scanned_at: string
  scanned_by: string | null
}
interface SettingsRow {
  school_name: string
  id_digits: number
}

export const fromProfile = (r: ProfileRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role })
export const fromStudent = (r: StudentRow): Student => ({ id: r.id, classroomId: r.classroom_id, number: r.number, code: r.code, name: r.name })
export const toStudent = (s: Student): StudentRow => ({ id: s.id, classroom_id: s.classroomId, number: s.number, code: s.code, name: s.name })
export const fromExam = (r: ExamRow): Exam => ({
  id: r.id,
  code: r.code,
  title: r.title,
  classroomId: r.classroom_id ?? '',
  ownerId: r.owner_id,
  createdAt: r.created_at,
  sheet: r.sheet,
  idDigits: r.id_digits,
  key: r.key,
})
export const toExam = (e: Exam): ExamRow => ({
  id: e.id,
  code: e.code,
  title: e.title,
  classroom_id: e.classroomId || null,
  owner_id: e.ownerId,
  created_at: e.createdAt,
  sheet: e.sheet,
  id_digits: e.idDigits,
  key: e.key,
})
export const fromScan = (r: ScanRow): ScanRecord => ({
  id: r.id,
  examId: r.exam_id,
  studentCode: r.student_code,
  answers: r.answers,
  uncertain: r.uncertain ?? [],
  scannedAt: r.scanned_at,
  scannedBy: r.scanned_by ?? '',
})
export const toScan = (s: ScanRecord): ScanRow => ({
  id: s.id,
  exam_id: s.examId,
  student_code: s.studentCode,
  answers: s.answers,
  uncertain: s.uncertain,
  scanned_at: s.scannedAt,
  scanned_by: s.scannedBy || null,
})

function sb(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

/** Throw on a Supabase error so callers can use try/catch. */
function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code })
  return res.data
}

/** Everything the signed-in user can see, except scans (loaded per exam). */
export async function fetchAll(userId: string): Promise<Partial<Database> & { me: User | null }> {
  const c = sb()
  const meRes = await c.from('profiles').select('*').eq('id', userId).maybeSingle()
  const me = meRes.data ? fromProfile(meRes.data as ProfileRow) : null
  if (!me || me.role === 'pending') return { me, users: me ? [me] : [] }

  const [profiles, classrooms, students, exams, settings, counts, allowed] = await Promise.all([
    c.from('profiles').select('*').order('name'),
    c.from('classrooms').select('id,name').order('name'),
    c.from('students').select('*').order('number'),
    c.from('exams').select('*').order('created_at', { ascending: false }),
    c.from('settings').select('school_name,id_digits').eq('id', 1).maybeSingle(),
    c.from('exam_scan_counts').select('exam_id,n'),
    me.role === 'admin' ? c.from('allowed_emails').select('email,name,role').order('email') : Promise.resolve({ data: [], error: null }),
  ])
  const s = check(settings) as SettingsRow | null
  return {
    me,
    users: (check(profiles) as ProfileRow[]).map(fromProfile),
    classrooms: check(classrooms) as Classroom[],
    students: (check(students) as StudentRow[]).map(fromStudent),
    exams: (check(exams) as ExamRow[]).map(fromExam),
    settings: s ? { schoolName: s.school_name, idDigits: s.id_digits } : undefined,
    scanCounts: Object.fromEntries((check(counts) as { exam_id: string; n: number }[]).map((r) => [r.exam_id, r.n])),
    allowedEmails: check(allowed) as AllowedEmail[],
  }
}

export async function fetchScans(examId: string): Promise<ScanRecord[]> {
  const rows = check(await sb().from('scans').select('*').eq('exam_id', examId)) as ScanRow[]
  return rows.map(fromScan)
}

/* ---- writes (each throws on failure) ---- */

export const api = {
  async updateSettings(s: Settings) {
    check(await sb().from('settings').update({ school_name: s.schoolName, id_digits: s.idDigits }).eq('id', 1))
  },
  async updateProfile(id: string, patch: Partial<Pick<User, 'name' | 'role'>>) {
    check(await sb().from('profiles').update(patch).eq('id', id))
  },
  async removeProfile(id: string) {
    check(await sb().from('profiles').delete().eq('id', id))
  },
  async upsertAllowedEmail(a: AllowedEmail) {
    check(await sb().from('allowed_emails').upsert(a))
  },
  async removeAllowedEmail(email: string) {
    check(await sb().from('allowed_emails').delete().eq('email', email))
  },
  async insertClassroom(c: Classroom) {
    check(await sb().from('classrooms').insert(c))
  },
  async renameClassroom(id: string, name: string) {
    check(await sb().from('classrooms').update({ name }).eq('id', id))
  },
  async removeClassroom(id: string) {
    check(await sb().from('classrooms').delete().eq('id', id))
  },
  async upsertStudents(rows: Student[]) {
    check(await sb().from('students').upsert(rows.map(toStudent), { onConflict: 'classroom_id,code' }))
  },
  async removeStudent(id: string) {
    check(await sb().from('students').delete().eq('id', id))
  },
  async insertExam(e: Exam) {
    check(await sb().from('exams').insert(toExam(e)))
  },
  async updateExam(e: Exam) {
    check(await sb().from('exams').update({ title: e.title, classroom_id: e.classroomId || null, key: e.key }).eq('id', e.id))
  },
  async removeExam(id: string) {
    check(await sb().from('exams').delete().eq('id', id))
  },
  /** One sheet per student per exam: a rescan replaces the earlier one. */
  async saveScan(s: ScanRecord) {
    const row = toScan(s)
    // a retried/edited sheet may already be stored under the same id
    check(await sb().from('scans').delete().eq('id', s.id))
    if (s.studentCode === null) check(await sb().from('scans').insert(row))
    else check(await sb().from('scans').upsert(row, { onConflict: 'exam_id,student_code' }))
  },
  async setScanStudent(s: ScanRecord, studentCode: string) {
    check(await sb().from('scans').delete().eq('exam_id', s.examId).eq('student_code', studentCode).neq('id', s.id))
    check(await sb().from('scans').update({ student_code: studentCode }).eq('id', s.id))
  },
  async removeScan(id: string) {
    check(await sb().from('scans').delete().eq('id', id))
  },
}

/** Errors with no Postgres/HTTP code are network failures worth retrying. */
export function isNetworkError(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return !e?.code && /fetch|network|load failed|timeout/i.test(e?.message ?? '')
}

export function thaiError(err: unknown): string {
  const e = err as { code?: string; message?: string }
  if (isNetworkError(err)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต'
  if (e?.code === '42501') return 'ไม่มีสิทธิ์ทำรายการนี้'
  if (e?.code === '23505') return 'ข้อมูลซ้ำกับที่มีอยู่แล้ว'
  if (e?.code === '42P01' || e?.code === 'PGRST205') return 'ยังไม่ได้สร้างตารางในฐานข้อมูล (รัน supabase/schema.sql)'
  return `บันทึกไม่สำเร็จ: ${e?.message ?? 'ไม่ทราบสาเหตุ'}`
}
