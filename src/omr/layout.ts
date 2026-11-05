/**
 * Deterministic answer-sheet layout.
 *
 * `computeLayout(config)` returns the position of every printed element in
 * millimetres on an A4 page (origin top-left). The same function is used to draw
 * the sheet and (later) by the scanner to know where each bubble is, so the two
 * can never drift apart. Do not change constants without bumping the payload
 * version in config.ts — sheets already printed would no longer scan.
 */
import type { SheetConfig } from './config'
import { validateConfig } from './config'

export const PAGE_W = 210
export const PAGE_H = 297

/* Corner markers (solid squares) used to find and straighten the page. */
export const MARKER_SIZE = 7
export const MARKER_INSET = 9

/* Printable content bounds. */
const X0 = 12
const X1 = PAGE_W - 12
const HEADER_TOP = 21
const ANSWER_BOTTOM = PAGE_H - MARKER_INSET - MARKER_SIZE - 3 // keep clear of bottom markers

/* Header elements. */
const QR_SIZE = 20
const QR_CLEAR = 4
const ID_PITCH_X = 5.6
const ID_PITCH_Y = 4.9
const ID_R = 1.9
const ID_PAD = 1.8
const ID_LABEL_H = 5
const ID_BOX_H = 6
const FIELD_PITCH = 9
const VERSION_PITCH = 9
const VERSION_R = 2.2

/* Answer grid at scale 1. The grid is scaled as large as fits (up to MAX_SCALE) and shrinks together when space runs out. */
const BUBBLE_R = 2.5
const PITCH_X = 6.6
const ROW_PITCH = 7
const NUM_W = 9
const MIN_COL_GAP = 5
const MAX_COL_GAP = 16
const GROUP_SIZE = 5
const GROUP_GAP = 2
const COL_HEADER_H = 5.5
const MIN_SCALE = 0.7
const MAX_SCALE = 1.15
const SCALE_STEP = 0.025

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Bubble {
  cx: number
  cy: number
  r: number
}

export interface Marker extends Rect {
  /** Marker centre — the reference point used for perspective correction. */
  cx: number
  cy: number
}

export interface QuestionLayout {
  /** 1-based question number */
  n: number
  numberX: number
  numberY: number
  bubbles: Bubble[]
}

export interface AnswerColumn {
  x: number
  /** Baseline of the choice letters above the column */
  headerY: number
  /** Centre x of each choice in this column */
  choiceX: number[]
}

export interface Field {
  label: string
  x: number
  y: number
  lineX0: number
  lineX1: number
}

export interface SheetLayout {
  page: { w: number; h: number }
  /** Order: top-left, top-right, bottom-right, bottom-left */
  markers: [Marker, Marker, Marker, Marker]
  title: { x: number; y: number }
  /** Optional school line above the title, and where the title goes when it's shown */
  header: { x: number; y: number; titleY: number }
  /** Optional school logo, kept clear of the top-left marker */
  logo: Rect
  qr: Rect
  fields: Field[]
  studentId: null | {
    frame: Rect
    labelX: number
    labelY: number
    boxes: Rect[]
    /** digits[d][v] = bubble for value v (0-9) in digit column d */
    digits: Bubble[][]
  }
  version: null | {
    labelX: number
    labelY: number
    bubbles: Bubble[]
  }
  separatorY: number
  instructionY: number
  answer: {
    area: Rect
    scale: number
    rowsPerColumn: number
    columns: AnswerColumn[]
    questions: QuestionLayout[]
    bubbleR: number
    fontSize: number
  }
  footerY: number
}

export type LayoutResult = { ok: true; layout: SheetLayout } | { ok: false; error: string }

function markers(): [Marker, Marker, Marker, Marker] {
  const s = MARKER_SIZE
  const left = MARKER_INSET
  const right = PAGE_W - MARKER_INSET - s
  const top = MARKER_INSET
  const bottom = PAGE_H - MARKER_INSET - s
  const m = (x: number, y: number): Marker => ({ x, y, w: s, h: s, cx: x + s / 2, cy: y + s / 2 })
  return [m(left, top), m(right, top), m(right, bottom), m(left, bottom)]
}

