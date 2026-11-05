import { Fragment, useState } from 'react'
import { removeExam, removeScan, scansOf, studentsOf, useDB } from '../data/store'
import type { ScanRecord, Student } from '../data/types'
import { formatDate, formatScore } from '../lib/exam'
import { go } from '../lib/router'
import { choiceLabels } from '../omr/config'
import { grade, maxScore, missingAnswers } from '../omr/grading'
import { GradeStrip } from './GradeStrip'

interface Row {
  student: Student | null
  scan: ScanRecord | null
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') // BOM so Excel reads Thai correctly
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ResultsPage({ examId }: { examId: string }) {
  const db = useDB()
  const exam = db.exams.find((e) => e.id === examId)
  const [open, setOpen] = useState<string | null>(null)
  if (!exam) return <p>ไม่พบข้อสอบ</p>

  const room = db.classrooms.find((c) => c.id === exam.classroomId)
  const students = studentsOf(db, exam.classroomId)
  const scans = scansOf(db, exam.id)
  const byCode = new Map(scans.filter((s) => s.studentCode).map((s) => [s.studentCode!, s]))
  const rows: Row[] = [
    ...students.map((st) => ({ student: st, scan: byCode.get(st.code) ?? null })),
    ...scans.filter((s) => !students.some((st) => st.code === s.studentCode)).map((s) => ({ student: null, scan: s })),
  ]
  const scores = scans.map((s) => grade(s.answers, exam.key).score)
  const full = maxScore(exam.key)
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const missingKey = missingAnswers(exam.key).length

  const exportCsv = (withAnswers: boolean) => {
    const labels = choiceLabels(exam.sheet)
    const qs = Array.from({ length: exam.sheet.questions }, (_, i) => `ข้อ ${i + 1}`)
    const header = ['เลขที่', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'คะแนน', 'คะแนนเต็ม', ...(withAnswers ? qs : [])]
    const body = rows.map(({ student, scan }) => {
      const g = scan ? grade(scan.answers, exam.key) : null
      return [
        student?.number ?? '',
        student?.code ?? scan?.studentCode ?? '',
        student?.name ?? '',
        g ? g.score : 'ขาดสอบ',
        full,
        ...(withAnswers ? (scan ? scan.answers.map((m) => m.map((c) => labels[c]).join('+')) : qs.map(() => '')) : []),
      ]
    })
    downloadCsv(`${exam.title} ${room?.name ?? ''}.csv`.replace(/[\\/:*?"<>|]/g, '_'), [header, ...body])
  }

  const deleteExam = () => {
    if (confirm(`ลบข้อสอบ "${exam.title}" และผลสแกนทั้งหมด? การลบย้อนกลับไม่ได้`)) {
      removeExam(exam.id)
      go('/exams')
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <a href="#/exams" className="back">
            ← ข้อสอบ
          </a>
          <h1>{exam.title}</h1>
          <p className="muted">
            {room?.name} · {exam.sheet.questions} ข้อ · คะแนนเต็ม {formatScore(full)} · รหัสแบบ {exam.code}
          </p>
        </div>
        <div className="head-actions">
          <a className="btn secondary" href={`#/exams/${exam.id}/key`}>
            เฉลย
          </a>
          <a className="btn secondary" href={`#/exams/${exam.id}/print`}>
            พิมพ์กระดาษ
          </a>
          <a className={`btn ${missingKey ? 'disabled' : ''}`} href={missingKey ? undefined : `#/exams/${exam.id}/scan`}>
            สแกน
          </a>
        </div>
      </div>

      <div className="stats">
        <div className="card stat">
          <span className="muted small">สแกนแล้ว</span>
          <strong>
            {scans.length}
            <small>/{students.length}</small>
          </strong>
        </div>
        <div className="card stat">
          <span className="muted small">เฉลี่ย</span>
          <strong>{scores.length ? formatScore(Math.round(mean * 100) / 100) : '–'}</strong>
        </div>
        <div className="card stat">
          <span className="muted small">สูงสุด</span>
          <strong>{scores.length ? formatScore(Math.max(...scores)) : '–'}</strong>
        </div>
        <div className="card stat">
          <span className="muted small">ต่ำสุด</span>
          <strong>{scores.length ? formatScore(Math.min(...scores)) : '–'}</strong>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-tools">
          <strong>ผลรายคน</strong>
          <span className="grow" />
          <button className="btn secondary small" onClick={() => exportCsv(false)} disabled={!scans.length}>
            ส่งออก CSV (คะแนน)
          </button>
          <button className="btn secondary small" onClick={() => exportCsv(true)} disabled={!scans.length}>
            ส่งออก CSV (คะแนน + คำตอบรายข้อ)
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>เลขที่</th>
              <th>รหัส</th>
              <th>ชื่อ-สกุล</th>
              <th className="num">คะแนน</th>
              <th className="hide-sm">สแกนเมื่อ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ student, scan }) => {
              const key = scan?.id ?? student!.id
              const g = scan ? grade(scan.answers, exam.key) : null
              return (
                <Fragment key={key}>
                  <tr className={scan ? 'clickable' : 'absent'} onClick={() => scan && setOpen(open === key ? null : key)}>
                    <td>{student?.number ?? '–'}</td>
                    <td>{student?.code ?? scan?.studentCode ?? '?'}</td>
                    <td>
                      {student?.name ?? <span className="badge warn">{scan?.studentCode ? 'ไม่พบในห้อง' : 'อ่านรหัสไม่ได้'}</span>}
                      {scan && scan.uncertain.length > 0 && <span className="badge warn">ตรวจทาน</span>}
                    </td>
                    <td className="num">{g ? <strong>{formatScore(g.score)}</strong> : <span className="muted">ยังไม่สแกน</span>}</td>
                    <td className="hide-sm muted small">{scan ? formatDate(scan.scannedAt) : ''}</td>
                    <td className="num">{scan ? (open === key ? '▲' : '▼') : ''}</td>
                  </tr>
                  {scan && open === key && (
                    <tr className="detail">
                      <td colSpan={6}>
                        <GradeStrip status={g!.status} />
                        {scan.uncertain.length > 0 && <p className="hint warn">ฝนไม่ชัด: ข้อ {scan.uncertain.join(', ')}</p>}
                        <button
                          className="btn ghost small danger"
                          onClick={() => confirm('ลบผลสแกนนี้?') && removeScan(scan.id)}
                        >
                          ลบผลสแกนนี้
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <ExamDanger onDelete={deleteExam} />
    </section>
  )
}

function ExamDanger({ onDelete }: { onDelete: () => void }) {
  return (
    <div className="danger-zone">
      <button className="btn ghost small danger" onClick={onDelete}>
        ลบข้อสอบนี้
      </button>
    </div>
  )
}
