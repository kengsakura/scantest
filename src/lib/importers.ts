/**
 * Turn spreadsheet rows (from readSpreadsheet or a paste) into students / teacher accounts.
 * Columns are found by their header text, so the order in the file doesn't matter.
 */
import { splitThaiName } from './terms'

export interface StudentRow {
  number: number
  code: string
  prefix: string
  firstName: string
  lastName: string
  grade: string
  room: string
}

export interface TeacherRow {
  username: string
  password: string
  name: string
  role: 'admin' | 'teacher'
}

export interface ImportResult<T> {
  rows: T[]
  errors: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/[\s._\-()]/g, '')

function findColumns(header: string[], spec: Record<string, string[]>): Record<string, number> {
  const out: Record<string, number> = {}
  const used = new Set<number>()
  const h = header.map(norm)
  const claim = (key: string, i: number) => {
    if (i < 0) return
    out[key] = i
    used.add(i)
  }
  // pass 1: exact header names for every key; pass 2: headers that contain a known
  // name (e.g. "เลขประจำตัวนักเรียน"). A column is only ever claimed once.
  for (const [key, names] of Object.entries(spec)) {
    const wanted = names.map(norm)
    claim(key, h.findIndex((x, j) => !used.has(j) && wanted.includes(x)))
  }
  for (const [key, names] of Object.entries(spec)) {
    if (out[key] !== undefined) continue
    const wanted = names.map(norm)
    claim(key, h.findIndex((x, j) => !used.has(j) && x !== '' && wanted.some((w) => x.includes(w))))
  }
  return out
}

const STUDENT_COLUMNS: Record<string, string[]> = {
  code: ['เลขประจำตัว', 'เลขประจำตัวนักเรียน', 'รหัสนักเรียน', 'รหัส', 'code', 'studentid', 'id'],
  number: ['เลขที่', 'no', 'number'],
  prefix: ['คำนำหน้า', 'คำนำหน้าชื่อ', 'prefix', 'title'],
  fullName: ['ชื่อสกุล', 'ชื่อนามสกุล', 'ชื่อและนามสกุล', 'fullname', 'name'],
  lastName: ['นามสกุล', 'lastname', 'surname'],
  firstName: ['ชื่อ', 'firstname'],
  classroom: ['ชั้นห้อง', 'ชั้น/ห้อง', 'class'],
  grade: ['ชั้น', 'ระดับชั้น', 'grade', 'level'],
  room: ['ห้อง', 'room'],
}

/** Header row = the first row in the top 10 that names at least two known columns. */
function headerIndex(rows: string[][], spec: Record<string, string[]>): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) if (Object.keys(findColumns(rows[i], spec)).length >= 2) return i
  return -1
}

