import { describe, expect, it } from 'vitest'
import type { Exam } from '../data/types'
import { decodeConfig, encodeConfig, GENERIC_CODE, type SheetConfig } from '../omr/config'
import { emptyKey } from '../omr/grading'
import { sheetFitsExam } from './exam'

const exam: Exam = {
  id: 'e', code: 'ABC123', title: 't', termId: 't', classroomId: 'c', ownerId: 'o', createdAt: '',
  sheet: { questions: 30, choices: 4, labelStyle: 'thai' }, idDigits: 4, presetId: 'p', key: emptyKey(30),
}
const sheet = (patch: Partial<SheetConfig>): SheetConfig => ({ questions: 30, choices: 4, labelStyle: 'thai', idDigits: 4, versions: 0, examCode: GENERIC_CODE, ...patch })

describe('which sheets an exam accepts', () => {
  it("accepts its own sheets and a preset's general sheets with the same layout", () => {
    expect(sheetFitsExam(sheet({ examCode: 'ABC123' }), exam)).toBeNull()
    expect(sheetFitsExam(sheet({}), exam)).toBeNull()
    expect(sheetFitsExam(sheet({ labelStyle: 'latin' }), exam)).toBeNull() // labels don't change grading
  })
  it("rejects another exam's sheets and general sheets of a different layout", () => {
    expect(sheetFitsExam(sheet({ examCode: 'ZZZ999' }), exam)).toContain('ข้อสอบอื่น')
    expect(sheetFitsExam(sheet({ questions: 40 }), exam)).toContain('40 ข้อ')
    expect(sheetFitsExam(sheet({ choices: 5 }), exam)).toContain('5 ตัวเลือก')
    expect(sheetFitsExam(sheet({ idDigits: 0 }), exam)).toContain('เขียนชื่อ')
  })
  it('the general code survives the QR payload', () => {
    expect(decodeConfig(encodeConfig(sheet({})))?.examCode).toBe(GENERIC_CODE)
  })
})
