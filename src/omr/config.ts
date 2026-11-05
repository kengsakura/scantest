/**
 * Answer-sheet configuration.
 *
 * Everything that affects the *geometry* of a sheet lives in `SheetConfig` and is
 * encoded into the QR code printed on the sheet, so a scanner can rebuild the exact
 * layout (see layout.ts) from the sheet alone. Free text printed on the sheet
 * (title, subject) lives in `SheetText` and never changes geometry.
 */

export type LabelStyle = 'thai' | 'latin' | 'number' | 'truefalse'

export interface SheetConfig {
  /** Number of questions, 1..MAX_QUESTIONS */
  questions: number
  /** Choices per question, 2..6 */
  choices: number
  /** How choices are labelled on the sheet (does not change geometry) */
  labelStyle: LabelStyle
  /** Digits of the bubbled student ID, 0 = no ID grid, otherwise 3..10 */
  idDigits: number
  /** Number of exam versions to bubble (ชุด ก ข ค ง), 0 = none, otherwise 2..4 */
  versions: number
  /** Short code identifying this exam/sheet design, [A-Z0-9]{6} */
  examCode: string
}

export interface SheetText {
  title: string
  subject: string
}

export const MAX_QUESTIONS = 200
export const MIN_CHOICES = 2
export const MAX_CHOICES = 6
export const MIN_ID_DIGITS = 3
export const MAX_ID_DIGITS = 10
export const MAX_VERSIONS = 4

export const LABELS: Record<LabelStyle, readonly string[]> = {
  thai: ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ'],
  latin: ['A', 'B', 'C', 'D', 'E', 'F'],
  number: ['1', '2', '3', '4', '5', '6'],
  truefalse: ['ถ', 'ผ'],
}

export const LABEL_STYLE_NAMES: Record<LabelStyle, string> = {
  thai: 'ก ข ค ง',
  latin: 'A B C D',
  number: '1 2 3 4',
  truefalse: 'ถูก / ผิด',
}

export function choiceLabels(cfg: Pick<SheetConfig, 'choices' | 'labelStyle'>): string[] {
  const style = cfg.labelStyle === 'truefalse' && cfg.choices !== 2 ? 'thai' : cfg.labelStyle
  return LABELS[style].slice(0, cfg.choices)
}

export function versionLabels(cfg: Pick<SheetConfig, 'versions' | 'labelStyle'>): string[] {
  const style = cfg.labelStyle === 'latin' || cfg.labelStyle === 'number' ? 'latin' : 'thai'
  return LABELS[style].slice(0, cfg.versions)
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function randomExamCode(length = 6): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

export const DEFAULT_CONFIG: SheetConfig = {
  questions: 30,
  choices: 4,
  labelStyle: 'thai',
  idDigits: 5,
  versions: 0,
  examCode: 'DEMO01',
}

export const DEFAULT_TEXT: SheetText = {
  title: 'กระดาษคำตอบ',
  subject: '',
}

export function validateConfig(cfg: SheetConfig): string | null {
  const int = Number.isInteger
  if (!int(cfg.questions) || cfg.questions < 1 || cfg.questions > MAX_QUESTIONS)
    return `จำนวนข้อต้องอยู่ระหว่าง 1–${MAX_QUESTIONS}`
  if (!int(cfg.choices) || cfg.choices < MIN_CHOICES || cfg.choices > MAX_CHOICES)
    return `จำนวนตัวเลือกต้องอยู่ระหว่าง ${MIN_CHOICES}–${MAX_CHOICES}`
  if (cfg.labelStyle === 'truefalse' && cfg.choices !== 2) return 'แบบถูก/ผิด ใช้ได้กับ 2 ตัวเลือกเท่านั้น'
  if (!int(cfg.idDigits) || (cfg.idDigits !== 0 && (cfg.idDigits < MIN_ID_DIGITS || cfg.idDigits > MAX_ID_DIGITS)))
    return `รหัสนักเรียนต้องเป็น 0 หรือ ${MIN_ID_DIGITS}–${MAX_ID_DIGITS} หลัก`
  if (!int(cfg.versions) || cfg.versions === 1 || cfg.versions < 0 || cfg.versions > MAX_VERSIONS)
    return `จำนวนชุดข้อสอบต้องเป็น 0 หรือ 2–${MAX_VERSIONS}`
  if (!/^[A-Z0-9]{6}$/.test(cfg.examCode)) return 'รหัสแบบต้องเป็นตัวอักษร A-Z หรือตัวเลข 6 ตัว'
  return null
}

/* ------------------------------------------------------------------ */
/* QR payload codec                                                    */
/* ------------------------------------------------------------------ */
/*
 * Format (QR alphanumeric charset only, so the QR stays small):
 *   OMR1.Q30.C4.LT.I5.V0.XAB12CD
 * Q = questions, C = choices, L = label style (T/A/N/F), I = ID digits,
 * V = versions, X = exam code.
 */

const STYLE_TO_CODE: Record<LabelStyle, string> = { thai: 'T', latin: 'A', number: 'N', truefalse: 'F' }
const CODE_TO_STYLE: Record<string, LabelStyle> = { T: 'thai', A: 'latin', N: 'number', F: 'truefalse' }

export const PAYLOAD_PREFIX = 'OMR1'

export function encodeConfig(cfg: SheetConfig): string {
  return [
    PAYLOAD_PREFIX,
    `Q${cfg.questions}`,
    `C${cfg.choices}`,
    `L${STYLE_TO_CODE[cfg.labelStyle]}`,
    `I${cfg.idDigits}`,
    `V${cfg.versions}`,
    `X${cfg.examCode}`,
  ].join('.')
}

export function decodeConfig(payload: string): SheetConfig | null {
  const parts = payload.trim().split('.')
  if (parts[0] !== PAYLOAD_PREFIX) return null
  const fields = new Map<string, string>()
  for (const p of parts.slice(1)) {
    if (p.length < 2) return null
    fields.set(p[0], p.slice(1))
  }
  const num = (k: string) => {
    const v = fields.get(k)
    return v !== undefined && /^\d+$/.test(v) ? Number(v) : NaN
  }
  const style = CODE_TO_STYLE[fields.get('L') ?? '']
  const examCode = fields.get('X') ?? ''
  if (!style) return null
  const cfg: SheetConfig = {
    questions: num('Q'),
    choices: num('C'),
    labelStyle: style,
    idDigits: num('I'),
    versions: num('V'),
    examCode,
  }
  return validateConfig(cfg) === null ? cfg : null
}
