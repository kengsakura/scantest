import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { importStudents, importTeachers } from './importers'
import { compareRooms, currentThaiTerm, finalGrades, fullName, nextGrade, nextTerm, splitThaiName, suggestPromotion } from './terms'
import { buildXlsx, colName, decodeText, parseCsv, readSpreadsheet } from './xlsx'

describe('terms', () => {
  it('knows the Thai school calendar', () => {
    expect(currentThaiTerm(new Date(2026, 5, 1))).toEqual({ year: 2569, semester: 1 }) // June
    expect(currentThaiTerm(new Date(2026, 10, 5))).toEqual({ year: 2569, semester: 2 }) // November
    expect(currentThaiTerm(new Date(2027, 1, 1))).toEqual({ year: 2569, semester: 2 }) // February: still 2/2569
    expect(nextTerm({ year: 2569, semester: 1 })).toEqual({ year: 2569, semester: 2 })
    expect(nextTerm({ year: 2569, semester: 2 })).toEqual({ year: 2570, semester: 1 })
  })

  it('orders classes naturally and moves grades up', () => {
    const rooms = [{ grade: 'ม.2', room: '10' }, { grade: 'ม.1', room: '2' }, { grade: 'ม.2', room: '2' }, { grade: 'ม.10', room: '1' }]
    expect(rooms.sort(compareRooms).map((r) => `${r.grade}/${r.room}`)).toEqual(['ม.1/2', 'ม.2/2', 'ม.2/10', 'ม.10/1'])
    expect(nextGrade('ม.3')).toBe('ม.4')
    expect(nextGrade('ป.6')).toBe('ป.7')
    expect(nextGrade('อนุบาล')).toBeNull()
    expect([...finalGrades([{ grade: 'ม.1', room: '1' }, { grade: 'ม.6', room: '1' }, { grade: 'ป.6', room: '2' }])].sort()).toEqual(['ป.6', 'ม.6'])
  })

  it('suggests a promotion plan: up one grade, same room, top grade graduates', () => {
    const plan = suggestPromotion(
      [
        { id: 'a', grade: 'ม.6', room: '1' },
        { id: 'b', grade: 'ม.1', room: '2' },
      ],
      () => 30,
    )
    expect(plan.map((p) => [p.from.grade, p.target])).toEqual([
      ['ม.1', { kind: 'class', grade: 'ม.2', room: '2' }],
      ['ม.6', { kind: 'graduate' }],
    ])
  })

  it('splits and joins Thai names', () => {
    expect(splitThaiName('ด.ช. สมชาย  ใจดี')).toEqual({ prefix: 'ด.ช.', firstName: 'สมชาย', lastName: 'ใจดี' })
    expect(splitThaiName('นางสาวสมศรี มั่นคง')).toEqual({ prefix: 'นางสาว', firstName: 'สมศรี', lastName: 'มั่นคง' })
    expect(splitThaiName('สมปอง')).toEqual({ prefix: '', firstName: 'สมปอง', lastName: '' })
    expect(fullName({ prefix: 'ด.ญ.', firstName: 'ขวัญใจ', lastName: 'รักเรียน' })).toBe('ด.ญ.ขวัญใจ รักเรียน')
    expect(fullName({ prefix: 'นาย', firstName: 'ก', lastName: 'ข' })).toBe('นาย ก ข')
  })
})

