import QRCode from 'qrcode'

/** Module matrix for a QR code: matrix[row][col] = true when dark. */
export function qrMatrix(payload: string): boolean[][] {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const rows: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const row: boolean[] = []
    for (let c = 0; c < n; c++) row.push(qr.modules.data[r * n + c] === 1)
    rows.push(row)
  }
  return rows
}

/** SVG path data drawing the dark modules of `matrix` inside a square of `size` at (x, y). */
export function qrPath(matrix: boolean[][], x: number, y: number, size: number): string {
  const n = matrix.length
  const m = size / n
  const parts: string[] = []
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!matrix[r][c]) {
        c++
        continue
      }
      const start = c
      while (c < n && matrix[r][c]) c++
      // tiny overlap avoids hairline gaps between modules in some renderers
      parts.push(`M${(x + start * m).toFixed(3)} ${(y + r * m).toFixed(3)}h${((c - start) * m).toFixed(3)}v${(m + 0.01).toFixed(3)}h${(-(c - start) * m).toFixed(3)}z`)
    }
  }
  return parts.join('')
}
