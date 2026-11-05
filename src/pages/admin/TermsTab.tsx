import { useMemo, useState } from 'react'
import { classroomsOf, createTerm, deleteTerm, setCurrentTerm, setViewTerm, studentsOf, useDB, useViewTerm, type NewTermPlan } from '../../data/store'
import { compareTerms, nextTerm, roomLabel, suggestPromotion, termLabel, type PromotionRow } from '../../lib/terms'

type Mode = NewTermPlan['mode']

export function TermsTab() {
  const db = useDB()
  const view = useViewTerm()
  const terms = [...db.terms].sort(compareTerms).reverse()
  const current = db.terms.find((t) => t.id === db.settings.currentTermId) ?? null
  const [msg, setMsg] = useState('')

  return (
    <div className="admin-grid">
      <div className="card">
        <h2>ภาคเรียนทั้งหมด</h2>
        <p className="hint">ครูทุกคนทำงานกับภาคเรียนปัจจุบัน ส่วนภาคเรียนเก่าเปิดดูย้อนหลังได้จากตัวเลือกภาคเรียนด้านบน</p>
        <ul className="plain-list">
          {terms.map((t) => (
            <li key={t.id}>
              <span>
                <strong>ภาคเรียน {termLabel(t)}</strong>
                {t.id === current?.id && <span className="badge ok">ปัจจุบัน</span>}
                {t.id === view?.id && <span className="badge">กำลังดู</span>}
              </span>
              <span className="head-actions">
                {t.id !== view?.id && (
                  <button className="btn ghost small" onClick={() => setViewTerm(t.id)}>
                    ดูข้อมูล
                  </button>
                )}
                {t.id !== current?.id && (
                  <button className="btn secondary small" onClick={() => confirm(`ตั้ง ${termLabel(t)} เป็นภาคเรียนปัจจุบัน?`) && setCurrentTerm(t.id)}>
                    ตั้งเป็นปัจจุบัน
                  </button>
                )}
                {t.id !== current?.id && (
                  <button
                    className="btn ghost small danger"
                    onClick={async () => {
                      if (!confirm(`ลบภาคเรียน ${termLabel(t)} พร้อมห้องเรียนในเทอมนั้น? (ข้อมูลนักเรียนไม่ถูกลบ)`)) return
                      setMsg((await deleteTerm(t.id)) ?? `ลบภาคเรียน ${termLabel(t)} แล้ว`)
                    }}
                  >
                    ลบ
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {msg && <p className="hint">{msg}</p>}
      </div>
      <NewTerm key={view?.id} />
    </div>
  )
}

function NewTerm() {
  const db = useDB()
  const source = useViewTerm()
  const suggested = source ? nextTerm(source) : { year: new Date().getFullYear() + 543, semester: 1 }
  const [year, setYear] = useState(suggested.year)
  const [semester, setSemester] = useState(suggested.semester)
  const newYear = !!source && year > source.year
  const [mode, setMode] = useState<Mode>(source ? (newYear ? 'promote' : 'copy') : 'empty')
  const rooms = classroomsOf(db, source?.id)
  const initial = useMemo(() => suggestPromotion(rooms, (id) => studentsOf(db, id).length), [rooms, db])
  const [rows, setRows] = useState<PromotionRow[]>(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const exists = db.terms.some((t) => t.year === year && t.semester === semester)
  const students = rooms.reduce((n, c) => n + studentsOf(db, c.id).length, 0)
  const graduating = rows.filter((r) => r.target.kind === 'graduate').reduce((n, r) => n + r.students, 0)

  const setTarget = (i: number, target: PromotionRow['target']) => setRows(rows.map((r, k) => (k === i ? { ...r, target } : r)))

  const submit = async () => {
    const plan: NewTermPlan = mode === 'empty' || !source ? { mode: 'empty' } : mode === 'copy' ? { mode: 'copy', fromTermId: source.id } : { mode: 'promote', fromTermId: source.id, rows }
    const what = mode === 'promote' ? `เลื่อนชั้นนักเรียน ${students - graduating} คน และจบการศึกษา ${graduating} คน` : mode === 'copy' ? `คัดลอกห้องเรียนและนักเรียน ${students} คน` : 'เริ่มแบบว่าง'
    if (!confirm(`เปิดภาคเรียน ${semester}/${year} (${what}) และตั้งเป็นภาคเรียนปัจจุบัน?`)) return
    setBusy(true)
    const err = await createTerm({ year, semester }, plan)
    setBusy(false)
    setMsg(err ?? `เปิดภาคเรียน ${semester}/${year} แล้ว`)
  }

  return (
    <div className="card form">
      <h2>เปิดภาคเรียนใหม่</h2>
      <div className="inline-fields">
        <label className="inline">
          ภาคเรียน
          <select value={semester} onChange={(e) => setSemester(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3 (ฤดูร้อน)</option>
          </select>
        </label>
        <label className="inline">
          ปีการศึกษา
          <input type="number" value={year} min={2500} max={2700} onChange={(e) => setYear(Number(e.target.value))} />
        </label>
      </div>
      {exists && <p className="hint warn">ภาคเรียน {semester}/{year} มีอยู่แล้ว</p>}

      <fieldset>
        <legend>ห้องเรียนและนักเรียน{source && ` (จากภาคเรียน ${termLabel(source)} ที่กำลังดู)`}</legend>
        <div className="chips">
          <button type="button" className={`chip ${mode === 'copy' ? 'on' : ''}`} onClick={() => setMode('copy')} disabled={!source}>
            ภาคเรียนถัดไป: ห้องเดิม นักเรียนเดิม
          </button>
          <button type="button" className={`chip ${mode === 'promote' ? 'on' : ''}`} onClick={() => setMode('promote')} disabled={!source}>
            ขึ้นปีการศึกษาใหม่: เลื่อนชั้น
          </button>
          <button type="button" className={`chip ${mode === 'empty' ? 'on' : ''}`} onClick={() => setMode('empty')}>
            เริ่มว่าง (นำเข้าใหม่)
          </button>
        </div>
      </fieldset>

      {mode === 'promote' && (
        <div className="table-card">
          <p className="hint">ค่าเริ่มต้น: ทุกห้องขึ้นชั้นถัดไปห้องเดิม ชั้นสูงสุดจบการศึกษา แก้ห้องปลายทางได้ก่อนยืนยัน เลขที่คงเดิม</p>
          <table className="table">
            <thead>
              <tr>
                <th>ห้องเดิม</th>
                <th className="num">นักเรียน</th>
                <th>ไปที่</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.classroomId}>
                  <td>{roomLabel(r.from)}</td>
                  <td className="num">{r.students}</td>
                  <td>
                    <div className="inline-fields">
                      <select
                        value={r.target.kind}
                        onChange={(e) => {
                          const kind = e.target.value
                          if (kind === 'class') setTarget(i, { kind: 'class', grade: r.from.grade, room: r.from.room })
                          else setTarget(i, { kind: kind as 'graduate' | 'skip' })
                        }}
                      >
                        <option value="class">เลื่อนไปห้อง</option>
                        <option value="graduate">จบการศึกษา</option>
                        <option value="skip">ไม่ย้าย (จัดเองทีหลัง)</option>
                      </select>
                      {r.target.kind === 'class' && (
                        <>
                          <input
                            className="short"
                            value={r.target.grade}
                            onChange={(e) => r.target.kind === 'class' && setTarget(i, { ...r.target, grade: e.target.value })}
                            aria-label="ชั้นปลายทาง"
                          />
                          /
                          <input
                            className="short"
                            value={r.target.room}
                            onChange={(e) => r.target.kind === 'class' && setTarget(i, { ...r.target, room: e.target.value })}
                            aria-label="ห้องปลายทาง"
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">นักเรียนใหม่ (เช่น ม.1 หรือ ม.4 ที่เข้าใหม่) นำเข้าเพิ่มได้ที่แท็บ ห้องเรียน & นักเรียน หลังเปิดภาคเรียนแล้ว</p>
        </div>
      )}

      <button className="btn" onClick={submit} disabled={busy || exists || !year}>
        {busy ? 'กำลังเปิดภาคเรียน…' : `เปิดภาคเรียน ${semester}/${year}`}
      </button>
      {msg && <p className="hint">{msg}</p>}
    </div>
  )
}
