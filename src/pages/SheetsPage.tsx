import { useState } from 'react'
import { classroomsOf, sortedPresets, studentsOf, useDB, useViewTerm } from '../data/store'
import type { SheetPreset } from '../data/types'
import { roomLabel } from '../lib/terms'
import { GENERIC_CODE, type SheetConfig } from '../omr/config'
import { AnswerSheet, type SheetTexts } from '../sheet/AnswerSheet'
import { presetSummary } from './NewExamPage'

/** The layout printed for a preset: general-purpose, usable for any exam made from it. */
export function presetConfig(p: SheetPreset, idDigits: number): SheetConfig {
  return { questions: p.questions, choices: p.choices, labelStyle: p.labelStyle, idDigits: p.useStudentId ? idDigits : 0, versions: 0, examCode: GENERIC_CODE }
}

/**
 * Print a preset's answer sheets ahead of time. They are not tied to an exam: any exam
 * created from the same preset (same layout) accepts them when scanning.
 */
export function SheetsPage({ presetId }: { presetId?: string }) {
  const db = useDB()
  const term = useViewTerm()
  const presets = sortedPresets(db)
  const [selected, setSelected] = useState(presets.find((p) => p.id === presetId)?.id ?? presets[0]?.id ?? '')
  const [classroomId, setClassroomId] = useState('')
  const preset = presets.find((p) => p.id === selected)
  const rooms = classroomsOf(db, term?.id)
  const room = rooms.find((c) => c.id === classroomId)
  const students = room ? studentsOf(db, room.id) : []

  if (!preset) return <div className="card empty muted">ยังไม่มีแบบกระดาษคำตอบ ให้ผู้ดูแลระบบสร้างที่ จัดการระบบ → แบบกระดาษคำตอบ</div>

  const config = presetConfig(preset, db.settings.idDigits)
  const texts: SheetTexts = {
    title: 'กระดาษคำตอบ',
    header: db.settings.sheetHeader || undefined,
    logo: db.settings.logo,
    classroom: room ? roomLabel(room) : undefined,
    footer: `${db.settings.schoolName} · ${preset.name} · ใช้ได้กับทุกข้อสอบที่สร้างจากแบบนี้`,
  }
  const idOk = (code: string) => /^\d+$/.test(code) && code.length === config.idDigits

  return (
    <section>
      <div className="page-head no-print">
        <div>
          <h1>พิมพ์กระดาษคำตอบ</h1>
          <p className="muted">พิมพ์เก็บไว้ล่วงหน้าได้ ใช้กับข้อสอบไหนก็ได้ที่สร้างจากแบบเดียวกัน</p>
        </div>
        <button
          className="btn"
          onClick={async () => {
            await document.fonts.ready
            window.print()
          }}
        >
          พิมพ์ / บันทึกเป็น PDF
        </button>
      </div>

      <div className="card form no-print sheets-options">
        <fieldset>
          <legend>แบบกระดาษ</legend>
          <div className="preset-list" role="radiogroup">
            {presets.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={p.id === selected}
                className={`preset ${p.id === selected ? 'on' : ''}`}
                onClick={() => setSelected(p.id)}
              >
                <strong>{p.name}</strong>
                <span>{presetSummary(p)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          ชื่อนักเรียน
          <select value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
            <option value="">แบบว่าง (นักเรียนเขียนชื่อเอง) · พิมพ์กี่สำเนาก็ได้</option>
            {rooms.map((c) => (
              <option key={c.id} value={c.id}>
                แยกรายคน ห้อง {roomLabel(c)} ({studentsOf(db, c.id).length} แผ่น พิมพ์ชื่อและฝนรหัสให้)
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          ตั้งค่าเครื่องพิมพ์: A4 · สเกล 100% (ขนาดจริง) · ปิด Headers and footers · ตอนสแกน ให้เปิดหน้าสแกนของข้อสอบที่ต้องการ แล้วสแกนกระดาษชุดนี้ได้เลย
        </p>
      </div>

      <div className="print-sheets">
        {room ? (
          students.map((s) => (
            <div className="paper" key={s.id}>
              <AnswerSheet
                config={config}
                texts={{ ...texts, studentName: s.name, studentNumber: String(s.number), prefillId: idOk(s.code) ? s.code : undefined }}
              />
            </div>
          ))
        ) : (
          <div className="paper">
            <AnswerSheet config={config} texts={texts} />
          </div>
        )}
      </div>
    </section>
  )
}
