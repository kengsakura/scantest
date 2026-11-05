import { useState } from 'react'
import { updateSettings, useDB } from '../../data/store'
import { MAX_ID_DIGITS, MIN_ID_DIGITS } from '../../omr/config'
import { AnswerSheet } from '../../sheet/AnswerSheet'

/** Shrink an uploaded logo to at most 256 px so it stays small in the database. */
async function logoDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * s))
  canvas.height = Math.max(1, Math.round(bmp.height * s))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const png = canvas.toDataURL('image/png')
  // photos compress far better as JPEG; keep PNG for small/transparent logos
  return png.length > 90_000 ? canvas.toDataURL('image/jpeg', 0.85) : png
}

export function SettingsTab() {
  const db = useDB()
  const s = db.settings
  const [schoolName, setSchoolName] = useState(s.schoolName)
  const [header, setHeader] = useState(s.sheetHeader)
  const [err, setErr] = useState('')
  const wrongLength = db.students.filter((x) => x.code.length !== s.idDigits).length

  return (
    <div className="split">
      <div className="card form">
        <h2>ตั้งค่าโรงเรียน</h2>
        <label>
          ชื่อโรงเรียน
          <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} onBlur={() => schoolName.trim() && schoolName !== s.schoolName && updateSettings({ schoolName: schoolName.trim() })} />
        </label>
        <label>
          ข้อความหัวกระดาษคำตอบ (เหนือชื่อข้อสอบ)
          <input
            value={header}
            onChange={(e) => setHeader(e.target.value)}
            onBlur={() => header !== s.sheetHeader && updateSettings({ sheetHeader: header.trim() })}
            placeholder="เช่น โรงเรียนของฉัน สพม.เขต 1 (เว้นว่าง = ไม่พิมพ์)"
          />
        </label>
        <fieldset>
          <legend>โลโก้บนกระดาษคำตอบ</legend>
          <div className="inline-fields">
            {s.logo && <img src={s.logo} alt="โลโก้โรงเรียน" className="logo-preview" />}
            <label className="btn secondary small">
              {s.logo ? 'เปลี่ยนโลโก้…' : 'อัปโหลดโลโก้…'}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  try {
                    updateSettings({ logo: await logoDataUrl(file) })
                    setErr('')
                  } catch {
                    setErr('เปิดรูปนี้ไม่ได้ ลองไฟล์ PNG หรือ JPG')
                  }
                }}
              />
            </label>
            {s.logo && (
              <button className="btn ghost small danger" onClick={() => updateSettings({ logo: null })}>
                ไม่ใช้โลโก้
              </button>
            )}
          </div>
          <span className="hint">พิมพ์มุมซ้ายบน ขนาดประมาณ 1 ซม. รูปที่พื้นหลังโปร่งใสหรือสีขาวจะดูดีที่สุด</span>
          {err && <span className="hint warn">{err}</span>}
        </fieldset>
        <label>
          จำนวนหลักของเลขประจำตัวนักเรียน
          <select value={s.idDigits} onChange={(e) => updateSettings({ idDigits: Number(e.target.value) })}>
            {Array.from({ length: MAX_ID_DIGITS - MIN_ID_DIGITS + 1 }, (_, i) => i + MIN_ID_DIGITS).map((n) => (
              <option key={n} value={n}>
                {n} หลัก
              </option>
            ))}
          </select>
          <span className="hint">มีผลกับข้อสอบที่สร้างใหม่ ข้อสอบเดิมใช้รูปแบบกระดาษเดิม</span>
          {wrongLength > 0 && <span className="hint warn">นักเรียน {wrongLength} คน (ในภาคเรียนที่ดูอยู่) มีเลขประจำตัวไม่ใช่ {s.idDigits} หลัก จะจับคู่กับกระดาษไม่ได้</span>}
        </label>
      </div>
      <div className="preview">
        <div className="preview-label muted small">ตัวอย่างหัวกระดาษ</div>
        <div className="paper">
          <AnswerSheet
            config={{ questions: 20, choices: 4, labelStyle: 'thai', idDigits: s.idDigits, versions: 0, examCode: 'XXXXXX' }}
            texts={{ title: 'สอบกลางภาค วิชาตัวอย่าง', classroom: 'ม.1/1', header: header || undefined, logo: s.logo, footer: s.schoolName }}
          />
        </div>
      </div>
    </div>
  )
}
