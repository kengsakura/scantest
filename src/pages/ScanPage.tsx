import { useCallback, useEffect, useRef, useState } from 'react'
import { CLOUD, getDB, saveScan, scansOf, setScanStudent, studentsOf, useAppState, useDB, useExamScans } from '../data/store'
import type { Exam, ScanRecord, User } from '../data/types'
import { formatScore } from '../lib/exam'
import { grade, missingAnswers } from '../omr/grading'
import { SCAN_FAILURE_TEXT, type ScanResult, type ScanSuccess } from '../omr/scanner'
import { grabFrame, isInAppBrowser, ScanClient } from '../scan/scanClient'
import { GradeStrip } from './GradeStrip'

type CameraState = 'idle' | 'starting' | 'live' | 'error'

let audio: AudioContext | null = null
function beep(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 60 : [40, 40, 40])
    audio ??= new AudioContext()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.frequency.value = ok ? 1046 : 330
    g.gain.value = 0.08
    o.connect(g).connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + (ok ? 0.09 : 0.25))
  } catch {
    /* no audio: fine */
  }
}

function signature(r: ScanSuccess) {
  return `${r.studentId ?? '?'}|${JSON.stringify(r.answers)}`
}

export function ScanPage({ examId, user }: { examId: string; user: User }) {
  const db = useDB()
  const exam = db.exams.find((e) => e.id === examId)
  if (!exam) return <p>ไม่พบข้อสอบ</p>
  if (missingAnswers(exam.key).length > 0)
    return (
      <div className="card empty">
        <p>ต้องใส่เฉลยให้ครบก่อนเริ่มสแกน</p>
        <a className="btn" href={`#/exams/${exam.id}/key`}>
          ไปใส่เฉลย
        </a>
      </div>
    )
  return <Scanner exam={exam} user={user} />
}

