import type { QuestionStatus } from '../omr/grading'

const TEXT: Record<QuestionStatus, string> = {
  correct: 'ถูก',
  wrong: 'ผิด',
  blank: 'ไม่ตอบ',
  multiple: 'ฝนหลายคำตอบ',
  free: 'ข้อฟรี',
}

export function GradeStrip({ status }: { status: QuestionStatus[] }) {
  const count = (s: QuestionStatus) => status.filter((x) => x === s).length
  return (
    <div className="grade-strip">
      <div className="cells">
        {status.map((s, i) => (
          <span key={i} className={`cell ${s}`} title={`ข้อ ${i + 1}: ${TEXT[s]}`}>
            {i + 1}
          </span>
        ))}
      </div>
      <div className="legend small">
        <span className="cell correct" /> ถูก {count('correct')}
        <span className="cell wrong" /> ผิด {count('wrong')}
        {count('multiple') > 0 && (
          <>
            <span className="cell multiple" /> ฝนหลายคำตอบ {count('multiple')}
          </>
        )}
        {count('blank') > 0 && (
          <>
            <span className="cell blank" /> ไม่ตอบ {count('blank')}
          </>
        )}
        {count('free') > 0 && (
          <>
            <span className="cell free" /> ฟรี {count('free')}
          </>
        )}
      </div>
    </div>
  )
}
