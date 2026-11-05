import { scansOf, useDB, useExamScans } from '../data/store'
import { formatScore } from '../lib/exam'
import { choiceLabels } from '../omr/config'
import { analyse } from '../lib/analysis'

function difficulty(p: number): string {
  if (p >= 0.8) return 'ง่ายมาก'
  if (p >= 0.6) return 'ค่อนข้างง่าย'
  if (p >= 0.4) return 'ปานกลาง'
  if (p >= 0.2) return 'ค่อนข้างยาก'
  return 'ยากมาก'
}

function dClass(d: number): string {
  return d >= 0.4 ? 'good' : d >= 0.2 ? 'ok' : 'bad'
}

const r2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2)

export function AnalysisPage({ examId }: { examId: string }) {
  const db = useDB()
  useExamScans(examId)
  const exam = db.exams.find((e) => e.id === examId)
  if (!exam) return <p>ไม่พบข้อสอบ</p>

  const scans = scansOf(db, exam.id)
  const labels = choiceLabels(exam.sheet)
  const s = analyse(
    scans.map((x) => x.answers),
    exam.key,
    exam.sheet.choices,
  )

  return (
    <section>
      <div className="page-head">
        <div>
          <a href={`#/exams/${exam.id}`} className="back">
            ← ผลสอบ {exam.title}
          </a>
          <h1>วิเคราะห์ข้อสอบ</h1>
          <p className="muted">จาก {s.n} แผ่น</p>
        </div>
      </div>

      {s.n === 0 ? (
        <div className="card empty muted">ยังไม่มีผลสแกน</div>
      ) : (
        <>
          <div className="stats">
            <div className="card stat">
              <span className="muted small">เฉลี่ย ± SD</span>
              <strong>
                {formatScore(Math.round(s.mean * 100) / 100)}
                <small> ± {r2(s.sd)}</small>
              </strong>
            </div>
            <div className="card stat">
              <span className="muted small">สูงสุด / ต่ำสุด</span>
              <strong>
                {formatScore(s.max)}
                <small> / {formatScore(s.min)}</small>
              </strong>
            </div>
            <div className="card stat">
              <span className="muted small">ความเชื่อมั่น (KR-20)</span>
              <strong>{s.kr20 === null ? '–' : r2(s.kr20)}</strong>
            </div>
            <div className="card stat">
              <span className="muted small">ข้อที่ควรปรับปรุง (r &lt; 0.2)</span>
              <strong>{s.items.filter((it, i) => !exam.key.free[i] && it.d < 0.2).length}</strong>
            </div>
          </div>

          <div className="card table-card">
            <table className="table analysis">
              <thead>
                <tr>
                  <th>ข้อ</th>
                  <th className="num">ถูก</th>
                  <th>จำนวนที่เลือกแต่ละตัวเลือก</th>
                  <th className="num" title="ค่าอำนาจจำแนก: กลุ่มเก่ง 27% ตอบถูกมากกว่ากลุ่มอ่อน 27% เท่าไร">
                    r
                  </th>
                  <th className="num hide-sm">คะแนน</th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((it, i) => {
                  const keyAns = exam.key.answers[i]
                  const top = Math.max(1, ...it.counts, it.blank, it.multiple)
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td className="num">
                        <strong>{Math.round(it.p * 100)}%</strong>
                        <div className="muted small">{exam.key.free[i] ? 'ข้อฟรี' : difficulty(it.p)}</div>
                      </td>
                      <td>
                        <div className="freq">
                          {it.counts.map((c, k) => (
                            <div key={k} className={`freq-col ${k === keyAns ? 'key' : ''}`}>
                              <div className="bar" style={{ height: `${(c / top) * 100}%` }} />
                              <b>{labels[k]}</b>
                              <span>{c}</span>
                            </div>
                          ))}
                          {(it.blank > 0 || it.multiple > 0) && (
                            <div className="freq-extra muted small">
                              {it.blank > 0 && <div>ไม่ตอบ {it.blank}</div>}
                              {it.multiple > 0 && <div>ฝนหลาย {it.multiple}</div>}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className={`num mark ${exam.key.free[i] ? '' : dClass(it.d)}`}>{exam.key.free[i] ? '–' : r2(it.d)}</td>
                      <td className="num hide-sm">{formatScore(exam.key.points[i])}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">
            สีเขียว = ตัวเลือกที่ถูก · r ≥ 0.40 ดีมาก, 0.20–0.39 พอใช้, ต่ำกว่า 0.20 ควรปรับปรุง (ถ้าติดลบ ให้ตรวจเฉลยข้อนั้น) · KR-20 ตั้งแต่
            0.70 ขึ้นไปถือว่าเชื่อถือได้
          </p>
        </>
      )}
    </section>
  )
}