export function importStudents(rows: string[][], idDigits: number): ImportResult<StudentRow> {
  const hi = headerIndex(rows, STUDENT_COLUMNS)
  if (hi < 0) return { rows: [], errors: ['ไม่พบหัวตาราง ต้องมีคอลัมน์ เลขที่, เลขประจำตัว, ชื่อ, ชั้น, ห้อง'] }
  const col = findColumns(rows[hi], STUDENT_COLUMNS)
  // "ชื่อ" also matches inside "ชื่อ-สกุล": prefer the full-name column when there's no separate surname
  if (col.fullName !== undefined && col.lastName === undefined) delete col.firstName
  const missing = [
    col.code === undefined && 'เลขประจำตัว',
    col.firstName === undefined && col.fullName === undefined && 'ชื่อ',
    col.grade === undefined && col.classroom === undefined && 'ชั้น',
  ].filter(Boolean)
  if (missing.length) return { rows: [], errors: [`ไม่พบคอลัมน์: ${missing.join(', ')}`] }

  const out: StudentRow[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  rows.slice(hi + 1).forEach((r, i) => {
    const line = hi + i + 2
    const get = (k: string) => (col[k] !== undefined ? (r[col[k]] ?? '').trim() : '')
    let code = get('code').replace(/\s/g, '')
    if (!code && !get('firstName') && !get('fullName')) return // blank line
    if (/^\d+$/.test(code) && code.length < idDigits) code = code.padStart(idDigits, '0') // Excel drops leading zeros
    if (!new RegExp(`^\\d{${idDigits}}$`).test(code)) {
      errors.push(`แถว ${line}: เลขประจำตัว "${get('code')}" ต้องเป็นตัวเลข ${idDigits} หลัก`)
      return
    }
    if (seen.has(code)) {
      errors.push(`แถว ${line}: เลขประจำตัว ${code} ซ้ำในไฟล์`)
      return
    }
    let { prefix, firstName, lastName } = { prefix: get('prefix'), firstName: get('firstName'), lastName: get('lastName') }
    if (col.fullName !== undefined && !firstName) {
      const s = splitThaiName(get('fullName'))
      prefix ||= s.prefix
      firstName = s.firstName
      lastName ||= s.lastName
    }
    let grade = get('grade')
    let room = get('room')
    const combined = get('classroom') || (grade.includes('/') ? grade : '')
    if (combined) {
      const [g, rm] = combined.split('/')
      grade = g.trim()
      room ||= (rm ?? '').trim()
    }
    room ||= '1'
    if (!firstName || !grade) {
      errors.push(`แถว ${line}: ต้องมีชื่อและชั้น`)
      return
    }
    seen.add(code)
    out.push({ number: Number(get('number')) || 0, code, prefix, firstName, lastName, grade, room })
  })
  return { rows: out, errors }
}

const TEACHER_COLUMNS: Record<string, string[]> = {
  username: ['ชื่อผู้ใช้', 'username', 'user', 'login'],
  password: ['รหัสผ่าน', 'password', 'pass'],
  name: ['ชื่อสกุล', 'ชื่อนามสกุล', 'ชื่อ', 'name', 'fullname'],
  role: ['สิทธิ์', 'บทบาท', 'role'],
}

export function importTeachers(rows: string[][]): ImportResult<TeacherRow> {
  const hi = headerIndex(rows, TEACHER_COLUMNS)
  if (hi < 0) return { rows: [], errors: ['ไม่พบหัวตาราง ต้องมีคอลัมน์ ชื่อผู้ใช้, รหัสผ่าน, ชื่อ-สกุล'] }
  const col = findColumns(rows[hi], TEACHER_COLUMNS)
  if (col.username === undefined || col.password === undefined) return { rows: [], errors: ['ต้องมีคอลัมน์ ชื่อผู้ใช้ และ รหัสผ่าน'] }
  const out: TeacherRow[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  rows.slice(hi + 1).forEach((r, i) => {
    const line = hi + i + 2
    const get = (k: string) => (col[k] !== undefined ? (r[col[k]] ?? '').trim() : '')
    const username = get('username').toLowerCase()
    if (!username) return
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      errors.push(`แถว ${line}: ชื่อผู้ใช้ "${username}" ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3-40 ตัว`)
      return
    }
    if (seen.has(username)) {
      errors.push(`แถว ${line}: ชื่อผู้ใช้ ${username} ซ้ำในไฟล์`)
      return
    }
    const password = get('password')
    if (password.length < 6) {
      errors.push(`แถว ${line}: รหัสผ่านของ ${username} ต้องยาวอย่างน้อย 6 ตัว`)
      return
    }
    seen.add(username)
    const role = /admin|แอดมิน|ผู้ดูแล/i.test(get('role')) ? 'admin' : 'teacher'
    out.push({ username, password, name: get('name') || username, role })
  })
  return { rows: out, errors }
}

/** Example files offered for download on the import screens. */
export const STUDENT_TEMPLATE = [
  ['เลขที่', 'เลขประจำตัว', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชั้น', 'ห้อง'],
  [1, '1001', 'ด.ช.', 'สมชาย', 'ใจดี', 'ม.1', '1'],
  [2, '1002', 'ด.ญ.', 'สมหญิง', 'รักเรียน', 'ม.1', '1'],
]

export const TEACHER_TEMPLATE = [
  ['ชื่อผู้ใช้', 'รหัสผ่าน', 'ชื่อ-สกุล', 'สิทธิ์'],
  ['somchai', 'kru12345', 'นายสมชาย ใจดี', 'ครู'],
  ['admin2', 'admin12345', 'นางสาวสมศรี มั่นคง', 'แอดมิน'],
]
