/**
 * Minimal .xlsx writer and .xlsx/.csv reader. Enough for score exports and student /
 * teacher imports, at a fraction of the size of a full spreadsheet library.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

export type Cell = string | number | null | undefined

export interface SheetSpec {
  name: string
  rows: Cell[][]
  /** Column widths in characters */
  colWidths?: number[]
  /** Ranges to merge, e.g. "D1:F1" */
  merges?: string[]
  /** 0-based row indexes drawn bold (header rows) */
  boldRows?: number[]
  /** Freeze rows above / columns left of this cell, e.g. { rows: 2, cols: 3 } */
  freeze?: { rows: number; cols: number }
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

const esc = (s: string) =>
  s
    // characters XML 1.0 does not allow at all
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function sheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let n = 2
  let out = base
  while (used.has(out.toLowerCase())) out = `${base.slice(0, 28)} ${n++}`
  used.add(out.toLowerCase())
  return out
}

function sheetXml(s: SheetSpec): string {
  const bold = new Set(s.boldRows ?? [])
  const rows = s.rows
    .map((row, r) => {
      const style = bold.has(r) ? ' s="1"' : ''
      const cells = row
        .map((v, c) => {
          if (v === null || v === undefined || v === '') return bold.has(r) ? `<c r="${colName(c)}${r + 1}"${style}/>` : ''
          const ref = `${colName(c)}${r + 1}`
          if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  const freeze = s.freeze && (s.freeze.rows || s.freeze.cols)
    ? `<sheetViews><sheetView workbookViewId="0"><pane${s.freeze.cols ? ` xSplit="${s.freeze.cols}"` : ''}${s.freeze.rows ? ` ySplit="${s.freeze.rows}"` : ''} topLeftCell="${colName(s.freeze.cols)}${s.freeze.rows + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    : ''
  const cols = s.colWidths?.length
    ? `<cols>${s.colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : ''
  const merges = s.merges?.length ? `<mergeCells count="${s.merges.length}">${s.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${freeze}${cols}<sheetData>${rows}</sheetData>${merges}</worksheet>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="14"/><name val="TH Sarabun New"/><family val="2"/></font><font><b/><sz val="14"/><name val="TH Sarabun New"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/** Build an .xlsx file (Thai text is stored as UTF-8, which Excel reads natively). */
export function buildXlsx(sheets: SheetSpec[]): Uint8Array {
  const used = new Set<string>()
  const names = sheets.map((s) => sheetName(s.name, used))
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES),
  }
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))))
  return zipSync(files, { level: 6 })
}

export function downloadBytes(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export'
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

const decodeXml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** Text of all <t> runs inside a fragment (rich text cells have several). */
const runsText = (xml: string) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('')

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]

function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function readXlsx(bytes: Uint8Array): string[][] {
  const zip = unzipSync(bytes)
  const text = (path: string) => (zip[path] ? strFromU8(zip[path]) : '')
  const workbook = text('xl/workbook.xml')
  const firstSheet = workbook.match(/<sheet\b([^>]*)\/?>/)
  const rid = firstSheet ? attr(firstSheet[1], 'r:id') : undefined
  const rels = text('xl/_rels/workbook.xml.rels')
  let target = 'worksheets/sheet1.xml'
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) if (attr(m[1], 'Id') === rid) target = attr(m[1], 'Target') ?? target
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => runsText(m[1]))

  const rows: string[][] = []
  for (const rowMatch of text(sheetPath).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rowMatch[1], 'r') ?? rows.length + 1) - 1
    const row: string[] = []
    let next = 0
    for (const c of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r')
      const col = ref ? colIndex(ref) : next
      next = col + 1
      const type = attr(c[1], 't')
      const inner = c[2] ?? ''
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = runsText(inner)
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
      else if (v !== undefined) value = decodeXml(v)
      row[col] = value
    }
    rows[r] = Array.from(row, (x) => x ?? '')
  }
  return Array.from(rows, (x) => x ?? [])
}

/** Decode CSV bytes: UTF-8 (with or without BOM), or Windows-874 as saved by Thai Excel. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-874').decode(bytes)
  }
}

export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = ['\t', ',', ';'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Read the first sheet of an .xlsx file, or a .csv / tab-separated text file, as rows of strings. */
export function readSpreadsheet(bytes: Uint8Array): string[][] {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  const rows = isZip ? readXlsx(bytes) : parseCsv(decodeText(bytes))
  return rows.map((r) => r.map((c) => (c ?? '').trim())).filter((r) => r.some((c) => c !== ''))
}
