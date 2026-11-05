/**
 * Renders a synthetic "photo" of a filled-in answer sheet for tests: the sheet is
 * drawn through a perspective transform with uneven lighting and noise.
 * Only geometry that matters for scanning is drawn (markers, QR, bubble outlines,
 * filled marks); text is approximated with a few dark strokes.
 */
import type { SheetConfig } from './config'
import { encodeConfig } from './config'
import { applyHomography, solveHomography, type Pt } from './homography'
import { computeLayout, PAGE_H, PAGE_W, type Bubble } from './layout'
import { qrMatrix } from './qr'
import type { GrayImage } from './scanner'

export interface SyntheticOptions {
  width: number
  height: number
  /** Where the page corners (TL, TR, BR, BL of the paper) land in the image */
  pageCorners: Pt[]
  /** Marks per question (choice indexes) */
  answers: number[][]
  studentId?: string
  /** Darkness of pencil marks 0..1 */
  markDarkness?: number
  /** Light fill (e.g. a half-erased mark): question index -> choice -> darkness */
  faint?: { q: number; c: number; d: number }[]
  noise?: number
  seed?: number
}

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

export function renderSynthetic(cfg: SheetConfig, o: SyntheticOptions): GrayImage {
  const res = computeLayout(cfg)
  if (!res.ok) throw new Error(res.error)
  const L = res.layout
  const page: Pt[] = [
    { x: 0, y: 0 },
    { x: PAGE_W, y: 0 },
    { x: PAGE_W, y: PAGE_H },
    { x: 0, y: PAGE_H },
  ]
  const toMm = solveHomography(o.pageCorners, page)!
  const qr = qrMatrix(encodeConfig(cfg))
  const qn = qr.length
  const mark = o.markDarkness ?? 0.85

  const filled: { b: Bubble; d: number }[] = []
  L.answer.questions.forEach((q, i) => (o.answers[i] ?? []).forEach((c) => filled.push({ b: q.bubbles[c], d: mark })))
  for (const f of o.faint ?? []) filled.push({ b: L.answer.questions[f.q].bubbles[f.c], d: f.d })
  if (o.studentId && L.studentId) {
    ;[...o.studentId].forEach((ch, d) => filled.push({ b: L.studentId!.digits[d][Number(ch)], d: mark }))
  }
  const outlines: Bubble[] = [
    ...L.answer.questions.flatMap((q) => q.bubbles),
    ...(L.studentId?.digits.flat() ?? []),
    ...(L.version?.bubbles ?? []),
  ]

  // bucket bubbles into a 5mm grid so each pixel only checks nearby ones
  const CELL = 5
  const cols = Math.ceil(PAGE_W / CELL) + 1
  const buckets = new Map<number, { b: Bubble; d: number | null }[]>()
  const add = (b: Bubble, d: number | null) => {
    for (let gx = Math.floor((b.cx - b.r - 1) / CELL); gx <= Math.floor((b.cx + b.r + 1) / CELL); gx++)
      for (let gy = Math.floor((b.cy - b.r - 1) / CELL); gy <= Math.floor((b.cy + b.r + 1) / CELL); gy++) {
        const k = gy * cols + gx
        if (!buckets.has(k)) buckets.set(k, [])
        buckets.get(k)!.push({ b, d })
      }
  }
  filled.forEach((f) => add(f.b, f.d))
  outlines.forEach((b) => add(b, null))

  // ink value 0 = white paper, 1 = black, at a point on the page in mm
  const ink = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x > PAGE_W || y > PAGE_H) return -1 // background
    for (const m of L.markers) if (x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h) return 1
    const q = L.qr
    if (x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h) {
      const c = Math.floor(((x - q.x) / q.w) * qn)
      const r = Math.floor(((y - q.y) / q.h) * qn)
      return qr[r][c] ? 1 : 0
    }
    const near = buckets.get(Math.floor(y / CELL) * cols + Math.floor(x / CELL)) ?? []
    let v = 0
    for (const f of near) {
      if (f.d === null) continue
      const dist = Math.hypot(x - f.b.cx, y - f.b.cy)
      if (dist <= f.b.r * 1.05) v = Math.max(v, f.d)
    }
    if (v) return v
    for (const { b, d } of near) {
      if (d !== null) continue
      const dist = Math.hypot(x - b.cx, y - b.cy)
      if (Math.abs(dist - b.r) < 0.15) return 0.55
      if (dist < b.r * 0.35) return 0.25 // the light grey label inside the bubble
    }
    for (const f of L.fields) if (Math.abs(y - f.y - 1) < 0.15 && x >= f.lineX0 && x <= f.lineX1) return 0.8
    if (Math.abs(y - L.separatorY) < 0.15 && x > 12 && x < 198) return 0.8
    for (const qq of L.answer.questions) {
      // question number "text"
      if (Math.abs(y - qq.numberY) < 1.1 && x > qq.numberX - 3 && x < qq.numberX && Math.floor(x * 3) % 2 === 0) return 0.9
    }
    return 0
  }

  const rand = rng(o.seed ?? 7)
  const noise = o.noise ?? 6
  const data = new Uint8Array(o.width * o.height)
  const ss = [0.25, 0.75]
  for (let py = 0; py < o.height; py++) {
    for (let px = 0; px < o.width; px++) {
      let acc = 0
      for (const sy of ss)
        for (const sx of ss) {
          const p = applyHomography(toMm, px + sx, py + sy)
          const k = ink(p.x, p.y)
          // lighting: brighter at top-left, darker bottom-right (shadow)
          const light = 235 - 60 * (px / o.width) * (py / o.height)
          acc += k < 0 ? 70 : light * (1 - k * 0.92)
        }
      const v = acc / 4 + (rand() - 0.5) * 2 * noise
      data[py * o.width + px] = Math.max(0, Math.min(255, Math.round(v)))
    }
  }
  return { width: o.width, height: o.height, data }
}