function Scanner({ exam, user }: { exam: Exam; user: User }) {
  const db = useDB()
  const { outbox } = useAppState()
  useExamScans(exam.id)
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const grabRef = useRef<HTMLCanvasElement | null>(null)
  const clientRef = useRef<ScanClient | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wantLive = useRef(false)

  const [camera, setCamera] = useState<CameraState>('idle')
  const [cameraError, setCameraError] = useState('')
  const [status, setStatus] = useState('')
  const [lastId, setLastId] = useState<string | null>(null)
  const [torch, setTorch] = useState<boolean | null>(null)
  const [fileMsg, setFileMsg] = useState('')

  const students = studentsOf(db, exam.classroomId)
  const scans = scansOf(db, exam.id)
  const last = scans.find((s) => s.id === lastId) ?? null

  /* ---- accepting a read ---- */
  const accept = useCallback(
    (r: ScanSuccess): ScanRecord => {
      const rec = saveScan({
        examId: exam.id,
        studentCode: r.studentId,
        answers: r.answers,
        uncertain: r.uncertain,
        scannedBy: user.id,
      })
      const known = r.studentId !== null && getDB().students.some((s) => s.classroomId === exam.classroomId && s.code === r.studentId)
      beep(known)
      setLastId(rec.id)
      return rec
    },
    [exam.id, exam.classroomId, user.id],
  )

  /* ---- camera loop ---- */
  const loop = useRef({ busy: false, prevSig: '', lockSig: '', lockStudent: '', misses: 0, timer: 0, lastTime: -1, stalled: 0 })

  const drawOverlay = (res: ScanResult, w: number, h: number) => {
    const c = overlayRef.current
    if (!c) return
    if (c.width !== w) c.width = w
    if (c.height !== h) c.height = h
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    const pts = res.corners
    if (!pts) return
    ctx.lineWidth = Math.max(3, w / 200)
    ctx.strokeStyle = res.ok ? '#22c55e' : '#f59e0b'
    ctx.fillStyle = ctx.strokeStyle
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
    ctx.stroke()
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, ctx.lineWidth * 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const handle = useCallback(
    (res: ScanResult, w: number, h: number) => {
      const L = loop.current
      drawOverlay(res, w, h)
      if (!res.ok) {
        if (res.reason === 'no-markers') {
          L.misses++
          if (L.misses >= 2) {
            L.lockSig = ''
            L.lockStudent = ''
          }
        }
        L.prevSig = ''
        setStatus(L.lockSig ? 'สแกนแผ่นนี้แล้ว เปลี่ยนเป็นแผ่นถัดไป' : SCAN_FAILURE_TEXT[res.reason])
        return
      }
      L.misses = 0
      if (res.config.examCode !== exam.code) {
        L.prevSig = ''
        setStatus(`กระดาษนี้เป็นของข้อสอบรหัส ${res.config.examCode} ไม่ใช่ข้อสอบนี้ (${exam.code})`)
        return
      }
      const sig = signature(res)
      const sameSheet = sig === L.lockSig || (res.studentId !== null && res.studentId === L.lockStudent)
      if (sameSheet) {
        setStatus('สแกนแผ่นนี้แล้ว เปลี่ยนเป็นแผ่นถัดไป')
        return
      }
      if (sig !== L.prevSig) {
        // need two identical reads in a row before saving
        L.prevSig = sig
        setStatus('กำลังอ่าน… ถือกล้องนิ่งๆ')
        return
      }
      accept(res)
      L.lockSig = sig
      L.lockStudent = res.studentId ?? ''
      L.prevSig = ''
      setStatus('บันทึกแล้ว ✓ วางแผ่นถัดไปได้เลย')
    },
    [exam.code, accept],
  )

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    window.clearTimeout(loop.current.timer)
  }

  const tick = useCallback(async () => {
    const v = videoRef.current
    const L = loop.current
    if (!wantLive.current || !v) return
    if (v.readyState >= 2 && v.videoWidth > 0 && !L.busy) {
      // watchdog: restart the camera if the picture stops moving (seen on some phones)
      if (v.currentTime === L.lastTime) L.stalled++
      else L.stalled = 0
      L.lastTime = v.currentTime
      if (L.stalled > 25) {
        L.stalled = 0
        void startCamera()
        return
      }
      L.busy = true
      grabRef.current ??= document.createElement('canvas')
      const frame = grabFrame(v, v.videoWidth, v.videoHeight, grabRef.current)
      const { result } = await clientRef.current!.read(frame)
      L.busy = false
      if (wantLive.current) handle(result, frame.width, frame.height)
    }
    L.timer = window.setTimeout(tick, 120)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle])

  const startCamera = useCallback(async () => {
    stopStream()
    setCamera('starting')
    setCameraError('')
    wantLive.current = true
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      const v = videoRef.current!
      v.srcObject = stream
      await v.play()
      const track = stream.getVideoTracks()[0]
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }
      setTorch(caps.torch ? false : null)
      if (caps.focusMode?.includes('continuous'))
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
      setCamera('live')
      loop.current.timer = window.setTimeout(tick, 200)
    } catch (err) {
      wantLive.current = false
      setCamera('error')
      const name = (err as Error).name
      setCameraError(
        (err as Error).message === 'insecure'
          ? 'เบราว์เซอร์นี้เปิดกล้องไม่ได้ (ต้องเปิดเว็บผ่าน https)'
          : name === 'NotAllowedError'
            ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์'
            : name === 'NotFoundError'
              ? 'ไม่พบกล้องในอุปกรณ์นี้'
              : 'เปิดกล้องไม่สำเร็จ ลองใหม่ หรือใช้ปุ่มถ่ายรูปแทน',
      )
    }
  }, [tick])

  const stopCamera = () => {
    wantLive.current = false
    stopStream()
    setCamera('idle')
    setStatus('')
    overlayRef.current?.getContext('2d')?.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
  }

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || torch === null) return
    await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).catch(() => {})
    setTorch(!torch)
  }

  useEffect(() => {
    clientRef.current = new ScanClient()
    const onVisibility = () => {
      // iOS freezes the stream when the app goes to the background: restart on return
      if (document.hidden) stopStream()
      else if (wantLive.current) void startCamera()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      wantLive.current = false
      stopStream()
      clientRef.current?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- photo / file fallback ---- */
  const onFiles = async (files: FileList | null) => {
    if (!files?.length || !clientRef.current) return
    const canvas = document.createElement('canvas')
    let ok = 0
    const problems: string[] = []
    for (const file of Array.from(files)) {
      try {
        const bmp = await createImageBitmap(file)
        const frame = grabFrame(bmp, bmp.width, bmp.height, canvas, 1600)
        const { result } = await clientRef.current.read(frame)
        if (!result.ok) problems.push(`${file.name}: ${SCAN_FAILURE_TEXT[result.reason]}`)
        else if (result.config.examCode !== exam.code) problems.push(`${file.name}: เป็นกระดาษของข้อสอบรหัส ${result.config.examCode}`)
        else {
          accept(result)
          ok++
        }
      } catch {
        problems.push(`${file.name}: เปิดไฟล์ไม่ได้`)
      }
    }
    setFileMsg([`อ่านสำเร็จ ${ok} แผ่น`, ...problems].join('\n'))
  }

  return (
    <section className="scan-page">
      <div className="page-head">
        <div>
          <a href={`#/exams/${exam.id}`} className="back">
            ← {exam.title}
          </a>
          <h1>สแกนกระดาษคำตอบ</h1>
          <p className="muted">
            สแกนแล้ว {scans.length}/{students.length} คน · รหัสแบบ {exam.code}
            {CLOUD &&
              (outbox > 0 ? (
                <span className="badge warn">รอส่งขึ้นเซิร์ฟเวอร์ {outbox} แผ่น</span>
              ) : (
                <span className="badge ok">ข้อมูลขึ้นเซิร์ฟเวอร์ครบแล้ว</span>
              ))}
          </p>
        </div>
      </div>

      {isInAppBrowser() && (
        <p className="hint warn">คุณเปิดลิงก์จากในแอป (เช่น LINE) ซึ่งมักเปิดกล้องไม่ได้ กรุณาเปิดใน Chrome หรือ Safari</p>
      )}

      <div className="scan-layout">
        <div className="camera card">
          <div className={`viewport ${camera === 'live' ? 'live' : ''}`}>
            <video ref={videoRef} playsInline muted />
            <canvas ref={overlayRef} className="overlay" />
            {camera !== 'live' && (
              <div className="viewport-msg">
                {camera === 'starting' ? 'กำลังเปิดกล้อง…' : camera === 'error' ? cameraError : 'วางกระดาษบนพื้นเรียบ ให้เห็นสี่เหลี่ยมดำครบ 4 มุม'}
              </div>
            )}
          </div>
          <div className="status" aria-live="polite">
            {camera === 'live' ? status || 'กำลังหากระดาษ…' : ''}
          </div>
          <div className="camera-actions">
            {camera === 'live' ? (
              <button className="btn secondary" onClick={stopCamera}>
                ปิดกล้อง
              </button>
            ) : (
              <button className="btn" onClick={startCamera} disabled={camera === 'starting'}>
                เปิดกล้องสแกน
              </button>
            )}
            {torch !== null && camera === 'live' && (
              <button className="btn secondary" onClick={toggleTorch}>
                {torch ? 'ปิดไฟฉาย' : 'เปิดไฟฉาย'}
              </button>
            )}
            <label className="btn secondary">
              ถ่ายรูป / เลือกรูป
              <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => onFiles(e.target.files).then(() => (e.target.value = ''))} />
            </label>
          </div>
          {fileMsg && <pre className="hint">{fileMsg}</pre>}
        </div>

        <div className="result-col">
          {last ? <ResultCard exam={exam} rec={last} /> : <div className="card empty muted">ผลการสแกนล่าสุดจะแสดงที่นี่</div>}
          <RecentList exam={exam} onPick={setLastId} />
        </div>
      </div>
    </section>
  )
}

function ResultCard({ exam, rec }: { exam: Exam; rec: ScanRecord }) {
  const db = useDB()
  const students = studentsOf(db, exam.classroomId)
  const student = students.find((s) => s.code === rec.studentCode)
  const g = grade(rec.answers, exam.key)
  return (
    <div className={`card result-card ${student ? 'ok' : 'warn'}`}>
      <div className="result-head">
        <div>
          {student ? (
            <>
              <div className="result-name">{student.name}</div>
              <div className="muted">
                เลขที่ {student.number} · รหัส {student.code}
              </div>
            </>
          ) : (
            <>
              <div className="result-name">{rec.studentCode ? `ไม่พบรหัส ${rec.studentCode} ในห้องนี้` : 'อ่านรหัสนักเรียนไม่ได้'}</div>
              <select value="" onChange={(e) => e.target.value && setScanStudent(rec.id, e.target.value)}>
                <option value="">เลือกนักเรียนเอง…</option>
                {students.map((s) => (
                  <option key={s.id} value={s.code}>
                    {s.number}. {s.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="score">
          <strong>{formatScore(g.score)}</strong>
          <span>/ {formatScore(g.maxScore)}</span>
        </div>
      </div>
      <GradeStrip status={g.status} />
      {rec.uncertain.length > 0 && <p className="hint warn">ฝนไม่ชัด ควรตรวจทาน: ข้อ {rec.uncertain.join(', ')}</p>}
    </div>
  )
}

function RecentList({ exam, onPick }: { exam: Exam; onPick: (id: string) => void }) {
  const db = useDB()
  const scans = scansOf(db, exam.id).slice(0, 8)
  const students = studentsOf(db, exam.classroomId)
  if (scans.length === 0) return null
  return (
    <div className="card recent">
      <div className="recent-head">
        <strong>ล่าสุด</strong>
        <a href={`#/exams/${exam.id}`}>ดูผลทั้งหมด →</a>
      </div>
      <ul>
        {scans.map((s) => {
          const st = students.find((x) => x.code === s.studentCode)
          const g = grade(s.answers, exam.key)
          return (
            <li key={s.id}>
              <button onClick={() => onPick(s.id)}>
                <span>{st ? `${st.number}. ${st.name}` : s.studentCode ? `รหัส ${s.studentCode} (ไม่พบ)` : 'อ่านรหัสไม่ได้'}</span>
                <strong>{formatScore(g.score)}</strong>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