describe('xlsx', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })

  it('writes a valid workbook that reads back with Thai text, numbers and blanks', () => {
    const bytes = buildXlsx([
      {
        name: 'คะแนน: ม.1/1',
        rows: [
          ['เลขที่', 'ชื่อ', 'คะแนน'],
          [1, 'ด.ช. สมชาย <&> "ใจดี"', 18.5],
          [2, '', null],
        ],
        boldRows: [0],
        merges: ['A1:A1'],
        colWidths: [6, 30, 8],
        freeze: { rows: 1, cols: 2 },
      },
      { name: 'เฉลย', rows: [['ข้อ', 'เฉลย'], [1, 'ก']] },
    ])
    const files = unzipSync(bytes)
    expect(Object.keys(files)).toContain('xl/worksheets/sheet2.xml')
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="คะแนน  ม.1 1"') // : and / are not allowed in sheet names
    expect(readSpreadsheet(bytes)).toEqual([
      ['เลขที่', 'ชื่อ', 'คะแนน'],
      ['1', 'ด.ช. สมชาย <&> "ใจดี"', '18.5'],
      ['2'],
    ])
  })

  it('parses CSV with quotes, commas and tabs', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ])
    expect(parseCsv('เลขที่\tชื่อ\n1\tสมชาย')).toEqual([
      ['เลขที่', 'ชื่อ'],
      ['1', 'สมชาย'],
    ])
  })

  it('decodes UTF-8 with BOM and Windows-874 (Thai Excel CSV)', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('ชื่อ')]))).toBe('ชื่อ')
    expect(decodeText(new Uint8Array([0xa1, 0xa2, 0x2c, 0x31]))).toBe('กข,1') // ก=0xA1, ข=0xA2 in TIS-620
  })
})

describe('imports', () => {
  it('reads students with separate name columns and pads IDs Excel shortened', () => {
    const res = importStudents(
      [
        ['รายชื่อนักเรียน ม.1'],
        ['เลขที่', 'เลขประจำตัวนักเรียน', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ชั้น', 'ห้อง'],
        ['1', '123', 'ด.ช.', 'สมชาย', 'ใจดี', 'ม.1', '2'],
        ['2', '1002', 'ด.ญ.', 'สมหญิง', 'รักเรียน', 'ม.1', '2'],
        ['', '', '', '', '', '', ''],
      ],
      4,
    )
    expect(res.errors).toEqual([])
    expect(res.rows[0]).toEqual({ number: 1, code: '0123', prefix: 'ด.ช.', firstName: 'สมชาย', lastName: 'ใจดี', grade: 'ม.1', room: '2' })
    expect(res.rows).toHaveLength(2)
  })

  it('reads a full-name column and a combined class column, and reports bad rows', () => {
    const res = importStudents(
      [
        ['ชั้น/ห้อง', 'เลขที่', 'รหัส', 'ชื่อ-สกุล'],
        ['ม.3/4', '5', '2001', 'นางสาวสมศรี มั่นคง'],
        ['ม.3/4', '6', '20x1', 'ผิด'],
        ['ม.3/4', '7', '2001', 'ซ้ำ'],
      ],
      4,
    )
    expect(res.rows).toEqual([{ number: 5, code: '2001', prefix: 'นางสาว', firstName: 'สมศรี', lastName: 'มั่นคง', grade: 'ม.3', room: '4' }])
    expect(res.errors).toHaveLength(2)
  })

  it('reads English headers without mixing up name columns', () => {
    const res = importStudents([['No', 'Student ID', 'First name', 'Last name', 'Grade', 'Room'], ['1', '1001', 'Somchai', 'Jaidee', 'ม.1', '1']], 4)
    expect(res.rows[0]).toMatchObject({ code: '1001', firstName: 'Somchai', lastName: 'Jaidee', grade: 'ม.1', room: '1' })
  })

  it('says what is missing when the header is wrong', () => {
    expect(importStudents([['a', 'b'], ['1', '2']], 4).errors[0]).toContain('ไม่พบหัวตาราง')
  })

  it('reads teacher accounts', () => {
    const res = importTeachers([
      ['ชื่อผู้ใช้', 'รหัสผ่าน', 'ชื่อ-สกุล', 'สิทธิ์'],
      ['Somchai', 'kru12345', 'นายสมชาย ใจดี', 'ครู'],
      ['boss', 'admin12345', 'ผอ.', 'แอดมิน'],
      ['x y', 'kru12345', 'bad', ''],
      ['short', '123', 'bad', ''],
    ])
    expect(res.rows).toEqual([
      { username: 'somchai', password: 'kru12345', name: 'นายสมชาย ใจดี', role: 'teacher' },
      { username: 'boss', password: 'admin12345', name: 'ผอ.', role: 'admin' },
    ])
    expect(res.errors).toHaveLength(2)
  })
})
