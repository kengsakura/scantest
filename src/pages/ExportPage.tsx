import { useMemo, useState } from 'react'
import { scansOf, studentsOf, useDB, useExamScans } from '../data/store'
import { examRoomLabel, formatScore } from '../lib/exam'
import { buildScoreTable, scoreSheets, toTsv, totalsText, type ExportOptions } from '../lib/scoreExport'
import { termLabel } from '../lib/terms'
import { buildXlsx, downloadBytes, safeFilename, XLSX_TYPE, type Cell } from '../lib/xlsx'
import { choiceLabels } from '../omr/config'

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // older browsers / http: fall back to a hidden textarea
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

const show = (c: Cell) => (typeof c === 'number' ? formatScore(c) : (c ?? ''))

export function ExportPage({ examId }: { examId: string }) {
  const db = useDB()
  useExamScans(examId)
  const exam = db.exams.find((e) => e.id === examId)
  const [opts, setOpts] = useState<ExportOptions>({ mode: 'simple', convertTo: null, decimals: 2 })
  const [convertInput, setConvertInput] = useState('')
  const [copied, setCopied] = useState('')

  const students = useMemo(() => (exam ? studentsOf(db, exam.classroomId) : []), [db, exam])
  const scans = useMemo(() => (exam ? scansOf(db, exam.id) : []), [db, exam])
  const labels = exam ? choiceLabels(exam.sheet) : []
  const table = useMemo(
    () => (exam ? buildScoreTable(students, scans, exam.key, labels, opts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, scans, exam, opts],
  )
  if (!exam || !table) return <p>ไม่พบข้อสอบ</p>

  const term = db.terms.find((t) => t.id === exam.termId)
  const room = examRoomLabel(db, exam)
  const unmatched = scans.filter((s) => !students.some((st) => st.code === s.studentCode)).length
  const scanned = table.totals.filter((t) => t !== null).length

  const setConvert = (v: string) => {
    setConvertInput(v)
    const n = Number(v)
    setOpts((o) => ({ ...o, convertTo: v.trim() && n > 0 ? n : null }))
  }

  const flash = (msg: string) => {
    setCopied(msg)
    setTimeout(() => setCopied(''), 2500)
  }

  const download = () => {
    const sheets = scoreSheets(table, { title: exam.title, classroom: room, term: term ? termLabel(term) : '' }, exam.key, labels)
    downloadBytes(buildXlsx(sheets), `${safeFilename(`${exam.title} ${room.replace('/', '-')}`)}.xlsx`, XLSX_TYPE)
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <a href={`#/exams/${exam.id}`} className="back">
            ← ผลสอบ {exam.title}
          </a>
          <h1>ส่งออกคะแนน</h1>
          <p className="muted">
            {room} · สแกนแล้ว {scanned}/{students.length} คน · คะแนนเต็ม {formatScore(table.maxScore)}
          </p>
        </div>
      </div>

      {unmatched > 0 && (
        <p className="hint warn">
          มีกระดาษ {unmatched} แผ่นที่ยังไม่รู้ว่าเป็นใคร จะไม่อยู่ในไฟล์ <a href={`#/exams/${exam.id}`}>ไปเลือกนักเรียนก่อน</a>
        </p>
      )}

      <div className="card export-options">
        <fieldset>
          <legend>รูปแบบ</legend>
          <div className="chips">
            <button className={`chip ${opts.mode === 'simple' ? 'on' : ''}`} onClick={() => setOpts({ ...opts, mode: 'simple' })}>
              แบบง่าย: คะแนนรายข้อ
            </button>
            <button className={`chip ${opts.mode === 'full' ? 'on' : ''}`} onClick={() => setOpts({ ...opts, mode: 'full' })}>
              เต็มรูปแบบ: เฉลย / คำตอบ / ถูกผิด / คะแนน
            </button>
          </div>
        </fieldset>
        <fieldset>
          <legend>แปลงคะแนนรวม</legend>
          <div className="inline-fields">
            <label className="inline">
              เป็นคะแนนเต็ม
              <input type="number" min={1} step="any" inputMode="decimal" placeholder="เช่น 20" value={convertInput} onChange={(e) => setConvert(e.target.value)} />
            </label>
            <label className="inline">
              ทศนิยม
              <select value={opts.decimals} onChange={(e) => setOpts({ ...opts, decimals: Number(e.target.value) as 0 | 1 | 2 })}>
                <option value={0}>ไม่มี</option>
                <option value={1}>1 ตำแหน่ง</option>
                <option value={2}>2 ตำแหน่ง</option>
              </select>
            </label>
          </div>
          <span className="hint">{opts.convertTo ? `คะแนน ${formatScore(table.maxScore)} เต็ม → ${opts.convertTo} เต็ม` : 'เว้นว่างถ้าไม่ต้องการแปลง'}</span>
        </fieldset>
        <div className="export-actions">
          <button className="btn" onClick={download}>
            ดาวน์โหลด Excel
          </button>
          <button className="btn secondary" onClick={async () => (await copy(totalsText(table.totals))) && flash('คัดลอกคะแนนรวมแล้ว')}>
            คัดลอกคะแนน{opts.convertTo ? 'แปลง' : 'รวม'} (เรียงตามเลขที่)
          </button>
          <button className="btn secondary" onClick={async () => (await copy(toTsv([...table.head, ...table.body]))) && flash('คัดลอกตารางแล้ว')}>
            คัดลอกทั้งตาราง
          </button>
          {copied && <span className="badge ok">{copied}</span>}
        </div>
        <p className="hint">คัดลอกคะแนนรวมแล้ววางในคอลัมน์ของ Excel หรือโปรแกรมคะแนนได้เลย คนที่ไม่มีกระดาษจะเป็นช่องว่าง</p>
      </div>

      <div className="card table-card">
        <table className={`table export-table ${opts.mode}`}>
          <thead>
            {table.head.map((row, r) => (
              <tr key={r} className={opts.mode === 'full' && r === 2 ? 'key-row-head' : ''}>
                {row.map((c, i) => {
                  if (opts.mode === 'full' && r === 0 && i >= 3 && (i - 3) % 3 !== 0 && i < 3 + exam.key.answers.length * 3) return null
                  const span = opts.mode === 'full' && r === 0 && i >= 3 && i < 3 + exam.key.answers.length * 3 ? 3 : 1
                  return (
                    <th key={i} colSpan={span} className={i >= 3 ? 'num' : ''}>
                      {show(c)}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.body.map((row, r) => (
              <tr key={r} className={table.totals[r] === null ? 'absent' : ''}>
                {row.map((c, i) => (
                  <td key={i} className={`${i >= 3 ? 'num' : ''} ${c === 'ถูก' || c === 'ฟรี' ? 'mark good' : c === 'ผิด' || c === 'ไม่ตอบ' || c === 'ฝนหลายข้อ' ? 'mark bad' : ''}`}>
                    {show(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