function rowsHeight(rows: number, scale: number): number {
  const groups = Math.ceil(rows / GROUP_SIZE)
  return (COL_HEADER_H + rows * ROW_PITCH + Math.max(0, groups - 1) * GROUP_GAP) * scale
}

function columnWidth(choices: number, scale: number): number {
  return (NUM_W + choices * PITCH_X) * scale
}

/**
 * Pick the largest scale (then fewest columns) at which every question fits.
 * First try to keep columns short (at most PREFERRED_ROWS) without shrinking
 * bubbles below full size, which spreads 20-60 question sheets over the page.
 */
function fitGrid(questions: number, choices: number, area: Rect) {
  const PREFERRED_ROWS = 15
  const passes = [
    { minScale: 1, maxRows: PREFERRED_ROWS },
    { minScale: MIN_SCALE, maxRows: Infinity },
  ]
  for (const pass of passes) {
    for (let i = 0; ; i++) {
      const scale = Math.round((MAX_SCALE - i * SCALE_STEP) * 1000) / 1000
      if (scale < pass.minScale - 1e-9) break
      for (let cols = 1; cols <= questions; cols++) {
        const rows = Math.ceil(questions / cols)
        const width = cols * columnWidth(choices, scale) + (cols - 1) * MIN_COL_GAP * scale
        if (width > area.w + 1e-9) break // more columns only gets wider
        if (rows <= pass.maxRows && rowsHeight(rows, scale) <= area.h + 1e-9) return { scale, cols, rows }
      }
    }
  }
  return null
}

