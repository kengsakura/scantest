import { scanCount, studentsOf, useDB, visibleExams } from '../data/store'
import type { User } from '../data/types'
import { formatDate } from '../lib/exam'
import { go } from '../lib/router'
import { missingAnswers } from '../omr/grading'

export function ExamsPage({ user }: { user: User }) {
  const db = useDB()
  const exams = visibleExams(db, user)

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>ข้อสอบ</h1>
          <p className="muted">{user.role === 'admin' ? 'ข้อสอบทั้งหมดในโรงเรียน' : 'ข้อสอบที่คุณสร้าง'}</p>
        </div>
        <button className="btn" onClick={() => go('/exams/new')}>
          + สร้างข้อสอบ
        </button>
      </div>

      {exams.length === 0 ? (
        <div className="card empty">
          <p>ยังไม่มีข้อสอบ</p>
          <button className="btn" onClick={() => go('/exams/new')}>
            สร้างข้อสอบแรก
          </button>
        </div>
      ) : (
        <ul className="exam-list">
          {exams.map((e) => {
            const room = db.classrooms.find((c) => c.id === e.classroomId)
            const total = studentsOf(db, e.classroomId).length
            const scanned = scanCount(db, e.id)
            const missing = missingAnswers(e.key).length
            const owner = db.users.find((u) => u.id === e.ownerId)
            return (
              <li key={e.id} className="card exam-item">
                <button className="exam-main" onClick={() => go(`/exams/${e.id}`)}>
                  <strong>{e.title}</strong>
                  <span className="muted">
                    {room?.name ?? 'ไม่ระบุห้อง'} · {e.sheet.questions} ข้อ {e.sheet.choices} ตัวเลือก · รหัส {e.code}
                  </span>
                  <span className="muted small">
                    {formatDate(e.createdAt)}
                    {user.role === 'admin' && owner ? ` · ${owner.name}` : ''}
                  </span>
                </button>
                <div className="exam-stats">
                  {missing > 0 ? (
                    <span className="badge warn">ยังไม่ใส่เฉลย {missing} ข้อ</span>
                  ) : (
                    <span className="badge ok">
                      สแกนแล้ว {scanned}/{total}
                    </span>
                  )}
                </div>
                <div className="exam-actions">
                  <a className="btn secondary small" href={`#/exams/${e.id}/key`}>
                    เฉลย
                  </a>
                  <a className="btn secondary small" href={`#/exams/${e.id}/print`}>
                    พิมพ์กระดาษ
                  </a>
                  <a className={`btn small ${missing ? 'disabled' : ''}`} href={missing ? undefined : `#/exams/${e.id}/scan`}>
                    สแกน
                  </a>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
