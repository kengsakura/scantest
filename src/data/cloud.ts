/**
 * Supabase adapter: client, row <-> app type mapping and queries.
 * Active when VITE_SUPABASE_URL and VITE_SUPABASE_KEY are set at build time;
 * otherwise the app runs in local demo mode.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { LabelStyle } from '../omr/config'
import type { AnswerKey } from '../omr/grading'
import type { Classroom, Enrollment, Exam, Role, ScanRecord, Settings, SheetPreset, SheetType, Student, StudentStatus, Term, User } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null

export const CLOUD = supabase !== null

/** Admin-made accounts sign in with a username; Supabase needs an e-mail, so add a fixed domain. */
export function loginEmail(username: string): string {
  const u = username.trim().toLowerCase()
  return u.includes('@') ? u : `${u}@scantest.local`
}

/* ---- rows ---- */

interface ProfileRow {
  id: string
  email: string
  name: string
  role: Role
  username: string | null
}
interface TermRow {
  id: string
  year: number
  semester: number
}
interface ClassroomRow {
  id: string
  term_id: string
  grade: string
  room: string
}
interface StudentRow {
  id: string
  code: string
  prefix: string
  first_name: string
  last_name: string
  status: StudentStatus
}
interface EnrollmentRow {
  id: string
  term_id: string
  classroom_id: string
  student_id: string
  number: number
}
interface PresetRow {
  id: string
  name: string
  questions: number
  choices: number
  label_style: LabelStyle
  use_student_id: boolean
  default_points: number
  sort: number
}
interface ExamRow {
  id: string
  code: string
  title: string
  term_id: string | null
  classroom_id: string | null
  owner_id: string
  created_at: string
  sheet: SheetType
  id_digits: number
  preset_id: string | null
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
  name_image?: string | null
}
interface SettingsRow {
  school_name: string
  id_digits: number
  current_term_id: string | null
  logo: string | null
  sheet_header: string | null
}

