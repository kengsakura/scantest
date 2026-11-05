import { scansOf, setScanStudent, studentsOf, useDB, useNameImage } from '../data/store'
import type { Exam, ScanRecord } from '../data/types'

/** The picture of what the student wrote in the name/class area. Loaded only when shown. */
export function NameImage({ scan }: { scan: ScanRecord }) {
  const img = useNameImage(scan)
  if (img === null) return null
  if (img === undefined) return <div className="name-img loading" aria-label="กำลังโหลดภาพชื่อ" />
  return <img className="name-img" src={img} alt="ชื่อที่นักเรียนเขียน" />
}

/** Choose which student a scanned sheet belongs to. */
export function StudentPicker({ exam, scan, label = 'เลือกนักเรียน…' }: { exam: Exam; scan: ScanRecord; label?: string }) {
  const db = useDB()
  const students = studentsOf(db, exam.classroomId)
  const done = new Set(scansOf(db, exam.id).filter((s) => s.id !== scan.id).map((s) => s.studentCode))
  const current = students.find((s) => s.code === scan.studentCode)

  return (
    <select
      className="student-picker"
      value={current?.code ?? ''}
      onChange={(e) => {
        const code = e.target.value
        if (!code) return
        const st = students.find((s) => s.code === code)
        if (done.has(code) && !confirm(`${st?.name} มีผลสแกนแล้ว ต้องการแทนที่ด้วยแผ่นนี้?`)) return
        setScanStudent(scan.id, code)
      }}
      aria-label="เลือกนักเรียน"
    >
      <option value="">{label}</option>
      {students.map((s) => (
        <option key={s.id} value={s.code}>
          {s.number}. {s.name}
          {done.has(s.code) ? ' (มีผลแล้ว)' : ''}
        </option>
      ))}
    </select>
  )
}
