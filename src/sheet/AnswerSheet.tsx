import { useMemo } from 'react'
import { choiceLabels, encodeConfig, versionLabels, type SheetConfig } from '../omr/config'
import { computeLayout, PAGE_H, PAGE_W } from '../omr/layout'
import { qrMatrix, qrPath } from '../omr/qr'

export interface SheetTexts {
  title: string
  classroom?: string
  footer?: string
  /** Pre-printed student (personalised sheets) */
  studentName?: string
  studentNumber?: string
  /** Student ID to print already bubbled in */
  prefillId?: string
  /** School line above the title */
  header?: string
  /** School logo (image data URL) */
  logo?: string | null
}

/** Rough printed width (mm) of a line: Thai vowel/tone marks take no width. */
function textWidth(text: string, fontSize: number): number {
  const base = text.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '')
  return base.length * fontSize * 0.5
}

/** Squeeze a line into maxWidth mm if it would be wider. */
function fit(text: string, fontSize: number, maxWidth: number) {
  return textWidth(text, fontSize) > maxWidth ? { textLength: maxWidth, lengthAdjust: 'spacingAndGlyphs' as const } : {}
}

const FONT = "'Sarabun', 'Noto Sans Thai', sans-serif"
const INK = '#111'
const BUBBLE = '#666'
const LABEL = '#a3a3a3'
const GOOD = '#16a34a'
const BAD = '#dc2626'

export interface SheetMarks {
  /** Marked choices per question */
  answers: number[][]
  /** Correct choice per question (null = not set) and free questions, to colour marks */
  key?: { answers: (number | null)[]; free: boolean[] }
}

