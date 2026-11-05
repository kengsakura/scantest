import { useEffect, useRef, useState } from 'react'
import { scanCount, updateExam, useDB } from '../data/store'
import { formatScore } from '../lib/exam'
import { go } from '../lib/router'
import { choiceLabels, LABELS } from '../omr/config'
import { maxScore, missingAnswers, type AnswerKey } from '../omr/grading'

/** Turn typed text like "กขคง", "1234" or "abcd" into answers; "-", "?" or "0" leave a question unset. */
function parseQuick(text: string, choices: number): (number | null)[] {
  const out: (number | null)[] = []
  const lookup = new Map<string, number>()
  for (const set of Object.values(LABELS)) set.forEach((ch, i) => lookup.set(ch.toLowerCase(), i))
  for (const raw of text) {
    const ch = raw.toLowerCase()
    if (/[\s,./]/.test(ch)) continue
    if (ch === '-' || ch === '?' || ch === '0') {
      out.push(null)
      continue
    }
    const i = lookup.get(ch)
    if (i !== undefined && i < choices) out.push(i)
  }
  return out
}

export function KeyPage({ examId }: { examId: string }) {
  const db = useDB()
  const exam = db.exams.find((e) => e.id === examId)
  const [key, setKey] = useState<AnswerKey | null>(exam ? structuredClone(exam.key) : null)
  const [bulkPoints, setBulkPoints] = useState(exam?.key.points[0] ?? 1)
  const [quick, setQuick] = useState('')
  const [saved, setSaved] = useState(true)

  // Auto-save shortly after each change, and on leaving the page, so edits are never lost.
  const dirty = useRef(false)
  const latest = useRef(key)
  latest.current = key
  useEffect(() => {
    if (!dirty.current || !latest.current) return
    const t = window.setTimeout(() => {
      updateExam(examId, { key: latest.current! })
      dirty.current = false
      setSaved(true)
    }, 800)
    return () => window.clearTimeout(t)
  }, [key, examId])
  useEffect(
    () => () => {
      if (dirty.current && latest.current) updateExam(examId, { key: latest.current })
    },
    [examId],
  )

  if (!exam || !key) return <p>ไม่พบข้อสอบ</p>

  const labels = choiceLabels(exam.sheet)
  const missing = missingAnswers(key)
  const hasScans = scanCount(db, exam.id) > 0

  const edit = (fn: (k: AnswerKey) => void) => {
    const next = structuredClone(key)
    fn(next)
    setKey(next)
    dirty.current = true
    setSaved(false)
  }

  const save = (thenScan: boolean) => {
    updateExam(exam.id, { key })
    dirty.current = false
    setSaved(true)
    if (thenScan) go(`/exams/${exam.id}/scan`)
  }

  const applyQuick = () => {
    const parsed = parseQuick(quick, exam.sheet.choices)
    edit((k) => parsed.slice(0, k.answers.length).forEach((a, i) => (k.answers[i] = a)))
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <a href={`#/exams/${exam.id}`} className="back">
            ← {exam.title}
          </a>
          <h1>เฉลยและคะแนน</h1>
          <p className="muted">
            {exam.sheet.questions} ข้อ · คะแนนเต็ม {formatScore(maxScore(key))}
            {missing.length > 0 && <span className="badge warn">ยังไม่ใส่เฉลย {missing.length} ข้อ</span>}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn secondary" onClick={() => save(false)}>
            {saved ? 'บันทึกแล้ว ✓' : 'กำลังบันทึก…'}
          </button>
          <button className="btn" onClick={() => save(true)} disabled={missing.length > 0} title={missing.length ? 'ใส่เฉลยให้ครบก่อน' : ''}>
            บันทึกแล้วเริ่มสแกน →
          </button>
        </div>
      </div>

      {hasScans && <p className="hint">มีการสแกนแล้ว เมื่อแก้เฉลยหรือคะแนน ระบบจะคิดคะแนนของทุกคนใหม่ให้อัตโนมัติ</p>}

      <div className="card toolbar">
        <label className="inline">
          คะแนนทุกข้อ
          <input type="number" min={0} step={0.25} value={bulkPoints} onChange={(e) => setBulkPoints(Number(e.target.value))} />
          <button className="btn secondary small" onClick={() => edit((k) => (k.points = k.points.map(() => bulkPoints)))}>
            ใช้กับทุกข้อ
          </button>
        </label>
        <label className="inline grow">
          พิมพ์เฉลยเร็ว
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyQuick()}
            placeholder={`เช่น ${labels.slice(0, Math.min(4, labels.length)).join('')}${labels[0]}… หรือ 1234 (ใช้ - ข้ามข้อ)`}
          />
          <button className="btn secondary small" onClick={applyQuick} disabled={!quick}>
            ใส่เฉลยตั้งแต่ข้อ 1
          </button>
        </label>
      </div>

      <div className="key-grid">
        {key.answers.map((ans, i) => (
          <div key={i} className={`key-row ${key.free[i] ? 'free' : ''} ${ans === null && !key.free[i] ? 'missing' : ''}`}>
            <span className="qn">{i + 1}</span>
            <div className="choices" role="radiogroup" aria-label={`ข้อ ${i + 1}`}>
              {labels.map((l, c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={ans === c}
                  className={`bubble ${ans === c ? 'on' : ''}`}
                  onClick={() => edit((k) => (k.answers[i] = k.answers[i] === c ? null : c))}
                  disabled={key.free[i]}
                >
                  {l}
                </button>
              ))}
            </div>
            <input
              type="number"
              className="pts"
              min={0}
              step={0.25}
              value={key.points[i]}
              onChange={(e) => edit((k) => (k.points[i] = Math.max(0, Number(e.target.value))))}
              aria-label={`คะแนนข้อ ${i + 1}`}
            />
            <label className="free-toggle" title="ข้อฟรี: ได้คะแนนทุกคน ไม่ว่าจะตอบอะไรหรือไม่ตอบ">
              <input type="checkbox" checked={key.free[i]} onChange={(e) => edit((k) => (k.free[i] = e.target.checked))} />
              ฟรี
            </label>
          </div>
        ))}
      </div>
    </section>
  )
}
