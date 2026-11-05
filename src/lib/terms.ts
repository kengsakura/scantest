/** Academic terms, class names and the year-end promotion plan. Pure functions. */

export interface TermLike {
  year: number
  semester: number
}

export interface RoomLike {
  grade: string
  room: string
}

export const termLabel = (t: TermLike) => `${t.semester}/${t.year}`

/** Thai school calendar: semester 1 May–October, semester 2 November–April (Buddhist year). */
export function currentThaiTerm(d = new Date()): TermLike {
  const m = d.getMonth() + 1
  const be = d.getFullYear() + 543
  if (m >= 5 && m <= 10) return { year: be, semester: 1 }
  return { year: m <= 4 ? be - 1 : be, semester: 2 }
}

export function compareTerms(a: TermLike, b: TermLike): number {
  return a.year - b.year || a.semester - b.semester
}

/** The term after `t`: 1 -> 2 in the same year, 2 (or 3) -> 1 of the next year. */
export function nextTerm(t: TermLike): TermLike {
  return t.semester === 1 ? { year: t.year, semester: 2 } : { year: t.year + 1, semester: 1 }
}

export const roomLabel = (c: RoomLike) => `${c.grade}/${c.room}`

function splitGrade(grade: string): { prefix: string; n: number } {
  const m = grade.trim().match(/^(.*?)(\d+)$/)
  return m ? { prefix: m[1], n: Number(m[2]) } : { prefix: grade.trim(), n: NaN }
}

/** Natural order: ป.1 < ป.2 < ... < ม.1 < ม.2, then room 1 < 2 < 10. */
export function compareRooms(a: RoomLike, b: RoomLike): number {
  const ga = splitGrade(a.grade)
  const gb = splitGrade(b.grade)
  return (
    ga.prefix.localeCompare(gb.prefix, 'th') ||
    (ga.n || 0) - (gb.n || 0) ||
    a.room.localeCompare(b.room, 'th', { numeric: true })
  )
}

/** 'ม.1' -> 'ม.2'; null when the grade has no number to increase. */
export function nextGrade(grade: string): string | null {
  const g = splitGrade(grade)
  return Number.isNaN(g.n) ? null : `${g.prefix}${g.n + 1}`
}

/** For each grade prefix (ป., ม., ...) the highest grade present: those classes graduate by default. */
export function finalGrades(rooms: RoomLike[]): Set<string> {
  const top = new Map<string, number>()
  for (const r of rooms) {
    const g = splitGrade(r.grade)
    if (!Number.isNaN(g.n)) top.set(g.prefix, Math.max(top.get(g.prefix) ?? 0, g.n))
  }
  return new Set([...top].map(([prefix, n]) => `${prefix}${n}`))
}

export type PromotionTarget = { kind: 'class'; grade: string; room: string } | { kind: 'graduate' } | { kind: 'skip' }

export interface PromotionRow {
  classroomId: string
  from: RoomLike
  students: number
  target: PromotionTarget
}

/** Default year-end plan: every class moves up one grade into the same room; the top grade graduates. */
export function suggestPromotion(classrooms: (RoomLike & { id: string })[], studentCount: (id: string) => number): PromotionRow[] {
  const top = finalGrades(classrooms)
  return [...classrooms].sort(compareRooms).map((c) => {
    const next = nextGrade(c.grade)
    const target: PromotionTarget = top.has(c.grade) || !next ? { kind: 'graduate' } : { kind: 'class', grade: next, room: c.room }
    return { classroomId: c.id, from: { grade: c.grade, room: c.room }, students: studentCount(c.id), target }
  })
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

export const NAME_PREFIXES = ['เด็กชาย', 'เด็กหญิง', 'ด.ช.', 'ด.ญ.', 'นางสาว', 'น.ส.', 'นาย', 'นาง']

/** "ด.ช. สมชาย ใจดี" -> { prefix: 'ด.ช.', firstName: 'สมชาย', lastName: 'ใจดี' } */
export function splitThaiName(full: string): { prefix: string; firstName: string; lastName: string } {
  let rest = full.trim().replace(/\s+/g, ' ')
  let prefix = ''
  for (const p of NAME_PREFIXES) {
    if (rest.startsWith(p)) {
      prefix = p
      rest = rest.slice(p.length).trim()
      break
    }
  }
  const [firstName = '', ...last] = rest.split(' ')
  return { prefix, firstName, lastName: last.join(' ') }
}

export function fullName(s: { prefix: string; firstName: string; lastName: string }): string {
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ')
  if (!s.prefix) return name
  // abbreviated prefixes are written next to the name, full words with a space
  return s.prefix.endsWith('.') ? `${s.prefix}${name}` : `${s.prefix} ${name}`
}
