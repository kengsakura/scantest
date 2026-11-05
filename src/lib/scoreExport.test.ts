import { describe, expect, it } from 'vitest'
import type { ClassStudent, ScanRecord } from '../data/types'
import { emptyKey } from '../omr/grading'
import { buildScoreTable, roundTo, scoreSheets, toTsv, totalsText } from './scoreExport'
import { readSpreadsheet, buildXlsx } from './xlsx'

const st = (number: number, code: string, name: string): ClassStudent => ({
  id: code, enrollmentId: 'e' + code, classroomId: 'c', number, code, prefix: '', firstName: name, lastName: '', name,
})
const scan = (code: string, answers: number[][]): ScanRecord => ({ id: 's' + code, examId: 'x', studentCode: code, answers, uncertain: [], scannedAt: '', scannedBy: '' })

const key = emptyKey(3)
key.answers = [0, 1, 2]
key.points = [1, 2, 1]
key.free = [false, false, true]
const students = [st(1, '1001', 'ก'), st(2, '1002', 'ข'), st(3, '1003', 'ค')]
const scans = [scan('1001', [[0], [1], []]), scan('1003', [[1], [1, 2], [0]])]
const labels = ['ก', 'ข', 'ค', 'ง']

describe('score export', () => {
  it('simple table: points per question, total, absent students blank', () => {
    const t = buildScoreTable(students, scans, key, labels, { mode: 'simple', convertTo: null, decimals: 0 })
    expect(t.head).toEqual([['เลขที่', 'เลขประจำตัว', 'ชื่อ-สกุล', 'ข้อ 1', 'ข้อ 2', 'ข้อ 3', 'รวม (เต็ม 4)']])
    expect(t.body[0]).toEqual([1, '1001', 'ก', 1, 2, 1, 4])
    expect(t.body[1]).toEqual([2, '1002', 'ข', '', '', '', ''])
    expect(t.body[2]).toEqual([3, '1003', 'ค', 0, 0, 1, 1]) // wrong, two marks = wrong, free
    expect(t.totals).toEqual([4, null, 1])
  })

  it('full table: key row, answer, result and points per question', () => {
    const t = buildScoreTable(students, scans, key, labels, { mode: 'full', convertTo: null, decimals: 0 })
    expect(t.head[0].slice(0, 7)).toEqual(['', '', '', 'ข้อ 1', '', '', 'ข้อ 2'])
    expect(t.head[2].slice(2, 9)).toEqual(['เฉลย', 'ก', '', 1, 'ข', '', 2])
    expect(t.merges[0]).toBe('D1:F1')
    expect(t.body[2].slice(3, 12)).toEqual(['ข', 'ผิด', 0, 'ข,ค', 'ฝนหลายข้อ', 0, 'ก', 'ฟรี', 1])
  })

  it('converts totals to another full score with rounding', () => {
    const t = buildScoreTable(students, scans, key, labels, { mode: 'simple', convertTo: 20, decimals: 1 })
    expect(t.head[0].at(-1)).toBe('คะแนนแปลง (เต็ม 20)')
    expect(t.body[0].at(-1)).toBe(20)
    expect(t.body[2].at(-1)).toBe(5) // 1/4 * 20
    expect(t.totals).toEqual([20, null, 5])
    expect(roundTo(2.345, 2)).toBe(2.35)
    expect(roundTo(1 / 3 * 20, 0)).toBe(7)
  })

  it('copies totals one per line and tables as TSV', () => {
    expect(totalsText([4, null, 1.5])).toBe('4\n\n1.5')
    expect(toTsv([['a', null, 1], ['x\ty', '', 2]])).toBe('a\t\t1\nx y\t\t2')
  })

  it('builds a workbook with a title row, frozen header and an answer-key sheet', () => {
    const t = buildScoreTable(students, scans, key, labels, { mode: 'full', convertTo: null, decimals: 0 })
    const sheets = scoreSheets(t, { title: 'สอบย่อย', classroom: 'ม.1/1', term: '2/2569' }, key, labels)
    expect(sheets[0].merges?.[0]).toBe('D3:F3')
    expect(sheets[0].freeze).toEqual({ rows: 5, cols: 3 })
    const back = readSpreadsheet(buildXlsx(sheets))
    expect(back[0][0]).toBe('สอบย่อย · ม.1/1 · ภาคเรียน 2/2569')
    expect(back[4][2]).toBe('ก') // first student's name under the key row
  })
})
