import { useState } from 'react'
import {
  addClassroom,
  classroomsOf,
  importStudentRows,
  moveStudent,
  removeClassroom,
  removeFromClass,
  studentsOf,
  updateClassStudent,
  updateClassroom,
  useDB,
  useViewTerm,
} from '../../data/store'
import type { ClassStudent, Classroom } from '../../data/types'
import { importStudents, STUDENT_TEMPLATE, type ImportResult, type StudentRow } from '../../lib/importers'
import { go } from '../../lib/router'
import { roomLabel, termLabel } from '../../lib/terms'
import { buildXlsx, downloadBytes, parseCsv, readSpreadsheet, XLSX_TYPE } from '../../lib/xlsx'

export function ClassesTab({ selectedId }: { selectedId?: string }) {
  const db = useDB()
  const term = useViewTerm()
  const rooms = classroomsOf(db, term?.id)
  const selected = rooms.find((c) => c.id === selectedId) ?? rooms[0]
  const [grade, setGrade] = useState('')
  const [room, setRoom] = useState('')
  const [msg, setMsg] = useState('')
  const total = rooms.reduce((n, c) => n + studentsOf(db, c.id).length, 0)
  if (!term) return <div className="card empty muted">ยังไม่มีภาคเรียน ไปที่แท็บ ภาคเรียน & เลื่อนชั้น</div>

  return (
    <>
      <ImportStudents termId={term.id} termName={termLabel(term)} idDigits={db.settings.idDigits} />
      <div className="split narrow-left">
        <div className="card">
          <h2>ห้องเรียน {termLabel(term)}</h2>
          <p className="muted small">
            {rooms.length} ห้อง · นักเรียน {total} คน
          </p>
          <ul className="room-list">
            {rooms.map((c) => (
              <li key={c.id}>
                <button className={c.id === selected?.id ? 'on' : ''} onClick={() => go(`/admin/classes/${c.id}`)}>
                  <span>{roomLabel(c)}</span>
                  <small className="muted">{studentsOf(db, c.id).length} คน</small>
                </button>
              </li>
            ))}
          </ul>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!grade.trim()) return
              const res = addClassroom(term.id, grade.trim(), room.trim() || '1')
              if (typeof res === 'string') setMsg(res)
              else {
                setGrade('')
                setRoom('')
                setMsg('')
                go(`/admin/classes/${res.id}`)
              }
            }}
          >
            <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="ชั้น เช่น ม.1" aria-label="ชั้น" />
            <input className="short" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="ห้อง" aria-label="ห้อง" />
            <button className="btn small" disabled={!grade.trim()}>
              เพิ่ม
            </button>
          </form>
          {msg && <p className="hint warn">{msg}</p>}
        </div>
        {selected ? <ClassroomDetail key={selected.id} classroom={selected} rooms={rooms} /> : <div className="card empty muted">ยังไม่มีห้องเรียน นำเข้ารายชื่อนักเรียนด้านบนได้เลย</div>}
      </div>
    </>
  )
}

