import { useState } from 'react'
import { movePreset, removePreset, savePreset, sortedPresets, useDB } from '../../data/store'
import type { SheetPreset, SheetType } from '../../data/types'
import { computeLayout } from '../../omr/layout'
import { AnswerSheet } from '../../sheet/AnswerSheet'
import { presetSummary, SheetOptions } from '../NewExamPage'

type Draft = Omit<SheetPreset, 'id' | 'sort'> & { id?: string }

const BLANK: Draft = { name: '', questions: 30, choices: 4, labelStyle: 'thai', useStudentId: true, defaultPoints: 1 }

export function PresetsTab() {
  const db = useDB()
  const presets = sortedPresets(db)
  const [draft, setDraft] = useState<Draft | null>(null)

  return (
    <div className="split">
      <div className="card">
        <h2>แบบกระดาษคำตอบ ({presets.length})</h2>
        <p className="hint">ครูเลือกแบบเหล่านี้ตอนสร้างข้อสอบ (หรือกำหนดเองได้) เรียงลำดับตามที่ต้องการให้ครูเห็น</p>
        <ul className="plain-list">
          {presets.map((p, i) => (
            <li key={p.id}>
              <span>
                <strong>{p.name}</strong>
                <div className="muted small">{presetSummary(p)}</div>
              </span>
              <span className="head-actions">
                <button className="btn ghost small" disabled={i === 0} onClick={() => movePreset(p.id, -1)} aria-label="เลื่อนขึ้น">
                  ↑
                </button>
                <button className="btn ghost small" disabled={i === presets.length - 1} onClick={() => movePreset(p.id, 1)} aria-label="เลื่อนลง">
                  ↓
                </button>
                <a className="btn secondary small" href={`#/sheets/${p.id}`}>
                  พิมพ์
                </a>
                <button className="btn secondary small" onClick={() => setDraft({ ...p })}>
                  แก้ไข
                </button>
                <button className="btn ghost small danger" onClick={() => confirm(`ลบแบบ "${p.name}"? (ข้อสอบที่สร้างไปแล้วไม่เปลี่ยน)`) && removePreset(p.id)}>
                  ลบ
                </button>
              </span>
            </li>
          ))}
        </ul>
        <button className="btn" onClick={() => setDraft({ ...BLANK })}>
          + เพิ่มแบบกระดาษ
        </button>
      </div>
      {draft ? <PresetEditor key={draft.id ?? 'new'} draft={draft} done={() => setDraft(null)} /> : <div className="card empty muted">เลือก "แก้ไข" หรือ "เพิ่มแบบกระดาษ"</div>}
    </div>
  )
}

function PresetEditor({ draft, done }: { draft: Draft; done: () => void }) {
  const db = useDB()
  const [name, setName] = useState(draft.name)
  const [sheet, setSheet] = useState<SheetType>({ questions: draft.questions, choices: draft.choices, labelStyle: draft.labelStyle })
  const [useStudentId, setUseStudentId] = useState(draft.useStudentId)
  const [defaultPoints, setDefaultPoints] = useState(draft.defaultPoints)
  const config = { ...sheet, idDigits: useStudentId ? db.settings.idDigits : 0, versions: 0, examCode: 'XXXXXX' }
  const ok = computeLayout(config).ok && name.trim() !== '' && defaultPoints > 0

  return (
    <div className="card form">
      <h2>{draft.id ? 'แก้ไขแบบกระดาษ' : 'แบบกระดาษใหม่'}</h2>
      <label>
        ชื่อแบบ
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น สอบกลางภาค 40 ข้อ" autoFocus />
      </label>
      <SheetOptions
        sheet={sheet}
        setSheet={setSheet}
        useStudentId={useStudentId}
        setUseStudentId={setUseStudentId}
        defaultPoints={defaultPoints}
        setDefaultPoints={setDefaultPoints}
        idDigits={db.settings.idDigits}
      />
      <div className="inline-fields">
        <button
          className="btn"
          disabled={!ok}
          onClick={() => {
            savePreset({ id: draft.id, name: name.trim(), ...sheet, useStudentId, defaultPoints })
            done()
          }}
        >
          บันทึก
        </button>
        <button className="btn secondary" onClick={done}>
          ยกเลิก
        </button>
      </div>
      <div className="paper small-preview">
        <AnswerSheet config={config} texts={{ title: name || 'ชื่อข้อสอบ', header: db.settings.sheetHeader || undefined, logo: db.settings.logo }} />
      </div>
    </div>
  )
}
