import { removeExam, removeScan, scansOf, studentsOf, useDB, useExamScans } from '../data/store'
import type { ClassStudent, ScanRecord } from '../data/types'
import { examRoomLabel, formatDate, formatScore } from '../lib/exam'
import { go } from '../lib/router'
import { grade, maxScore, missingAnswers } from '../omr/grading'
import { NameImage, StudentPicker } from './StudentPicker'

interface Row {
  student: ClassStudent | null
  scan: ScanRecord | null
}

export function ResultsPage({ examId }: { examId: string }) {
  const db = useDB()
  const exam = db.exams.find((e) => e.id === examId)
  useExamScans(examId)
  if (!exam) return <p>ไม่พบข้อสอบ</p>

  const students = studentsOf(db, exam.classroomId)
  const scans = scansOf(db, exam.id)
  const byCode = new Map(scans.filter((s) => s.studentCode).map((s) => [s.studentCode!, s]))
  const rows: Row[] = [
    ...students.map((st) => ({ student: st, scan: byCode.get(st.code) ?? null })),
    ...scans.filter((s) => !students.some((st) => st.code === s.studentCode)).map((s) => ({ student: null, scan: s })),
  ]
  const unmatched = rows.filter((r) => !r.student).map((r) => r.scan!)
  const scores = scans.map((s) => grade(s.answers, exam.key).score)
  const full = maxScore(exam.key)
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const missingKey = missingAnswers(exam.key).length

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
            {examRoomLabel(db, exam)} · {exam.sheet.questions} ข้อ · คะแนนเต็ม {formatScore(full)} · รหัสแบบ {exam.code}
          </p>
        </div>
        <div className="head-actions">
          <a className={`btn secondary ${scans.length ? '' : 'disabled'}`} href={scans.length ? `#/exams/${exam.id}/export` : undefined}>
            ส่งออกคะแนน
          </a>
          <a className={`btn secondary ${scans.length ? '' : 'disabled'}`} href={scans.length ? `#/exams/${exam.id}/analysis` : undefined}>
            วิเคราะห์ข้อสอบ
          </a>
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

      {unmatched.length > 0 && (
        <div className="card attention">
          <h2>ยังไม่รู้ว่าเป็นใคร ({unmatched.length} แผ่น)</h2>
          <p className="hint">ดูชื่อที่นักเรียนเขียน แล้วเลือกว่าเป็นใคร</p>
          <ul className="match-list">
            {unmatched.map((scan) => (
              <li key={scan.id}>
                <NameImage scan={scan} />
                <div className="match-row">
                  <strong className="match-score">{formatScore(grade(scan.answers, exam.key).score)}</strong>
                  <StudentPicker exam={exam} scan={scan} />
                  <a className="btn secondary small" href={`#/exams/${exam.id}/paper/${scan.id}`}>
                    ดูกระดาษ
                  </a>
                  <button className="btn ghost small danger" onClick={() => confirm('ลบผลสแกนนี้?') && removeScan(scan.id)}>
                    ลบ
                  </button>
                </div>
                {scan.studentCode && <span className="muted small">รหัสที่ฝน: {scan.studentCode} (ไม่พบในห้องนี้)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card table-card">
        <div className="table-tools">
          <strong>ผลรายคน</strong>
          <span className="grow" />
          <a className={`btn secondary small ${scans.length ? '' : 'disabled'}`} href={scans.length ? `#/exams/${exam.id}/export` : undefined}>
            ส่งออก Excel / คัดลอกคะแนน
          </a>
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
            {rows
              .filter((r) => r.student)
              .map(({ student, scan }) => {
                const g = scan ? grade(scan.answers, exam.key) : null
                return (
                  <tr
                    key={student!.id}
                    className={scan ? 'clickable' : 'absent'}
                    onClick={() => scan && go(`/exams/${exam.id}/paper/${scan.id}`)}
                  >
                    <td>{student!.number}</td>
                    <td>{student!.code}</td>
                    <td>
                      {student!.name}
                      {scan && scan.uncertain.length > 0 && <span className="badge warn">ตรวจทาน</span>}
                    </td>
                    <td className="num">{g ? <strong>{formatScore(g.score)}</strong> : <span className="muted">ยังไม่สแกน</span>}</td>
                    <td className="hide-sm muted small">{scan ? formatDate(scan.scannedAt) : ''}</td>
                    <td className="num muted">{scan ? '›' : ''}</td>
                  </tr>
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
