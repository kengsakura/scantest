/// <reference lib="webworker" />
import { readSheet, rgbaToGray } from '../omr/scanner'

export interface ScanRequest {
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
}

self.onmessage = (e: MessageEvent<ScanRequest>) => {
  const { id, width, height, buffer } = e.data
  const started = performance.now()
  const result = readSheet(rgbaToGray(new Uint8ClampedArray(buffer), width, height))
  ;(self as unknown as Worker).postMessage({ id, result, ms: performance.now() - started })
}