export function AnswerSheet({
  config,
  texts,
  className,
  marks,
  onBubbleClick,
}: {
  config: SheetConfig
  texts: SheetTexts
  className?: string
  /** Draw a graded paper: student's marks filled, green = correct, red = wrong */
  marks?: SheetMarks
  onBubbleClick?: (question: number, choice: number) => void
}) {
  const res = useMemo(() => computeLayout(config), [config])
  const qr = useMemo(() => qrMatrix(encodeConfig(config)), [config])
  if (!res.ok) return <div className="sheet-error">{res.error}</div>
  const L = res.layout
  const labels = choiceLabels(config)
  const vLabels = versionLabels(config)
  const fs = L.answer.fontSize
  const fieldValue: Record<string, string | undefined> = {
    'ชื่อ-สกุล': texts.studentName,
    'ชั้น/ห้อง': texts.classroom,
    เลขที่: texts.studentNumber,
  }

  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
      width={`${PAGE_W}mm`}
      height={`${PAGE_H}mm`}
      fontFamily={FONT}
      role="img"
      aria-label={`กระดาษคำตอบ ${texts.title}`}
    >
      <rect width={PAGE_W} height={PAGE_H} fill="#fff" />
      {L.markers.map((m, i) => (
        <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} fill="#000" />
      ))}

      {texts.logo && (
        <image href={texts.logo} x={L.logo.x} y={L.logo.y} width={L.logo.w} height={L.logo.h} preserveAspectRatio="xMidYMid meet" />
      )}
      {texts.header ? (
        <>
          <text x={L.header.x} y={L.header.y} textAnchor="middle" fontSize={3.4} fontWeight={600} fill="#333" {...fit(texts.header, 3.4, 140)}>
            {texts.header}
          </text>
          <text x={L.title.x} y={L.header.titleY} textAnchor="middle" fontSize={4.8} fontWeight={700} fill={INK} {...fit(texts.title, 4.8, 140)}>
            {texts.title}
          </text>
        </>
      ) : (
        <text x={L.title.x} y={L.title.y + 1.9} textAnchor="middle" fontSize={5.2} fontWeight={700} fill={INK} {...fit(texts.title, 5.2, 140)}>
          {texts.title}
        </text>
      )}

      {/* text fields */}
      {L.fields.map((f) => (
        <g key={f.label}>
          <text x={f.x} y={f.y} fontSize={3.4} fill={INK}>
            {f.label}
          </text>
          <line x1={f.lineX0} x2={f.lineX1} y1={f.y + 1} y2={f.y + 1} stroke="#555" strokeWidth={0.2} strokeDasharray="0.6 0.6" />
          {fieldValue[f.label] && (
            <text x={f.lineX0 + 1.5} y={f.y - 0.2} fontSize={3.6} fontWeight={600} fill={INK}>
              {fieldValue[f.label]}
            </text>
          )}
        </g>
      ))}

      {/* QR with the sheet layout + exam code */}
      <path d={qrPath(qr, L.qr.x, L.qr.y, L.qr.w)} fill="#000" />
      <text x={L.qr.x + L.qr.w / 2} y={L.qr.y + L.qr.h + 3.4} textAnchor="middle" fontSize={2.8} fill="#444" letterSpacing={0.3}>
        {config.examCode}
      </text>

      {/* student ID grid */}
      {L.studentId && (
        <g>
          <rect
            x={L.studentId.frame.x}
            y={L.studentId.frame.y}
            width={L.studentId.frame.w}
            height={L.studentId.frame.h}
            rx={1.5}
            fill="none"
            stroke="#444"
            strokeWidth={0.3}
          />
          <text x={L.studentId.labelX} y={L.studentId.labelY} textAnchor="middle" fontSize={3} fontWeight={700} fill={INK}>
            รหัสนักเรียน
          </text>
          {L.studentId.boxes.map((b, i) => (
            <g key={i}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#666" strokeWidth={0.2} />
              {texts.prefillId?.[i] && (
                <text x={b.x + b.w / 2} y={b.y + b.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={3.6} fontWeight={700} fill={INK}>
                  {texts.prefillId[i]}
                </text>
              )}
            </g>
          ))}
          {L.studentId.digits.map((col, d) =>
            col.map((b, v) => (
              <g key={`${d}-${v}`}>
                <circle cx={b.cx} cy={b.cy} r={b.r} fill={texts.prefillId?.[d] === String(v) ? '#000' : 'none'} stroke={BUBBLE} strokeWidth={0.22} />
                <text x={b.cx} y={b.cy} textAnchor="middle" dominantBaseline="central" fontSize={b.r * 1.15} fill={LABEL}>
                  {v}
                </text>
              </g>
            )),
          )}
        </g>
      )}

      {/* exam version */}
      {L.version && (
        <g>
          <text x={L.version.labelX} y={L.version.labelY} fontSize={3.4} fill={INK}>
            ชุดข้อสอบ
          </text>
          {L.version.bubbles.map((b, i) => (
            <g key={i}>
              <circle cx={b.cx} cy={b.cy} r={b.r} fill="none" stroke={BUBBLE} strokeWidth={0.25} />
              <text x={b.cx} y={b.cy} textAnchor="middle" dominantBaseline="central" fontSize={b.r * 1.15} fill={LABEL}>
                {vLabels[i]}
              </text>
            </g>
          ))}
        </g>
      )}

      <line x1={12} x2={PAGE_W - 12} y1={L.separatorY} y2={L.separatorY} stroke="#333" strokeWidth={0.3} />
      <text x={12} y={L.instructionY} fontSize={2.9} fill="#333">
        ใช้ดินสอ 2B ฝนให้เต็มวง
        <tspan dx={1}>●</tspan>
        <tspan dx={1}>ตอบข้อละ 1 คำตอบเท่านั้น (ฝนเกิน 1 วงถือว่าผิด) ถ้าเปลี่ยนคำตอบให้ลบให้สะอาด ห้ามขีดเขียนที่สี่เหลี่ยมมุมกระดาษ</tspan>
      </text>

      {/* answer grid */}
      {L.answer.columns.map((c, ci) =>
        c.choiceX.map((x, k) => (
          <text key={`h${ci}-${k}`} x={x} y={c.headerY} textAnchor="middle" fontSize={fs * 0.95} fontWeight={700} fill="#333">
            {labels[k]}
          </text>
        )),
      )}
      {L.answer.questions.map((q) => (
        <g key={q.n}>
          <text x={q.numberX} y={q.numberY} textAnchor="end" dominantBaseline="central" fontSize={fs} fontWeight={700} fill={INK}>
            {q.n}
          </text>
          {q.bubbles.map((b, k) => {
            const i = q.n - 1
            const marked = marks?.answers[i]?.includes(k) ?? false
            const correct = marks?.key?.answers[i] === k
            const free = marks?.key?.free[i] ?? false
            const single = (marks?.answers[i]?.length ?? 0) === 1
            const ring = !marks?.key
              ? null
              : marked
                ? free || (correct && single)
                  ? GOOD
                  : BAD
                : correct && !free
                  ? GOOD
                  : null
            return (
              <g
                key={k}
                onClick={onBubbleClick ? () => onBubbleClick(i, k) : undefined}
                style={onBubbleClick ? { cursor: 'pointer' } : undefined}
              >
                <circle cx={b.cx} cy={b.cy} r={b.r} fill={marked ? '#3a3a3a' : '#fff'} stroke={BUBBLE} strokeWidth={0.25 * L.answer.scale} />
                {!marked && (
                  <text x={b.cx} y={b.cy} textAnchor="middle" dominantBaseline="central" fontSize={b.r * 1.05} fill={LABEL}>
                    {labels[k]}
                  </text>
                )}
                {ring && (
                  <circle
                    cx={b.cx}
                    cy={b.cy}
                    r={b.r + 0.55}
                    fill="none"
                    stroke={ring}
                    strokeWidth={0.7}
                    strokeDasharray={marked ? undefined : '1 0.7'}
                  />
                )}
              </g>
            )
          })}
        </g>
      ))}

      {texts.footer && (
        <text x={PAGE_W / 2} y={L.footerY + 1} textAnchor="middle" fontSize={2.6} fill="#666">
          {texts.footer}
        </text>
      )}
    </svg>
  )
}
