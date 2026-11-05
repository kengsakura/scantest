/** 3x3 projective transform stored row-major with h[8] = 1. */
export type Homography = number[]

export interface Pt {
  x: number
  y: number
}

/** Solve the homography mapping src[i] -> dst[i] for exactly four point pairs. */
export function solveHomography(src: Pt[], dst: Pt[]): Homography | null {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // Gaussian elimination with partial pivoting on the 8x9 augmented matrix
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-12) return null
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      if (f === 0) continue
      for (let k = col; k < 9; k++) A[r][k] -= f * A[col][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  h.push(1)
  return h
}

export function applyHomography(h: Homography, x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8]
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w }
}
