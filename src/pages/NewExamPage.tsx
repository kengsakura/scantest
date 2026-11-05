import { useMemo, useState } from 'react'
import { classroomsOf, createExam, sortedPresets, studentsOf, useDB, useViewTerm } from '../data/store'
import type { SheetPreset, SheetType, User } from '../data/types'
import { go } from '../lib/router'
import { roomLabel, termLabel } from '../lib/terms'
import { LABEL_STYLE_NAMES, MAX_QUESTIONS, type LabelStyle, type SheetConfig } from '../omr/config'
import { computeLayout, maxQuestionsFor } from '../omr/layout'
import { AnswerSheet } from '../sheet/AnswerSheet'

const QUESTION_PRESETS = [10, 15, 20, 25, 30, 40, 50, 60, 80, 100]
const CHOICE_PRESETS = [2, 3, 4, 5, 6]

export function presetSummary(p: { questions: number; choices: number; labelStyle: LabelStyle; useStudentId: boolean; defaultPoints: number }) {
  return `${p.questions} ข้อ · ${p.choices} ตัวเลือก (${LABEL_STYLE_NAMES[p.labelStyle]}) · ${p.useStudentId ? 'ฝนรหัส' : 'เขียนชื่อ'} · ข้อละ ${p.defaultPoints}`
}

/** Sheet options shared by the exam form and the admin's preset editor. */
export function SheetOptions({
  sheet,
  setSheet,
  useStudentId,
  setUseStudentId,
  defaultPoints,
  setDefaultPoints,
  idDigits,
}: {
  sheet: SheetType
  setSheet: (s: SheetType) => void
  useStudentId: boolean
  setUseStudentId: (v: boolean) => void
  defaultPoints: number
  setDefaultPoints: (v: number) => void
  idDigits: number
}) {
  const set = (patch: Partial<SheetType>) => {
    const next = { ...sheet, ...patch }
    if (next.labelStyle === 'truefalse' && next.choices !== 2) next.labelStyle = 'thai'
    setSheet(next)
  }
  const maxQ = useMemo(
    () => maxQuestionsFor({ ...sheet, questions: 1, idDigits: useStudentId ? idDigits : 0, versions: 0, examCode: 'XXXXXX' }, MAX_QUESTIONS),
    [sheet, useStudentId, idDigits],
  )
  return (
    <>
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
            ฝนเลขประจำตัว
          </button>
          <button type="button" className={`chip ${!useStudentId ? 'on' : ''}`} onClick={() => setUseStudentId(false)}>
            เขียนชื่ออย่างเดียว
          </button>
        </div>
        <span className="hint">
          {useStudentId
            ? 'ระบบรู้ชื่อนักเรียนทันทีจากเลขที่ฝน และเก็บภาพชื่อที่เขียนไว้ตรวจสอบ'
            : 'ไม่มีช่องฝนรหัส ระบบเก็บภาพชื่อที่เขียน แล้วครูเลือกจับคู่ชื่อนักเรียนทีหลังในหน้าผลสอบ'}
        </span>
      </fieldset>

      <label>
        คะแนนต่อข้อ (ค่าเริ่มต้น แก้รายข้อได้ทีหลัง)
        <input type="number" min={0.25} step={0.25} value={defaultPoints} onChange={(e) => setDefaultPoints(Number(e.target.value))} />
      </label>
    </>
  )
}

export function NewExamPage({ user }: { user: User }) {
  const db = useDB()
  const term = useViewTerm()
  const presets = sortedPresets(db)
  const rooms = classroomsOf(db, term?.id)
  const [title, setTitle] = useState('')
  const [classroomId, setClassroomId] = useState(rooms[0]?.id ?? '')
  const [presetId, setPresetId] = useState<string | 'custom'>(presets[0]?.id ?? 'custom')
  const first: SheetPreset | undefined = presets[0]
  const [sheet, setSheet] = useState<SheetType>(first ? { questions: first.questions, choices: first.choices, labelStyle: first.labelStyle } : { questions: 30, choices: 4, labelStyle: 'thai' })
  const [defaultPoints, setDefaultPoints] = useState(first?.defaultPoints ?? 1)
  const [useStudentId, setUseStudentId] = useState(first?.useStudentId ?? true)

  const pick = (p: SheetPreset | 'custom') => {
    if (p === 'custom') {
      setPresetId('custom')
      return
    }
    setPresetId(p.id)
    setSheet({ questions: p.questions, choices: p.choices, labelStyle: p.labelStyle })
    setDefaultPoints(p.defaultPoints)
    setUseStudentId(p.useStudentId)
  }

  const preview: SheetConfig = useMemo(
    () => ({ ...sheet, idDigits: useStudentId ? db.settings.idDigits : 0, versions: 0, examCode: 'XXXXXX' }),
    [sheet, db.settings.idDigits, useStudentId],
  )
  const layout = computeLayout(preview)
  const room = rooms.find((c) => c.id === classroomId)
  const canCreate = !!term && title.trim() !== '' && !!room && layout.ok && defaultPoints > 0

  const submit = () => {
    if (!canCreate) return
    const exam = createExam({
      title: title.trim(),
      termId: term.id,
      classroomId,
      ownerId: user.id,
      sheet,
      defaultPoints,
      useStudentId,
      presetId: presetId === 'custom' ? null : presetId,
    })
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
          {term && <p className="muted">ภาคเรียน {termLabel(term)}</p>}
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
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น สอบกลางภาค คณิตศาสตร์" autoFocus />
          </label>

          <label>
            ห้องเรียน
            {rooms.length === 0 ? (
              <span className="hint warn">ภาคเรียนนี้ยังไม่มีห้องเรียน ให้ผู้ดูแลระบบนำเข้ารายชื่อนักเรียนก่อน</span>
            ) : (
              <select value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
                {rooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {roomLabel(c)} ({studentsOf(db, c.id).length} คน)
                  </option>
                ))}
              </select>
            )}
          </label>

          <fieldset>
            <legend>แบบกระดาษคำตอบ</legend>
            <div className="preset-list" role="radiogroup">
              {presets.map((p) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={presetId === p.id}
                  key={p.id}
                  className={`preset ${presetId === p.id ? 'on' : ''}`}
                  onClick={() => pick(p)}
                >
                  <strong>{p.name}</strong>
                  <span>{presetSummary(p)}</span>
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={presetId === 'custom'}
                className={`preset ${presetId === 'custom' ? 'on' : ''}`}
                onClick={() => pick('custom')}
              >
                <strong>กำหนดเอง</strong>
                <span>เลือกจำนวนข้อ ตัวเลือก และรูปแบบเอง</span>
              </button>
            </div>
          </fieldset>

          {presetId === 'custom' && (
            <SheetOptions
              sheet={sheet}
              setSheet={setSheet}
              useStudentId={useStudentId}
              setUseStudentId={setUseStudentId}
              defaultPoints={defaultPoints}
              setDefaultPoints={setDefaultPoints}
              idDigits={db.settings.idDigits}
            />
          )}

          {!layout.ok && <p className="hint warn">{layout.error}</p>}

          <button className="btn block" disabled={!canCreate}>
            สร้างและไปใส่เฉลย →
          </button>
        </form>

        <div className="preview">
          <div className="preview-label muted small">ตัวอย่างกระดาษคำตอบ</div>
          <div className="paper">
            <AnswerSheet
              config={preview}
              texts={{ title: title || 'ชื่อข้อสอบ', classroom: room ? roomLabel(room) : undefined, header: db.settings.sheetHeader || undefined, logo: db.settings.logo }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
