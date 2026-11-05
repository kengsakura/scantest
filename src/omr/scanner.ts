/**
 * Answer-sheet reader. Pure TypeScript, no OpenCV: works in the browser, in a worker
 * and in Node tests.
 *
 * Pipeline: grayscale -> adaptive threshold -> connected components -> pick the
 * four solid corner markers -> homography (sheet mm -> image px) -> decode QR to
 * learn the sheet layout and orientation -> measure darkness inside each bubble.
 */
import jsQR from 'jsqr'
import type { SheetConfig } from './config'
import { decodeConfig } from './config'
import { applyHomography, solveHomography, type Homography, type Pt } from './homography'
import { computeLayout, MARKER_SIZE, type Bubble, type SheetLayout } from './layout'

export interface GrayImage {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height)
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8
  }
  return { width, height, data }
}

/* ------------------------------------------------------------------ */
/* Marker detection                                                    */
/* ------------------------------------------------------------------ */

interface Blob {
  area: number
  cx: number
  cy: number
  w: number
  h: number
}

function adaptiveThreshold(img: GrayImage): Uint8Array {
  const { width: w, height: h, data } = img
  const integral = new Uint32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x]
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum
    }
  }
  const half = Math.max(7, Math.round(Math.min(w, h) / 16))
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(h, y + half + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(w, x + half + 1)
      const sum =
        integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      // dark if clearly below the local mean (Bradley-Roth)
      if (data[y * w + x] < mean * 0.8 && data[y * w + x] < 160) out[y * w + x] = 1
    }
  }
  return out
}

function findBlobs(bin: Uint8Array, w: number, h: number): Blob[] {
  const labels = new Int32Array(w * h)
  const stack = new Int32Array(w * h)
  const blobs: Blob[] = []
  let next = 1
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || labels[start]) continue
    let sp = 0
    stack[sp++] = start
    labels[start] = next
    let area = 0
    let sx = 0
    let sy = 0
    let minX = w
    let maxX = 0
    let minY = h
    let maxY = 0
    while (sp > 0) {
      const p = stack[--sp]
      const x = p % w
      const y = (p - x) / w
      area++
      sx += x
      sy += y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && bin[p - 1] && !labels[p - 1]) {
        labels[p - 1] = next
        stack[sp++] = p - 1
      }
      if (x < w - 1 && bin[p + 1] && !labels[p + 1]) {
        labels[p + 1] = next
        stack[sp++] = p + 1
      }
      if (y > 0 && bin[p - w] && !labels[p - w]) {
        labels[p - w] = next
        stack[sp++] = p - w
      }
      if (y < h - 1 && bin[p + w] && !labels[p + w]) {
        labels[p + w] = next
        stack[sp++] = p + w
      }
    }
    next++
    blobs.push({ area, cx: sx / area + 0.5, cy: sy / area + 0.5, w: maxX - minX + 1, h: maxY - minY + 1 })
  }
  return blobs
}

function markerCandidates(img: GrayImage): Blob[] {
  const bin = adaptiveThreshold(img)
  const minDim = Math.min(img.width, img.height)
  const minSide = minDim * 0.008
  const maxSide = minDim * 0.08
  return findBlobs(bin, img.width, img.height).filter((b) => {
    const side = Math.sqrt(b.area)
    if (side < minSide || side > maxSide) return false
    const aspect = b.w / b.h
    if (aspect < 0.5 || aspect > 2) return false
    return b.area / (b.w * b.h) >= 0.6
  })
}

/* ------------------------------------------------------------------ */
/* Sampling helpers                                                    */
/* ------------------------------------------------------------------ */

function sample(img: GrayImage, x: number, y: number): number {
  const { width: w, height: h, data } = img
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (x > w - 1.001) x = w - 1.001
  if (y > h - 1.001) y = h - 1.001
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const i = y0 * w + x0
  const top = data[i] * (1 - fx) + data[i + 1] * fx
  const bottom = data[i + w] * (1 - fx) + data[i + w + 1] * fx
  return top * (1 - fy) + bottom * fy
}

function sampleMm(img: GrayImage, H: Homography, x: number, y: number): number {
  const p = applyHomography(H, x, y)
  return sample(img, p.x, p.y)
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const INNER_POINTS: [number, number][] = (() => {
  const pts: [number, number][] = [[0, 0]]
  for (const rf of [0.3, 0.55, 0.75]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + rf
      pts.push([Math.cos(a) * rf, Math.sin(a) * rf])
    }
  }
  return pts
})()

const RING_POINTS: [number, number][] = Array.from({ length: 16 }, (_, k) => {
  const a = (k / 16) * Math.PI * 2
  return [Math.cos(a) * 1.4, Math.sin(a) * 1.4]
})

interface BubbleSample {
  inner: number
  ring: number
}

function measureBubble(img: GrayImage, H: Homography, b: Bubble): BubbleSample {
  let inner = 0
  for (const [dx, dy] of INNER_POINTS) inner += sampleMm(img, H, b.cx + dx * b.r, b.cy + dy * b.r)
  inner /= INNER_POINTS.length
  const ring = median(RING_POINTS.map(([dx, dy]) => sampleMm(img, H, b.cx + dx * b.r, b.cy + dy * b.r)))
  return { inner, ring }
}