const fromProfile = (r: ProfileRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role, username: r.username ?? null })
const fromClassroom = (r: ClassroomRow): Classroom => ({ id: r.id, termId: r.term_id, grade: r.grade, room: r.room })
const toClassroom = (c: Classroom): ClassroomRow => ({ id: c.id, term_id: c.termId, grade: c.grade, room: c.room })
const fromStudent = (r: StudentRow): Student => ({
  id: r.id,
  code: r.code,
  prefix: r.prefix,
  firstName: r.first_name,
  lastName: r.last_name,
  status: r.status,
})
const fromEnrollment = (r: EnrollmentRow): Enrollment => ({
  id: r.id,
  termId: r.term_id,
  classroomId: r.classroom_id,
  studentId: r.student_id,
  number: r.number,
})
const fromPreset = (r: PresetRow): SheetPreset => ({
  id: r.id,
  name: r.name,
  questions: r.questions,
  choices: r.choices,
  labelStyle: r.label_style,
  useStudentId: r.use_student_id,
  defaultPoints: Number(r.default_points),
  sort: r.sort,
})
const toPreset = (p: SheetPreset): PresetRow => ({
  id: p.id,
  name: p.name,
  questions: p.questions,
  choices: p.choices,
  label_style: p.labelStyle,
  use_student_id: p.useStudentId,
  default_points: p.defaultPoints,
  sort: p.sort,
})
const fromExam = (r: ExamRow): Exam => ({
  id: r.id,
  code: r.code,
  title: r.title,
  termId: r.term_id ?? '',
  classroomId: r.classroom_id ?? '',
  ownerId: r.owner_id,
  createdAt: r.created_at,
  sheet: r.sheet,
  idDigits: r.id_digits,
  presetId: r.preset_id,
  key: r.key,
})
const toExam = (e: Exam): ExamRow => ({
  id: e.id,
  code: e.code,
  title: e.title,
  term_id: e.termId || null,
  classroom_id: e.classroomId || null,
  owner_id: e.ownerId,
  created_at: e.createdAt,
  sheet: e.sheet,
  id_digits: e.idDigits,
  preset_id: e.presetId,
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
  // undefined = not loaded yet (list queries skip it), null = no picture
  nameImage: r.name_image === undefined ? undefined : r.name_image,
})
const toScan = (s: ScanRecord): ScanRow => ({
  id: s.id,
  exam_id: s.examId,
  student_code: s.studentCode,
  answers: s.answers,
  uncertain: s.uncertain,
  scanned_at: s.scannedAt,
  scanned_by: s.scannedBy || null,
  name_image: s.nameImage ?? null,
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

const PAGE = 1000 // Supabase's default cap on rows per request

/**
 * Fetch every row of a query, a page at a time. `make` must build the query with a
 * stable order (ending in a unique column) so pages don't overlap or skip rows.
 */
export async function selectAll<T>(
  make: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> },
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const rows = check(await make().range(from, from + PAGE - 1)) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export interface CloudSnapshot {
  me: User | null
  users?: User[]
  terms?: Term[]
  settings?: Settings
  presets?: SheetPreset[]
  /** The term the data below belongs to */
  termId?: string | null
  classrooms?: Classroom[]
  enrollments?: Enrollment[]
  students?: Student[]
  exams?: Exam[]
  scanCounts?: Record<string, number>
}

/**
 * What the signed-in user needs for one term (default: the school's current term):
 * that term's classes, students and exams, plus shared reference data. Scans are
 * loaded per exam when a page needs them.
 */
export async function fetchAll(userId: string, wantedTermId: string | null): Promise<CloudSnapshot> {
  const c = sb()
  const meRes = await c.from('profiles').select('*').eq('id', userId).maybeSingle()
  const me = meRes.data ? fromProfile(meRes.data as ProfileRow) : null
  if (!me || me.role === 'pending') return { me, users: me ? [me] : [] }

  const [profiles, terms, settingsRes, presets] = await Promise.all([
    selectAll<ProfileRow>(() => c.from('profiles').select('*').order('name').order('id')),
    selectAll<TermRow>(() => c.from('terms').select('id,year,semester').order('year').order('semester')),
    c.from('settings').select('school_name,id_digits,current_term_id,logo,sheet_header').eq('id', 1).maybeSingle(),
    selectAll<PresetRow>(() => c.from('sheet_presets').select('*').order('sort').order('id')),
  ])
  const s = check(settingsRes) as SettingsRow | null
  const settings: Settings = {
    schoolName: s?.school_name ?? 'โรงเรียนของฉัน',
    idDigits: s?.id_digits ?? 4,
    currentTermId: s?.current_term_id ?? null,
    logo: s?.logo ?? null,
    sheetHeader: s?.sheet_header ?? '',
  }
  const termId = [wantedTermId, settings.currentTermId, terms.at(-1)?.id].find((id) => id && terms.some((t) => t.id === id)) ?? null

  const [classrooms, enrollments, exams] = termId
    ? await Promise.all([
        selectAll<ClassroomRow>(() => c.from('classrooms').select('id,term_id,grade,room').eq('term_id', termId).order('id')),
        selectAll<EnrollmentRow & { student: StudentRow }>(() =>
          c
            .from('enrollments')
            .select('id,term_id,classroom_id,student_id,number,student:students(id,code,prefix,first_name,last_name,status)')
            .eq('term_id', termId)
            .order('id'),
        ),
        selectAll<ExamRow>(() => c.from('exams').select('*').eq('term_id', termId).order('created_at', { ascending: false }).order('id')),
      ])
    : [[], [], []]

  const counts: { exam_id: string; n: number }[] = []
  for (const ids of chunks(exams.map((e) => e.id), 150))
    counts.push(...(check(await c.from('exam_scan_counts').select('exam_id,n').in('exam_id', ids)) as { exam_id: string; n: number }[]))

  return {
    me,
    users: profiles.map(fromProfile),
    terms,
    settings,
    presets: presets.map(fromPreset),
    termId,
    classrooms: classrooms.map(fromClassroom),
    enrollments: enrollments.map(fromEnrollment),
    students: enrollments.map((e) => fromStudent(e.student)),
    exams: exams.map(fromExam),
    scanCounts: Object.fromEntries(counts.map((r) => [r.exam_id, r.n])),
  }
}

// name pictures are left out of list queries and fetched only when someone looks at one
const SCAN_COLUMNS = 'id,exam_id,student_code,answers,uncertain,scanned_at,scanned_by'

export async function fetchScans(examId: string): Promise<ScanRecord[]> {
  const rows = await selectAll<ScanRow>(() => sb().from('scans').select(SCAN_COLUMNS).eq('exam_id', examId).order('id'))
  return rows.map(fromScan)
}

/** Name pictures for several scans in one request. */
export async function fetchNameImages(scanIds: string[]): Promise<Map<string, string | null>> {
  const rows = check(await sb().from('scans').select('id,name_image').in('id', scanIds)) as { id: string; name_image: string | null }[]
  return new Map(rows.map((r) => [r.id, r.name_image]))
}

/* ---- writes (each throws on failure) ---- */

export interface NewStudent {
  code: string
  prefix: string
  firstName: string
  lastName: string
}

export const api = {
  async updateSettings(s: Settings) {
    check(
      await sb()
        .from('settings')
        .update({
          school_name: s.schoolName,
          id_digits: s.idDigits,
          current_term_id: s.currentTermId,
          logo: s.logo,
          sheet_header: s.sheetHeader,
        })
        .eq('id', 1),
    )
  },

  /* users */
  async createUser(username: string, password: string, name: string, role: Role): Promise<string> {
    return check(await sb().rpc('admin_create_user', { p_username: username, p_password: password, p_name: name, p_role: role })) as string
  },
  async setPassword(userId: string, password: string) {
    check(await sb().rpc('admin_set_password', { p_user: userId, p_password: password }))
  },
  async deleteUser(userId: string) {
    check(await sb().rpc('admin_delete_user', { p_user: userId }))
  },
  async updateProfile(id: string, patch: { name?: string; role?: Role }) {
    check(await sb().from('profiles').update(patch).eq('id', id))
  },

  /* terms, classes, students */
  async insertTerm(t: Term) {
    check(await sb().from('terms').insert(t))
  },
  async removeTerm(id: string) {
    check(await sb().from('terms').delete().eq('id', id))
  },
  async insertClassrooms(rows: Classroom[]) {
    for (const part of chunks(rows, 500)) check(await sb().from('classrooms').insert(part.map(toClassroom)))
  },
  async updateClassroom(c: Classroom) {
    check(await sb().from('classrooms').update({ grade: c.grade, room: c.room }).eq('id', c.id))
  },
  async removeClassroom(id: string) {
    check(await sb().from('classrooms').delete().eq('id', id))
  },
  /** Insert or update students by เลขประจำตัว; returns the id of each code (existing ids are kept). */
  async upsertStudents(rows: NewStudent[]): Promise<Map<string, string>> {
    const ids = new Map<string, string>()
    for (const part of chunks(rows, 500)) {
      const payload = part.map((s) => ({ code: s.code, prefix: s.prefix, first_name: s.firstName, last_name: s.lastName, status: 'active' }))
      const saved = check(await sb().from('students').upsert(payload, { onConflict: 'code' }).select('id,code')) as { id: string; code: string }[]
      saved.forEach((r) => ids.set(r.code, r.id))
    }
    return ids
  },
  async updateStudent(s: Student) {
    check(
      await sb()
        .from('students')
        .update({ code: s.code, prefix: s.prefix, first_name: s.firstName, last_name: s.lastName, status: s.status })
        .eq('id', s.id),
    )
  },
  /** Put students in a class for a term (moving them if they were in another class that term). */
  async upsertEnrollments(rows: Omit<Enrollment, 'id'>[]) {
    for (const part of chunks(rows, 500)) {
      const payload = part.map((e) => ({ term_id: e.termId, classroom_id: e.classroomId, student_id: e.studentId, number: e.number }))
      check(await sb().from('enrollments').upsert(payload, { onConflict: 'term_id,student_id' }))
    }
  },
  async updateEnrollment(e: Enrollment) {
    check(await sb().from('enrollments').update({ classroom_id: e.classroomId, number: e.number }).eq('id', e.id))
  },
  async removeEnrollment(id: string) {
    check(await sb().from('enrollments').delete().eq('id', id))
  },
  async setStudentsStatus(ids: string[], status: StudentStatus) {
    for (const part of chunks(ids, 300)) check(await sb().from('students').update({ status }).in('id', part))
  },
  /** Classes and enrollments of another term (for copying / promoting into a new term). */
  async fetchTermRoster(termId: string): Promise<{ classrooms: Classroom[]; enrollments: Enrollment[] }> {
    const [classrooms, enrollments] = await Promise.all([
      selectAll<ClassroomRow>(() => sb().from('classrooms').select('id,term_id,grade,room').eq('term_id', termId).order('id')),
      selectAll<EnrollmentRow>(() => sb().from('enrollments').select('id,term_id,classroom_id,student_id,number').eq('term_id', termId).order('id')),
    ])
    return { classrooms: classrooms.map(fromClassroom), enrollments: enrollments.map(fromEnrollment) }
  },

  /* presets */
  async upsertPreset(p: SheetPreset) {
    check(await sb().from('sheet_presets').upsert(toPreset(p)))
  },
  async removePreset(id: string) {
    check(await sb().from('sheet_presets').delete().eq('id', id))
  },

  /* exams */
  async insertExam(e: Exam) {
    check(await sb().from('exams').insert(toExam(e)))
  },
  async updateExam(e: Exam) {
    check(await sb().from('exams').update({ title: e.title, classroom_id: e.classroomId || null, key: e.key }).eq('id', e.id))
  },
  async removeExam(id: string) {
    check(await sb().from('exams').delete().eq('id', id))
  },

  /* scans */
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
  async updateScanAnswers(id: string, answers: number[][]) {
    check(await sb().from('scans').update({ answers, uncertain: [] }).eq('id', id))
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
  // our database functions raise their own Thai messages
  if (/[฀-๿]/.test(e?.message ?? '')) return e.message!
  if (e?.code === '42501') return 'ไม่มีสิทธิ์ทำรายการนี้'
  if (e?.code === '23505') return 'ข้อมูลซ้ำกับที่มีอยู่แล้ว'
  if (e?.code === '23503') return 'ลบไม่ได้ เพราะยังมีข้อมูลอื่นใช้อยู่'
  if (e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === 'PGRST202' || e?.code === '42703')
    return 'ฐานข้อมูลยังเป็นเวอร์ชันเก่า ให้รัน supabase/schema.sql ล่าสุดใน Supabase'
  return `บันทึกไม่สำเร็จ: ${e?.message ?? 'ไม่ทราบสาเหตุ'}`
}
