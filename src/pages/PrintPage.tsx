import { useState } from 'react'
import { studentsOf, useDB } from '../data/store'
import { examConfig, examSheetTexts } from '../lib/exam'
import { AnswerSheet } from '../sheet/AnswerSheet'

export function PrintPage({ examId }: { examId: string }) {
  const db = useDB()
  const exam = db.exams.find((e) => e.id === examId)
  const [mode, setMode] = useState<'blank' | 'named'>('blank')
  if (!exam) return <p>ไม่พบข้อสอบ</p>

  const students = studentsOf(db, exam.classroomId)
  const config = examConfig(exam)
  const texts = examSheetTexts(db, exam)
  const idOk = (code: string) => /^\d+$/.test(code) && code.length === exam.idDigits

  const print = async () => {
    await document.fonts.ready
    window.print()
  }

  return (
    <section>
      <div className="page-head no-print">
        <div>
          <a href={`#/exams/${exam.id}`} className="back">
            ← {exam.title}
          </a>
          <h1>พิมพ์กระดาษคำตอบ</h1>
        </div>
        <button className="btn" onClick={print}>
          พิมพ์ / บันทึกเป็น PDF
        </button>
      </div>

      <div className="card toolbar no-print">
        <div className="chips">
          <button className={`chip ${mode === 'blank' ? 'on' : ''}`} onClick={() => setMode('blank')}>
            แบบว่าง (นักเรียนฝนรหัสเอง)
          </button>
          <button className={`chip ${mode === 'named' ? 'on' : ''}`} onClick={() => setMode('named')} disabled={students.length === 0}>
            แยกรายคน {students.length} แผ่น (พิมพ์ชื่อและรหัสให้)
          </button>
        </div>
        <p className="hint">
          ตั้งค่าเครื่องพิมพ์: กระดาษ A4 · สเกล 100% (Actual size / ขนาดจริง) · ปิด Headers and footers
          {mode === 'blank' && ' · ใส่จำนวนสำเนาตามจำนวนนักเรียน'}
        </p>
      </div>

      <div className="print-sheets">
        {mode === 'blank' ? (
          <div className="paper">
            <AnswerSheet config={config} texts={texts} />
          </div>
        ) : (
          students.map((s) => (
            <div className="paper" key={s.id}>
              <AnswerSheet
                config={config}
                texts={{
                  ...texts,
                  studentName: s.name,
                  studentNumber: String(s.number),
                  prefillId: idOk(s.code) ? s.code : undefined,
                }}
              />
            </div>
          ))
        )}
      </div>
    </section>
  )
}
