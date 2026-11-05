import { useState } from 'react'
import { CLOUD, createUser, deleteUser, setUserPassword, updateUser, useCurrentUser, useDB, type NewUser } from '../../data/store'
import type { Role, User } from '../../data/types'
import { importTeachers, TEACHER_TEMPLATE, type ImportResult, type TeacherRow } from '../../lib/importers'
import { buildXlsx, downloadBytes, readSpreadsheet, XLSX_TYPE } from '../../lib/xlsx'

const ROLE_TEXT: Record<Role, string> = { admin: 'ผู้ดูแลระบบ', teacher: 'ครู', pending: 'ปิดใช้งาน / รออนุมัติ' }

/** Easy-to-type random password, e.g. "kru-4827-mz". */
function randomPassword(): string {
  const n = crypto.getRandomValues(new Uint32Array(2))
  const letters = 'abcdefghjkmnpqrstuvwxyz'
  return `kru-${1000 + (n[0] % 9000)}-${letters[n[1] % 23]}${letters[(n[1] >> 8) % 23]}`
}

export function UsersTab() {
  const db = useDB()
  const me = useCurrentUser()
  const pending = db.users.filter((u) => u.role === 'pending')
  const active = db.users.filter((u) => u.role !== 'pending')

  return (
    <div className="admin-stack">
      <AddUser />
      <ImportUsers />
      <div className="card table-card">
        <div className="table-tools">
          <strong>ผู้ใช้ ({active.length})</strong>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th>ชื่อผู้ใช้</th>
              <th>สิทธิ์</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.map((u) => (
              <UserRow key={u.id} u={u} isMe={u.id === me?.id} />
            ))}
          </tbody>
        </table>
      </div>
      {pending.length > 0 && (
        <div className="card table-card attention">
          <div className="table-tools">
            <strong>ปิดใช้งาน / รออนุมัติ ({pending.length})</strong>
          </div>
          <table className="table">
            <tbody>
              {pending.map((u) => (
                <UserRow key={u.id} u={u} isMe={false} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function UserRow({ u, isMe }: { u: User; isMe: boolean }) {
  const db = useDB()
  const [msg, setMsg] = useState('')
  const exams = db.exams.filter((e) => e.ownerId === u.id).length

  const resetPassword = async () => {
    const pw = prompt(`ตั้งรหัสผ่านใหม่ให้ ${u.name} (อย่างน้อย 6 ตัว)`, randomPassword())
    if (!pw) return
    const err = await setUserPassword(u.id, pw)
    setMsg(err ?? `ตั้งรหัสผ่านใหม่แล้ว: ${pw}`)
  }

  return (
    <tr>
      <td>
        {u.name}
        {isMe && <span className="badge">คุณ</span>}
      </td>
      <td className="muted">{u.username ?? u.email}</td>
      <td>
        <select value={u.role} disabled={isMe} onChange={(e) => updateUser(u.id, { role: e.target.value as Role })} aria-label={`สิทธิ์ของ ${u.name}`}>
          <option value="teacher">{ROLE_TEXT.teacher}</option>
          <option value="admin">{ROLE_TEXT.admin}</option>
          <option value="pending">{ROLE_TEXT.pending}</option>
        </select>
        {msg && <div className="hint">{msg}</div>}
      </td>
      <td className="num">
        <div className="head-actions end">
          {CLOUD && (
            <button className="btn ghost small" onClick={resetPassword}>
              ตั้งรหัสผ่านใหม่
            </button>
          )}
          {!isMe && (
            <button
              className="btn ghost small danger"
              onClick={async () => {
                if (exams) return alert(`${u.name} มีข้อสอบ ${exams} ชุด ลบไม่ได้ ให้เปลี่ยนสิทธิ์เป็น "ปิดใช้งาน" แทน`)
                if (confirm(`ลบบัญชี ${u.name}?`)) setMsg((await deleteUser(u.id)) ?? '')
              }}
            >
              ลบ
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function AddUser() {
  const [f, setF] = useState<NewUser>({ username: '', password: randomPassword(), name: '', role: 'teacher' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const valid = /^[a-z0-9._-]{3,40}$/.test(f.username.trim().toLowerCase()) && f.password.length >= 6 && f.name.trim() !== ''

  const submit = async () => {
    setBusy(true)
    const err = await createUser({ ...f, name: f.name.trim() })
    setBusy(false)
    if (err) setMsg({ ok: false, text: err })
    else {
      setMsg({ ok: true, text: `สร้างบัญชีแล้ว · ชื่อผู้ใช้: ${f.username.trim().toLowerCase()} · รหัสผ่าน: ${f.password} (แจ้งครูได้เลย)` })
      setF({ username: '', password: randomPassword(), name: '', role: 'teacher' })
    }
  }

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) void submit()
      }}
    >
      <h2>เพิ่มครู / ผู้ใช้</h2>
      <div className="user-form">
        <label>
          ชื่อ-สกุล
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="เช่น นายสมชาย ใจดี" />
        </label>
        <label>
          ชื่อผู้ใช้ (ใช้ล็อกอิน)
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="a-z 0-9 . _ -" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        <label>
          รหัสผ่าน
          <span className="inline-fields">
            <input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
            <button type="button" className="btn ghost small" onClick={() => setF({ ...f, password: randomPassword() })}>
              สุ่มใหม่
            </button>
          </span>
        </label>
        <label>
          สิทธิ์
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'admin' | 'teacher' })}>
            <option value="teacher">ครู</option>
            <option value="admin">ผู้ดูแลระบบ</option>
          </select>
        </label>
      </div>
      {f.username && !/^[a-z0-9._-]{3,40}$/.test(f.username.trim().toLowerCase()) && <p className="hint warn">ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3-40 ตัว</p>}
      <div className="inline-fields">
        <button className="btn" disabled={!valid || busy}>
          {busy ? 'กำลังสร้าง…' : 'สร้างบัญชี'}
        </button>
        {!CLOUD && <span className="hint">โหมดทดลองไม่มีรหัสผ่านจริง</span>}
      </div>
      {msg && <p className={msg.ok ? 'notice' : 'hint warn'}>{msg.text}</p>}
    </form>
  )
}

function ImportUsers() {
  const [parsed, setParsed] = useState<ImportResult<TeacherRow> | null>(null)
  const [progress, setProgress] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (file: File) => {
    setProgress(null)
    try {
      setParsed(importTeachers(readSpreadsheet(new Uint8Array(await file.arrayBuffer()))))
    } catch {
      setParsed({ rows: [], errors: ['อ่านไฟล์ไม่ได้ ใช้ไฟล์ .xlsx หรือ .csv'] })
    }
  }

  const run = async () => {
    if (!parsed) return
    setBusy(true)
    const log: string[] = []
    for (const [i, r] of parsed.rows.entries()) {
      const err = await createUser(r)
      log.push(err ? `✗ ${r.username}: ${err}` : `✓ ${r.username}`)
      setProgress([`${i + 1}/${parsed.rows.length}`, ...log])
    }
    setBusy(false)
    setParsed(null)
  }

  return (
    <details className="card import-box">
      <summary>นำเข้าบัญชีครูจากไฟล์ Excel / CSV</summary>
      <p className="hint">
        คอลัมน์: <b>ชื่อผู้ใช้ · รหัสผ่าน · ชื่อ-สกุล · สิทธิ์</b> (สิทธิ์ใส่ "ครู" หรือ "แอดมิน" เว้นว่าง = ครู)
      </p>
      <div className="inline-fields">
        <label className="btn secondary small">
          เลือกไฟล์…
          <input type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        <button className="btn ghost small" onClick={() => downloadBytes(buildXlsx([{ name: 'ครู', rows: TEACHER_TEMPLATE, boldRows: [0], colWidths: [16, 16, 26, 10] }]), 'แบบฟอร์มนำเข้าครู.xlsx', XLSX_TYPE)}>
          ดาวน์โหลดแบบฟอร์ม
        </button>
      </div>
      {parsed && (
        <div className="paste-result">
          <strong>พร้อมสร้าง {parsed.rows.length} บัญชี</strong>
          <button className="btn small" disabled={!parsed.rows.length || busy} onClick={run}>
            สร้างบัญชีทั้งหมด
          </button>
          {parsed.errors.length > 0 && <pre className="hint warn">{parsed.errors.join('\n')}</pre>}
        </div>
      )}
      {progress && <pre className="hint">{progress.join('\n')}</pre>}
    </details>
  )
}
