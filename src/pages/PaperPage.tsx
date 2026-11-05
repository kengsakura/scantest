import { useState } from 'react'
import { removeScan, scansOf, studentsOf, updateScanAnswers, useDB, useExamScans } from '../data/store'
import type { ScanRecord, Student } from '../data/types'
import { examConfig, formatScore } from '../lib/exam'
import { go } from '../lib/router'
import { choiceLabels } from '../omr/config'
import { grade, type QuestionStatus } from '../omr/grading'
import { AnswerSheet } from '../sheet/AnswerSheet'
import { NameImage, StudentPicker } from './StudentPicker'

const STATUS: Record<QuestionStatus, { text: string; cls: string }> = {
  correct: { text: '✓', cls: 'good' },
  wrong: { text: '✗', cls: 'bad' },
  blank: { text: 'ไม่ตอบ', cls: 'bad' },
  multiple: { text: 'ฝนหลายข้อ', cls: 'bad' },
  free: { text: 'ฟรี', cls: 'good' },
}

/** Papers in the order the results table shows them: class list first, then unidentified sheets. */
export function orderedPapers(scans: ScanRecord[], students: Student[]): ScanRecord[] {
  const num = new Map(students.map((s) => [s.code, s.number]))
  return [...scans].sort((a, b) => {
    const na = num.get(a.studentCode ?? '') ?? Infinity
    const nb = num.get(b.studentCode ?? '') ?? Infinity
    return na - nb || a.scannedAt.localeCompare(b.scannedAt)
  })
}

export function PaperPage({ examId, scanId }: { examId: string; scanId: string }) {
  const db = useDB()
  useExamScans(examId)
  const exam = db.exams.find((e) => e.id === examId)
  const [tab, setTab] = useState<'sheet' | 'table'>('sheet')
  const [draft, setDraft] = useState<number[][] | null>(null)
  if (!exam) return <p>ไม่พบข้อสอบ</p>

  const students = studentsOf(db, exam.classroomId)
  const papers = orderedPapers(scansOf(db, exam.id), students)
  const index = papers.findIndex((p) => p.id === scanId)
  const scan = papers[index]
  if (!scan) return <p className="muted">กำลังโหลด หรือไม่พบกระดาษแผ่นนี้</p>

  const student = students.find((s) => s.code === scan.studentCode)
  const answers = draft ?? scan.answers
  const g = grade(answers, exam.key)
  const pct = g.maxScore ? Math.round((g.score / g.maxScore) * 100) : 0
  const labels = choiceLabels(exam.sheet)
  const room = db.classrooms.find((c) => c.id === exam.classroomId)
  const editing = draft !== null

  const goTo = (i: number) => {
    setDraft(null)
    go(`/exams/${exam.id}/paper/${papers[i].id}`)
  }
  const toggle = (q: number, c: number) =>
    setDraft((d) => {
      const next = (d ?? scan.answers).map((row) => [...row])
      next[q] = next[q].includes(c) ? next[q].filter((x) => x !== c) : [...next[q], c].sort((a, b) => a - b)
      return next
    })

  return (
    <section className="paper-page">
      <div className="page-head">
        <div>
          <a href={`#/exams/${exam.id}`} className="back">
            ← ผลสอบ {exam.title}
          </a>
          <h1>
            {formatScore(g.score)} / {formatScore(g.maxScore)} = {pct}%
          </h1>
          <p className="muted">
            {student ? `${student.number}. ${student.name}` : 'ยังไม่ระบุนักเรียน'} · แผ่นที่ {index + 1}/{papers.length}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn secondary" disabled={index <= 0} onClick={() => goTo(index - 1)}>
            ← ก่อนหน้า
          </button>
          <button className="btn secondary" disabled={index >= papers.length - 1} onClick={() => goTo(index + 1)}>
            ถัดไป →
          </button>
        </div>
      </div>

      <div className="card paper-tools">
        <NameImage scan={scan} />
        <div className="detail-actions">
          <span className="muted small">นักเรียน</span>
          <StudentPicker exam={exam} scan={scan} />
        </div>
        <div className="detail-actions">
          {editing ? (
            <>
              <span className="hint warn">แตะวงกลมเพื่อเพิ่ม/ลบคำตอบ</span>
              <button
                className="btn small"
                onClick={() => {
                  updateScanAnswers(scan.id, answers)
                  setDraft(null)
                }}
              >
                บันทึกคำตอบ
              </button>
              <button className="btn secondary small" onClick={() => setDraft(null)}>
                ยกเลิก
              </button>
            </>
          ) : (
            <>
              <button
                className="btn secondary small"
                onClick={() => {
                  setDraft(scan.answers.map((r) => [...r]))
                  setTab('sheet')
                }}
              >
                แก้คำตอบ
              </button>
              <button
                className="btn ghost small danger"
                onClick={() => {
                  if (!confirm('ลบกระดาษแผ่นนี้?')) return
                  const next = papers[index + 1] ?? papers[index - 1]
                  removeScan(scan.id)
                  go(next ? `/exams/${exam.id}/paper/${next.id}` : `/exams/${exam.id}`)
                }}
              >
                ลบกระดาษ
              </button>
            </>
          )}
        </div>
        {scan.uncertain.length > 0 && !editing && <p className="hint warn">ฝนไม่ชัด ควรตรวจทาน: ข้อ {scan.uncertain.join(', ')}</p>}
      </div>

      <div className="tabs paper-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'sheet'} className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>
          กระดาษ
        </button>
        <button role="tab" aria-selected={tab === 'table'} className={tab === 'table' ? 'on' : ''} onClick={() => setTab('table')}>
          รายข้อ
        </button>
      </div>

      {tab === 'sheet' ? (
        <div className={`paper graded ${editing ? 'editing' : ''}`}>
          <AnswerSheet
            config={examConfig(exam)}
            texts={{
              title: exam.title,
              classroom: room?.name,
              studentName: student?.name,
              studentNumber: student ? String(student.number) : undefined,
              prefillId: exam.idDigits ? (scan.studentCode ?? undefined) : undefined,
            }}
            marks={{ answers, key: editing ? undefined : exam.key }}
            onBubbleClick={editing ? toggle : undefined}
          />
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>ข้อ</th>
                <th>เฉลย</th>
                <th>ตอบ</th>
                <th className="num">ได้</th>
                <th className="num">เต็ม</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {g.status.map((st, i) => {
                const key = exam.key.answers[i]
                const earned = st === 'correct' || st === 'free' ? exam.key.points[i] : 0
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{exam.key.free[i] ? 'ฟรี' : key !== null ? labels[key] : '–'}</td>
                    <td>{answers[i]?.length ? answers[i].map((c) => labels[c]).join(', ') : '–'}</td>
                    <td className="num">{formatScore(earned)}</td>
                    <td className="num">{formatScore(exam.key.points[i])}</td>
                    <td className={`mark ${STATUS[st].cls}`}>{STATUS[st].text}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
