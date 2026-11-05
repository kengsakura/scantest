import { useState } from 'react'
import { addClassroom, addStudents, removeClassroom, removeStudent, renameClassroom, studentsOf, useDB } from '../data/store'
import type { Student } from '../data/types'
import { go } from '../lib/router'

type Parsed = { rows: Omit<Student, 'id' | 'classroomId'>[]; errors: string[] }

/** Lines of "เลขที่ <tab> รหัส <tab> ชื่อ-สกุล" pasted from Excel (commas also work). */
function parseStudents(text: string, idDigits: number): Parsed {
  const rows: Parsed['rows'] = []
  const errors: string[] = []
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const parts = line.includes('\t') ? line.split('\t') : line.includes(',') ? line.split(',') : (line.match(/^(\S+)\s+(\S+)\s+(.+)$/)?.slice(1) ?? [])
      const [num, code, ...rest] = parts.map((p) => p.trim())
      const name = rest.join(' ').trim()
      if (!/^\d+$/.test(num ?? '')) {
        if (i === 0) return // header row
        errors.push(`บรรทัด ${i + 1}: เลขที่ไม่ใช่ตัวเลข`)
        return
      }
      if (!new RegExp(`^\\d{${idDigits}}$`).test(code ?? '')) {
        errors.push(`บรรทัด ${i + 1}: รหัส "${code ?? ''}" ต้องเป็นตัวเลข ${idDigits} หลัก`)
        return
      }
      if (!name) {
        errors.push(`บรรทัด ${i + 1}: ไม่มีชื่อ`)
        return
      }
      rows.push({ number: Number(num), code, name })
    })
  return { rows, errors }
}

export function AdminClassesPage({ selectedId }: { selectedId?: string }) {
  const db = useDB()
  const [newName, setNewName] = useState('')
  const selected = db.classrooms.find((c) => c.id === selectedId) ?? db.classrooms[0]

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>ห้องเรียนและนักเรียน</h1>
          <p className="muted">รหัสนักเรียน {db.settings.idDigits} หลัก (เปลี่ยนได้ที่หน้า ผู้ใช้ & ตั้งค่า)</p>
        </div>
      </div>
      <div className="split narrow-left">
        <div className="card">
          <ul className="room-list">
            {db.classrooms.map((c) => (
              <li key={c.id}>
                <button className={c.id === selected?.id ? 'on' : ''} onClick={() => go(`/classes/${c.id}`)}>
                  <span>{c.name}</span>
                  <small className="muted">{studentsOf(db, c.id).length} คน</small>
                </button>
              </li>
            ))}
          </ul>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!newName.trim()) return
              const c = addClassroom(newName.trim())
              setNewName('')
              go(`/classes/${c.id}`)
            }}
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อห้อง เช่น ม.3/1" />
            <button className="btn small" disabled={!newName.trim()}>
              เพิ่มห้อง
            </button>
          </form>
        </div>
        {selected ? <ClassroomDetail key={selected.id} id={selected.id} /> : <div className="card empty muted">ยังไม่มีห้องเรียน</div>}
      </div>
    </section>
  )
}

function ClassroomDetail({ id }: { id: string }) {
  const db = useDB()
  const room = db.classrooms.find((c) => c.id === id)!
  const students = studentsOf(db, id)
  const [name, setName] = useState(room.name)
  const [paste, setPaste] = useState('')
  const parsed = paste.trim() ? parseStudents(paste, db.settings.idDigits) : null
  const usedBy = db.exams.filter((e) => e.classroomId === id).length

  return (
    <div className="card">
      <div className="room-head">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && renameClassroom(id, name.trim())} aria-label="ชื่อห้อง" />
        <button
          className="btn ghost small danger"
          onClick={() => {
            const msg = usedBy ? `ห้องนี้มีข้อสอบ ${usedBy} ชุด ลบห้องและรายชื่อนักเรียนทั้งหมด?` : 'ลบห้องและรายชื่อนักเรียนทั้งหมด?'
            if (confirm(msg)) {
              removeClassroom(id)
              go('/classes')
            }
          }}
        >
          ลบห้อง
        </button>
      </div>

      <details className="paste-box" open={students.length === 0}>
        <summary>เพิ่ม/อัปเดตรายชื่อ (วางจาก Excel)</summary>
        <p className="hint">
          คัดลอก 3 คอลัมน์จาก Excel: <b>เลขที่ | รหัสนักเรียน | ชื่อ-สกุล</b> แล้ววางด้านล่าง ถ้ารหัสซ้ำกับคนเดิม ระบบจะอัปเดตข้อมูลให้
        </p>
        <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'1\t10001\tด.ช. ตัวอย่าง ใจดี\n2\t10002\tด.ญ. ตัวอย่าง รักเรียน'} />
        {parsed && (
          <div className="paste-result">
            <span>พร้อมเพิ่ม {parsed.rows.length} คน</span>
            {parsed.errors.length > 0 && <pre className="hint warn">{parsed.errors.slice(0, 8).join('\n')}</pre>}
            <button
              className="btn small"
              disabled={!parsed.rows.length}
              onClick={() => {
                addStudents(id, parsed.rows)
                setPaste('')
              }}
            >
              เพิ่ม {parsed.rows.length} คน
            </button>
          </div>
        )}
      </details>

      <table className="table">
        <thead>
          <tr>
            <th>เลขที่</th>
            <th>รหัส</th>
            <th>ชื่อ-สกุล</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id}>
              <td>{s.number}</td>
              <td>{s.code}</td>
              <td>{s.name}</td>
              <td className="num">
                <button className="btn ghost small danger" onClick={() => confirm(`ลบ ${s.name}?`) && removeStudent(s.id)}>
                  ลบ
                </button>
              </td>
            </tr>
          ))}
          {students.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                ยังไม่มีนักเรียน
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
