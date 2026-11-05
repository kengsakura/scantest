import { useMemo, useState } from 'react'
import { createExam, studentsOf, useDB } from '../data/store'
import type { SheetType, User } from '../data/types'
import { go } from '../lib/router'
import { LABEL_STYLE_NAMES, MAX_QUESTIONS, type LabelStyle, type SheetConfig } from '../omr/config'
import { computeLayout, maxQuestionsFor } from '../omr/layout'
import { AnswerSheet } from '../sheet/AnswerSheet'

const QUESTION_PRESETS = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100]
const CHOICE_PRESETS = [2, 3, 4, 5, 6]

export function NewExamPage({ user }: { user: User }) {
  const db = useDB()
  const [title, setTitle] = useState('')
  const [classroomId, setClassroomId] = useState(db.classrooms[0]?.id ?? '')
  const [sheet, setSheet] = useState<SheetType>({ questions: 30, choices: 4, labelStyle: 'thai' })
  const [defaultPoints, setDefaultPoints] = useState(1)
  const [useStudentId, setUseStudentId] = useState(true)

  const set = (patch: Partial<SheetType>) =>
    setSheet((s) => {
      const next = { ...s, ...patch }
      if (next.labelStyle === 'truefalse' && next.choices !== 2) next.labelStyle = 'thai'
      return next
    })

  const preview: SheetConfig = useMemo(
    () => ({ ...sheet, idDigits: useStudentId ? db.settings.idDigits : 0, versions: 0, examCode: 'XXXXXX' }),
    [sheet, db.settings.idDigits, useStudentId],
  )
  const layout = computeLayout(preview)
  const maxQ = useMemo(() => maxQuestionsFor({ ...preview, questions: 1 }, MAX_QUESTIONS), [preview])
  const room = db.classrooms.find((c) => c.id === classroomId)
  const canCreate = title.trim() !== '' && classroomId !== '' && layout.ok && defaultPoints > 0

  const submit = () => {
    if (!canCreate) return
    const exam = createExam({ title: title.trim(), classroomId, ownerId: user.id, sheet, defaultPoints, useStudentId })
    go(`/exams/${exam.id}/key`)
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <a href="#/exams" className="back">
            ← ข้อสอบ
          </a>
          <h1>สร้างข้อสอบ</h1>
        </div>
      </div>

      <div className="split">
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label>
            ชื่อข้อสอบ
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น สอบกลางภาค คณิตศาสตร์ ม.1" autoFocus />
          </label>

          <label>
            ห้องเรียน
            {db.classrooms.length === 0 ? (
              <span className="hint warn">ยังไม่มีห้องเรียน ให้ผู้ดูแลระบบเพิ่มห้องและรายชื่อนักเรียนก่อน</span>
            ) : (
              <select value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
                {db.classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({studentsOf(db, c.id).length} คน)
                  </option>
                ))}
              </select>
            )}
          </label>

          <fieldset>
            <legend>จำนวนข้อ</legend>
            <div className="chips">
              {QUESTION_PRESETS.map((q) => (
                <button type="button" key={q} className={`chip ${sheet.questions === q ? 'on' : ''}`} onClick={() => set({ questions: q })} disabled={q > maxQ}>
                  {q}
                </button>
              ))}
              <input
                type="number"
                className="chip-input"
                min={1}
                max={maxQ}
                value={sheet.questions}
                onChange={(e) => set({ questions: Math.max(1, Math.min(MAX_QUESTIONS, Number(e.target.value) || 1)) })}
                aria-label="จำนวนข้อ (กำหนดเอง)"
              />
            </div>
            <span className="hint">หน้าเดียวรองรับสูงสุด {maxQ} ข้อ สำหรับ {sheet.choices} ตัวเลือก</span>
          </fieldset>

          <fieldset>
            <legend>จำนวนตัวเลือก</legend>
            <div className="chips">
              {CHOICE_PRESETS.map((c) => (
                <button type="button" key={c} className={`chip ${sheet.choices === c ? 'on' : ''}`} onClick={() => set({ choices: c })}>
                  {c}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>รูปแบบตัวเลือก</legend>
            <div className="chips">
              {(Object.keys(LABEL_STYLE_NAMES) as LabelStyle[])
                .filter((s) => s !== 'truefalse' || sheet.choices === 2)
                .map((s) => (
                  <button type="button" key={s} className={`chip ${sheet.labelStyle === s ? 'on' : ''}`} onClick={() => set({ labelStyle: s })}>
                    {LABEL_STYLE_NAMES[s]}
                  </button>
                ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>ระบุตัวนักเรียนด้วย</legend>
            <div className="chips">
              <button type="button" className={`chip ${useStudentId ? 'on' : ''}`} onClick={() => setUseStudentId(true)}>
                ฝนรหัสนักเรียน
              </button>
              <button type="button" className={`chip ${!useStudentId ? 'on' : ''}`} onClick={() => setUseStudentId(false)}>
                เขียนชื่ออย่างเดียว
              </button>
            </div>
            <span className="hint">
              {useStudentId
                ? 'ระบบรู้ชื่อนักเรียนทันทีจากรหัสที่ฝน และเก็บภาพชื่อที่เขียนไว้ตรวจสอบ'
                : 'ไม่มีช่องฝนรหัส ระบบเก็บภาพชื่อที่เขียน แล้วครูเลือกจับคู่ชื่อนักเรียนทีหลังในหน้าผลสอบ'}
            </span>
          </fieldset>

          <label>
            คะแนนต่อข้อ (ค่าเริ่มต้น แก้รายข้อได้ทีหลัง)
            <input type="number" min={0.25} step={0.25} value={defaultPoints} onChange={(e) => setDefaultPoints(Number(e.target.value))} />
          </label>

          {!layout.ok && <p className="hint warn">{layout.error}</p>}

          <button className="btn block" disabled={!canCreate}>
            สร้างและไปใส่เฉลย →
          </button>
        </form>

        <div className="preview">
          <div className="preview-label muted small">ตัวอย่างกระดาษคำตอบ</div>
          <div className="paper">
            <AnswerSheet config={preview} texts={{ title: title || 'ชื่อข้อสอบ', classroom: room?.name }} />
          </div>
        </div>
      </div>
    </section>
  )
}
