import type { ScanResult } from '../omr/scanner'
import type { ScanRequest } from './scanWorker'

/** Runs the sheet reader in a Web Worker so the camera preview stays smooth. */
export class ScanClient {
  private worker = new Worker(new URL('./scanWorker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private pending = new Map<number, (r: { result: ScanResult; ms: number }) => void>()

  constructor() {
    this.worker.onmessage = (e: MessageEvent<{ id: number; result: ScanResult; ms: number }>) => {
      const cb = this.pending.get(e.data.id)
      this.pending.delete(e.data.id)
      cb?.(e.data)
    }
  }

  read(frame: ImageData): Promise<{ result: ScanResult; ms: number }> {
    const id = this.nextId++
    const req: ScanRequest = { id, width: frame.width, height: frame.height, buffer: frame.data.buffer as ArrayBuffer }
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker.postMessage(req, [req.buffer])
    })
  }

  dispose() {
    this.worker.terminate()
    this.pending.clear()
  }
}

/** Draw an image/video frame scaled so its long side is at most `maxSide` and return its pixels. */
export function grabFrame(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  canvas: HTMLCanvasElement,
  maxSide = 1280,
): ImageData {
  const s = Math.min(1, maxSide / Math.max(srcW, srcH))
  const w = Math.round(srcW * s)
  const h = Math.round(srcH * s)
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/** LINE / Facebook / Instagram in-app browsers often block the camera. */
export function isInAppBrowser(): boolean {
  return /Line\/|FBAN|FBAV|Instagram|FB_IAB/i.test(navigator.userAgent)
}