/* ------------------------------------------------------------------ */
/* Sheet reading                                                       */
/* ------------------------------------------------------------------ */

export type ScanFailure = 'no-markers' | 'too-small' | 'no-qr' | 'wrong-format'

export interface ScanSuccess {
  ok: true
  config: SheetConfig
  layout: SheetLayout
  /** Image positions of the sheet's TL, TR, BR, BL markers */
  corners: Pt[]
  /** Marked choice indexes per question (empty = blank, 2+ = multiple) */
  answers: number[][]
  /** Darkness 0..1 of every bubble, per question */
  darkness: number[][]
  /** Student ID read from the grid, null when a digit is blank or ambiguous */
  studentId: string | null
  /** Per-digit value, null when blank/ambiguous */
  idDigits: (number | null)[]
  version: number | null
  /** 1-based question numbers whose marks were close to the threshold */
  uncertain: number[]
  threshold: number
}

export interface ScanFail {
  ok: false
  reason: ScanFailure
  corners?: Pt[]
}

export type ScanResult = ScanSuccess | ScanFail

export const SCAN_FAILURE_TEXT: Record<ScanFailure, string> = {
  'no-markers': 'ไม่พบมุมกระดาษครบ 4 มุม',
  'too-small': 'กระดาษเล็กเกินไป ขยับกล้องเข้าใกล้',
  'no-qr': 'อ่าน QR บนกระดาษไม่ได้',
  'wrong-format': 'ไม่ใช่กระดาษคำตอบของระบบนี้',
}

function cross(o: Pt, a: Pt, b: Pt) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function isConvex(q: Pt[]): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4])
    if (Math.abs(c) < 1e-6) return false
    const s = Math.sign(c)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** The four marker centres in mm, order TL, TR, BR, BL. */
function markerCentresMm(): Pt[] {
  // markers don't depend on config, so any valid layout will do
  const res = computeLayout({ questions: 1, choices: 2, labelStyle: 'thai', idDigits: 0, versions: 0, examCode: 'AAAAAA' })
  if (!res.ok) throw new Error('layout failed')
  return res.layout.markers.map((m) => ({ x: m.cx, y: m.cy }))
}
const MARKERS_MM = markerCentresMm()

/** Score how much a quad of image points looks like our four corner markers (lower = better). */
function quadScore(img: GrayImage, quad: Blob[]): number {
  const pts = quad.map((b) => ({ x: b.cx, y: b.cy }))
  if (!isConvex(pts)) return Infinity
  const areas = quad.map((b) => b.area)
  if (Math.max(...areas) / Math.min(...areas) > 4) return Infinity
  const H = solveHomography(MARKERS_MM, pts)
  if (!H) return Infinity
  let score = 0
  const s = MARKER_SIZE / 2
  for (const m of MARKERS_MM) {
    // marker interior should be dark, a ring 1.5mm outside should be light
    let inside = 0
    let outside = 0
    let n = 0
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      inside += sampleMm(img, H, m.x + Math.cos(a) * s * 0.5, m.y + Math.sin(a) * s * 0.5)
      outside += sampleMm(img, H, m.x + Math.cos(a) * (s + 1.5) * 1.15, m.y + Math.sin(a) * (s + 1.5) * 1.15)
      n++
    }
    inside /= n
    outside /= n
    const contrast = (outside - inside) / Math.max(outside, 1)
    if (contrast < 0.25) return Infinity
    score += 1 - contrast
  }
  return score
}

function pickCorners(img: GrayImage, blobs: Blob[]): Blob[] | null {
  if (blobs.length < 4) return null
  const proj: ((b: Blob) => number)[] = [
    (b) => -(b.cx + b.cy), // image top-left
    (b) => b.cx - b.cy, // top-right
    (b) => b.cx + b.cy, // bottom-right
    (b) => -(b.cx - b.cy), // bottom-left
  ]
  const TOP = 3
  const options = proj.map((f) => [...blobs].sort((a, b) => f(b) - f(a)).slice(0, TOP))
  let best: Blob[] | null = null
  let bestScore = Infinity
  for (const a of options[0])
    for (const b of options[1])
      for (const c of options[2])
        for (const d of options[3]) {
          if (new Set([a, b, c, d]).size < 4) continue
          const s = quadScore(img, [a, b, c, d])
          if (s < bestScore) {
            bestScore = s
            best = [a, b, c, d]
          }
        }
  return best
}

/** Render a region of the sheet (in mm) to an RGBA buffer for the QR decoder. */
function warpRegion(img: GrayImage, H: Homography, x0: number, y0: number, wMm: number, hMm: number, pxPerMm: number) {
  const w = Math.round(wMm * pxPerMm)
  const h = Math.round(hMm * pxPerMm)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = sampleMm(img, H, x0 + (x + 0.5) / pxPerMm, y0 + (y + 0.5) / pxPerMm)
      const i = (y * w + x) * 4
      out[i] = out[i + 1] = out[i + 2] = v
      out[i + 3] = 255
    }
  }
  return { data: out, width: w, height: h }
}

