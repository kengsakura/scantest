import type { ScanFailure } from '../omr/scanner'

// Kept apart from scanner.ts so the page bundle doesn't pull in the scanner and
// QR decoder (they run in the worker).
export const SCAN_FAILURE_TEXT: Record<ScanFailure, string> = {
  'no-markers': 'ไม่พบมุมกระดาษครบ 4 มุม',
  'too-small': 'กระดาษเล็กเกินไป ขยับกล้องเข้าใกล้',
  'no-qr': 'อ่าน QR บนกระดาษไม่ได้',
  'wrong-format': 'ไม่ใช่กระดาษคำตอบของระบบนี้',
}