function ImportStudents({ termId, termName, idDigits }: { termId: string; termName: string; idDigits: number }) {
  const [parsed, setParsed] = useState<ImportResult<StudentRow> | null>(null)
  const [fileName, setFileName] = useState('')
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async (file: File) => {
    setFileName(file.name)
    setMsg('')
    try {
      setParsed(importStudents(readSpreadsheet(new Uint8Array(await file.arrayBuffer())), idDigits))
    } catch {
      setParsed({ rows: [], errors: ['อ่านไฟล์ไม่ได้ ใช้ไฟล์ .xlsx หรือ .csv'] })
    }
  }

  const save = async () => {
    if (!parsed?.rows.length) return
    setBusy(true)
    const err = await importStudentRows(termId, parsed.rows)
    setBusy(false)
    if (err) setMsg(err)
    else {
      setMsg(`นำเข้า ${parsed.rows.length} คนแล้ว`)
      setParsed(null)
      setPaste('')
      setFileName('')
    }
  }

  const classes = parsed ? new Set(parsed.rows.map((r) => `${r.grade}/${r.room}`)) : new Set<string>()

  return (
    <details className="card import-box" open={!!parsed}>
      <summary>นำเข้านักเรียนจากไฟล์ Excel / CSV (ภาคเรียน {termName})</summary>
      <p className="hint">
        คอลัมน์: <b>เลขที่ · เลขประจำตัว · คำนำหน้า · ชื่อ · นามสกุล · ชั้น · ห้อง</b> (มีหัวตาราง เรียงคอลัมน์อย่างไรก็ได้) ระบบสร้างห้องให้อัตโนมัติ
        ถ้าเลขประจำตัวมีอยู่แล้วจะอัปเดตข้อมูลและย้ายห้องให้ นักเรียนเพิ่มครั้งเดียว ปีต่อไปใช้การเลื่อนชั้น
      </p>
      <div className="inline-fields">
        <label className="btn secondary small">
          เลือกไฟล์…
          <input type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        <button className="btn ghost small" onClick={() => downloadBytes(buildXlsx([{ name: 'นักเรียน', rows: STUDENT_TEMPLATE, boldRows: [0], colWidths: [8, 12, 10, 16, 16, 8, 8] }]), 'แบบฟอร์มนำเข้านักเรียน.xlsx', XLSX_TYPE)}>
          ดาวน์โหลดแบบฟอร์ม
        </button>
        {fileName && <span className="muted small">{fileName}</span>}
      </div>
      <textarea
        rows={3}
        value={paste}
        placeholder="หรือคัดลอกจาก Excel (รวมหัวตาราง) แล้ววางที่นี่"
        onChange={(e) => {
          setPaste(e.target.value)
          setFileName('')
          setParsed(e.target.value.trim() ? importStudents(parseCsv(e.target.value), idDigits) : null)
        }}
      />
      {parsed && (
        <div className="paste-result">
          <strong>
            พร้อมนำเข้า {parsed.rows.length} คน ใน {classes.size} ห้อง
          </strong>
          <button className="btn small" disabled={!parsed.rows.length || busy} onClick={save}>
            {busy ? 'กำลังนำเข้า…' : 'ยืนยันนำเข้า'}
          </button>
          {parsed.errors.length > 0 && <pre className="hint warn">{parsed.errors.slice(0, 10).join('\n') + (parsed.errors.length > 10 ? `\n… อีก ${parsed.errors.length - 10} แถว` : '')}</pre>}
          {parsed.rows.length > 0 && (
            <div className="table-card preview-table">
              <table className="table">
                <thead>
                  <tr>
                    <th>ชั้น/ห้อง</th>
                    <th>เลขที่</th>
                    <th>เลขประจำตัว</th>
                    <th>ชื่อ-สกุล</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 8).map((r) => (
                    <tr key={r.code}>
                      <td>
                        {r.grade}/{r.room}
                      </td>
                      <td>{r.number}</td>
                      <td>{r.code}</td>
                      <td>
                        {r.prefix}
                        {r.firstName} {r.lastName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 8 && <p className="hint">… และอีก {parsed.rows.length - 8} คน</p>}
            </div>
          )}
        </div>
      )}
      {msg && <p className="notice">{msg}</p>}
    </details>
  )
}

function ClassroomDetail({ classroom, rooms }: { classroom: Classroom; rooms: Classroom[] }) {
  const db = useDB()
  const students = studentsOf(db, classroom.id)
  const [grade, setGrade] = useState(classroom.grade)
  const [room, setRoom] = useState(classroom.room)
  const [editing, setEditing] = useState<string | null>(null)
  const used = db.exams.filter((e) => e.classroomId === classroom.id).length

  return (
    <div className="card">
      <div className="room-head">
        <input
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          onBlur={() => grade.trim() && updateClassroom({ ...classroom, grade: grade.trim() })}
          aria-label="ชั้น"
        />
        <span className="slash">/</span>
        <input className="short" value={room} onChange={(e) => setRoom(e.target.value)} onBlur={() => room.trim() && updateClassroom({ ...classroom, room: room.trim() })} aria-label="ห้อง" />
        <button
          className="btn ghost small danger"
          onClick={() => {
            const msg = used ? `ห้องนี้มีข้อสอบ ${used} ชุด ลบห้องนี้ออกจากภาคเรียน?` : `ลบห้อง ${roomLabel(classroom)} ออกจากภาคเรียนนี้? (ข้อมูลนักเรียนไม่ถูกลบ)`
            if (confirm(msg)) {
              removeClassroom(classroom.id)
              go('/admin/classes')
            }
          }}
        >
          ลบห้อง
        </button>
      </div>
      <div className="table-card">
        <table className="table">
          <thead>
            <tr>
              <th>เลขที่</th>
              <th>เลขประจำตัว</th>
              <th>ชื่อ-สกุล</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {students.map((s) =>
              editing === s.enrollmentId ? (
                <EditRow key={s.enrollmentId} s={s} rooms={rooms} done={() => setEditing(null)} />
              ) : (
                <tr key={s.enrollmentId}>
                  <td>{s.number || '–'}</td>
                  <td>{s.code}</td>
                  <td>{s.name}</td>
                  <td className="num">
                    <button className="btn ghost small" onClick={() => setEditing(s.enrollmentId)}>
                      แก้ไข
                    </button>
                  </td>
                </tr>
              ),
            )}
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
    </div>
  )
}

function EditRow({ s, rooms, done }: { s: ClassStudent; rooms: Classroom[]; done: () => void }) {
  const [f, setF] = useState({ number: String(s.number), code: s.code, prefix: s.prefix, firstName: s.firstName, lastName: s.lastName })
  const [to, setTo] = useState(s.classroomId)
  const save = () => {
    updateClassStudent(s, { number: Number(f.number) || 0, code: f.code.trim(), prefix: f.prefix.trim(), firstName: f.firstName.trim(), lastName: f.lastName.trim() })
    if (to !== s.classroomId) moveStudent(s.enrollmentId, to)
    done()
  }
  return (
    <tr className="detail">
      <td colSpan={4}>
        <div className="edit-student">
          <input className="short" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} aria-label="เลขที่" placeholder="เลขที่" />
          <input className="mid" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-label="เลขประจำตัว" />
          <input className="mid" value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} aria-label="คำนำหน้า" placeholder="คำนำหน้า" />
          <input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} aria-label="ชื่อ" placeholder="ชื่อ" />
          <input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} aria-label="นามสกุล" placeholder="นามสกุล" />
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="ย้ายห้อง">
            {rooms.map((c) => (
              <option key={c.id} value={c.id}>
                {roomLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="detail-actions">
          <button className="btn small" onClick={save}>
            บันทึก
          </button>
          <button className="btn secondary small" onClick={done}>
            ยกเลิก
          </button>
          <span className="grow" />
          <button
            className="btn ghost small danger"
            onClick={() => {
              if (confirm(`นำ ${s.name} ออกจากห้องนี้ (ย้ายโรงเรียน/ลาออก)? ผลสอบเดิมยังอยู่`)) {
                removeFromClass(s.enrollmentId, 'left')
                done()
              }
            }}
          >
            ย้ายออก/ลาออก
          </button>
        </div>
      </td>
    </tr>
  )
}