export function computeLayout(cfg: SheetConfig): LayoutResult {
  const invalid = validateConfig(cfg)
  if (invalid) return { ok: false, error: invalid }

  /* ---- Header, laid out right-to-left: ID grid, QR, then text fields ---- */
  let rightEdge = X1
  let headerBottom = HEADER_TOP

  let studentId: SheetLayout['studentId'] = null
  if (cfg.idDigits > 0) {
    const w = cfg.idDigits * ID_PITCH_X + ID_PAD * 2
    const h = ID_LABEL_H + ID_BOX_H + 1 + 10 * ID_PITCH_Y + ID_PAD
    const frame: Rect = { x: X1 - w, y: HEADER_TOP, w, h }
    const innerX = frame.x + ID_PAD
    const boxY = frame.y + ID_LABEL_H
    const firstRow = boxY + ID_BOX_H + 1 + ID_PITCH_Y / 2
    const boxes: Rect[] = []
    const digits: Bubble[][] = []
    for (let d = 0; d < cfg.idDigits; d++) {
      const cx = innerX + d * ID_PITCH_X + ID_PITCH_X / 2
      boxes.push({ x: cx - ID_PITCH_X / 2 + 0.3, y: boxY, w: ID_PITCH_X - 0.6, h: ID_BOX_H })
      const col: Bubble[] = []
      for (let v = 0; v < 10; v++) col.push({ cx, cy: firstRow + v * ID_PITCH_Y, r: ID_R })
      digits.push(col)
    }
    studentId = { frame, labelX: frame.x + w / 2, labelY: frame.y + 3.6, boxes, digits }
    rightEdge = frame.x - QR_CLEAR
    headerBottom = Math.max(headerBottom, frame.y + h)
  }

  const qr: Rect = { x: rightEdge - QR_SIZE, y: HEADER_TOP, w: QR_SIZE, h: QR_SIZE }
  headerBottom = Math.max(headerBottom, qr.y + qr.h + 5) // + exam code text under the QR
  const fieldsRight = qr.x - QR_CLEAR

  const fieldLabels = ['ชื่อ-สกุล', 'ชั้น/ห้อง', 'วิชา', 'วันที่สอบ']
  const fields: Field[] = fieldLabels.map((label, i) => {
    const y = HEADER_TOP + 6 + i * FIELD_PITCH
    return { label, x: X0, y, lineX0: X0 + 17, lineX1: fieldsRight }
  })
  // "เลขที่" shares the line with "ชั้น/ห้อง"
  const classLine = fields[1]
  const split = classLine.lineX0 + (classLine.lineX1 - classLine.lineX0) * 0.55
  fields.splice(2, 0, { label: 'เลขที่', x: split + 2, y: classLine.y, lineX0: split + 13, lineX1: classLine.lineX1 })
  classLine.lineX1 = split
  let fieldsBottom = HEADER_TOP + 6 + (fieldLabels.length - 1) * FIELD_PITCH + 3

  let version: SheetLayout['version'] = null
  if (cfg.versions > 0) {
    const y = fieldsBottom + 6
    const bubbles: Bubble[] = []
    for (let v = 0; v < cfg.versions; v++)
      bubbles.push({ cx: X0 + 26 + v * VERSION_PITCH, cy: y, r: VERSION_R })
    version = { labelX: X0, labelY: y + 1.3, bubbles }
    fieldsBottom = y + VERSION_R + 1
  }
  headerBottom = Math.max(headerBottom, fieldsBottom)

  const separatorY = headerBottom + 3
  const instructionY = separatorY + 4.5

  /* ---- Answer grid ---- */
  const area: Rect = { x: X0, y: instructionY + 3, w: X1 - X0, h: 0 }
  area.h = ANSWER_BOTTOM - area.y
  const fit = fitGrid(cfg.questions, cfg.choices, area)
  if (!fit) {
    return { ok: false, error: `${cfg.questions} ข้อ × ${cfg.choices} ตัวเลือก ใส่ในหน้าเดียวไม่ได้ ลองลดจำนวนข้อ ตัวเลือก หรือหลักรหัสนักเรียน` }
  }
  const { scale, cols, rows } = fit
  const colW = columnWidth(cfg.choices, scale)
  const gap =
    cols > 1 ? Math.min(MAX_COL_GAP * scale, (area.w - cols * colW) / (cols - 1)) : 0
  const gridW = cols * colW + (cols - 1) * gap
  const left = area.x + (area.w - gridW) / 2

  const columns: AnswerColumn[] = []
  for (let c = 0; c < cols; c++) {
    const x = left + c * (colW + gap)
    const choiceX = Array.from(
      { length: cfg.choices },
      (_, k) => x + (NUM_W + k * PITCH_X + PITCH_X / 2) * scale,
    )
    columns.push({ x, headerY: area.y + COL_HEADER_H * scale * 0.7, choiceX })
  }

  const questions: QuestionLayout[] = []
  const bubbleR = BUBBLE_R * scale
  for (let q = 0; q < cfg.questions; q++) {
    const col = columns[Math.floor(q / rows)]
    const row = q % rows
    const cy =
      area.y +
      (COL_HEADER_H + row * ROW_PITCH + ROW_PITCH / 2 + Math.floor(row / GROUP_SIZE) * GROUP_GAP) * scale
    questions.push({
      n: q + 1,
      numberX: col.x + (NUM_W - 1.8) * scale,
      numberY: cy,
      bubbles: col.choiceX.map((cx) => ({ cx, cy, r: bubbleR })),
    })
  }

  return {
    ok: true,
    layout: {
      page: { w: PAGE_W, h: PAGE_H },
      markers: markers(),
      title: { x: PAGE_W / 2, y: MARKER_INSET + MARKER_SIZE / 2 },
      header: { x: PAGE_W / 2, y: 10.4, titleY: 16.2 },
      logo: { x: 22, y: 6.5, w: 11, h: 11 },
      qr,
      fields,
      studentId,
      version,
      separatorY,
      instructionY,
      answer: {
        area,
        scale,
        rowsPerColumn: rows,
        columns,
        questions,
        bubbleR,
        fontSize: 3.4 * scale,
      },
      footerY: PAGE_H - MARKER_INSET - MARKER_SIZE / 2,
    },
  }
}

/** Largest number of questions that fits on one page with the other settings unchanged. */
export function maxQuestionsFor(cfg: SheetConfig, limit = 200): number {
  let lo = 0
  let hi = limit
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (computeLayout({ ...cfg, questions: mid }).ok) lo = mid
    else hi = mid - 1
  }
  return lo
}