function readQr(img: GrayImage, H: Homography): string | null {
  // The QR sits in the header's right half; its x position depends on the ID grid width.
  const region = warpRegion(img, H, 100, 17, 102, 31, 6)
  const res = jsQR(region.data, region.width, region.height, { inversionAttempts: 'dontInvert' })
  return res ? res.data : null
}

function otsu(values: number[]): { threshold: number; separation: number; lowMean: number; highMean: number } {
  const bins = 100
  const hist: number[] = Array.from({ length: bins }, () => 0)
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++
  const total = values.length
  let sumAll = 0
  for (let i = 0; i < bins; i++) sumAll += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let bestT = 0
  let sep = 0
  let lowMean = 0
  let highMean = 0
  for (let t = 0; t < bins; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      bestT = t
      sep = (mF - mB) / bins
      lowMean = mB / bins
      highMean = mF / bins
    }
  }
  return { threshold: (bestT + 1) / bins, separation: sep, lowMean, highMean }
}

export interface ReadOptions {
  /** Called with the rotation that worked, mostly for debugging */
  debug?: (msg: string) => void
}

export function readSheet(img: GrayImage, opts: ReadOptions = {}): ScanResult {
  const blobs = markerCandidates(img)
  const quad = pickCorners(img, blobs)
  if (!quad) return { ok: false, reason: 'no-markers' }
  const imageCorners = quad.map((b) => ({ x: b.cx, y: b.cy }))

  const diag = Math.hypot(imageCorners[2].x - imageCorners[0].x, imageCorners[2].y - imageCorners[0].y)
  if (diag < 350) return { ok: false, reason: 'too-small', corners: imageCorners }

  // Portrait in the image -> try upright then upside-down; landscape -> the two sideways turns.
  const side = (i: number, j: number) => Math.hypot(imageCorners[i].x - imageCorners[j].x, imageCorners[i].y - imageCorners[j].y)
  const horizontal = side(0, 1) + side(2, 3)
  const vertical = side(1, 2) + side(3, 0)
  const rotations = vertical >= horizontal ? [0, 2, 1, 3] : [1, 3, 0, 2]

  for (const r of rotations) {
    const corners = MARKERS_MM.map((_, i) => imageCorners[(i + r) % 4])
    const H = solveHomography(MARKERS_MM, corners)
    if (!H) continue
    const payload = readQr(img, H)
    if (!payload) continue
    opts.debug?.(`rotation ${r}, payload ${payload}`)
    const config = decodeConfig(payload)
    if (!config) return { ok: false, reason: 'wrong-format', corners }
    const res = computeLayout(config)
    if (!res.ok) return { ok: false, reason: 'wrong-format', corners }
    return measure(img, H, config, res.layout, corners)
  }
  return { ok: false, reason: 'no-qr', corners: imageCorners }
}

function measure(img: GrayImage, H: Homography, config: SheetConfig, layout: SheetLayout, corners: Pt[]): ScanSuccess {
  const qSamples = layout.answer.questions.map((q) => q.bubbles.map((b) => measureBubble(img, H, b)))
  const idSamples = layout.studentId?.digits.map((col) => col.map((b) => measureBubble(img, H, b))) ?? []
  const vSamples = layout.version?.bubbles.map((b) => measureBubble(img, H, b)) ?? []

  const all = [...qSamples.flat(), ...idSamples.flat(), ...vSamples]
  const rings = all.map((s) => s.ring).sort((a, b) => a - b)
  const paper = rings[Math.floor(rings.length * 0.9)] || 255
  const dark = (s: BubbleSample) => {
    const white = Math.max(s.ring, paper * 0.8)
    return Math.min(1, Math.max(0, (white - s.inner) / white))
  }
  const darkness = qSamples.map((row) => row.map(dark))
  const idDark = idSamples.map((col) => col.map(dark))
  const vDark = vSamples.map(dark)

  const values = [...darkness.flat(), ...idDark.flat(), ...vDark]
  // Split blank vs filled bubbles half-way between the two groups' means, so faint
  // erasure marks fall on the blank side. Without two clear groups use a fixed level.
  const { separation, lowMean, highMean } = otsu(values)
  const threshold = separation > 0.25 ? Math.min(0.55, Math.max(0.25, (lowMean + highMean) / 2)) : 0.4

  const marked = (row: number[]) => row.flatMap((d, i) => (d >= threshold ? [i] : []))
  const answers = darkness.map(marked)
  const uncertain = darkness.flatMap((row, i) =>
    row.some((d) => Math.abs(d - threshold) < 0.08) ? [i + 1] : [],
  )

  const idDigits = idDark.map((col) => {
    const m = marked(col)
    return m.length === 1 ? m[0] : null
  })
  const studentId = idDigits.length > 0 && idDigits.every((d) => d !== null) ? idDigits.join('') : null
  const vm = marked(vDark)
  const version = vm.length === 1 ? vm[0] : null

  return { ok: true, config, layout, corners, answers, darkness, studentId, idDigits, version, uncertain, threshold }
}
