import { useState } from 'react'
import { addUser, CLOUD, removeAllowedEmail, removeUser, updateSettings, updateUser, useCurrentUser, useDB } from '../data/store'
import type { Role } from '../data/types'
import { MAX_ID_DIGITS, MIN_ID_DIGITS } from '../omr/config'

export function AdminUsersPage() {
  const db = useDB()
  const me = useCurrentUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('teacher')
  const pending = db.users.filter((u) => u.role === 'pending')
  const members = db.users.filter((u) => u.role !== 'pending')

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>ผู้ใช้และการตั้งค่า</h1>
        </div>
      </div>

      <div className="card form">
        <h2>ตั้งค่าโรงเรียน</h2>
        <label>
          ชื่อโรงเรียน
          <input value={db.settings.schoolName} onChange={(e) => updateSettings({ schoolName: e.target.value })} />
        </label>
        <label>
          จำนวนหลักของรหัสนักเรียน
          <select value={db.settings.idDigits} onChange={(e) => updateSettings({ idDigits: Number(e.target.value) })}>
            {Array.from({ length: MAX_ID_DIGITS - MIN_ID_DIGITS + 1 }, (_, i) => i + MIN_ID_DIGITS).map((n) => (
              <option key={n} value={n}>
                {n} หลัก
              </option>
            ))}
          </select>
          <span className="hint">มีผลกับข้อสอบที่สร้างใหม่ ข้อสอบเดิมใช้รูปแบบกระดาษเดิม</span>
        </label>
      </div>

      {CLOUD && pending.length > 0 && (
        <div className="card attention">
          <h2>รออนุมัติ ({pending.length})</h2>
          <table className="table">
            <tbody>
              {pending.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.name}
                    <div className="muted small">{u.email}</div>
                  </td>
                  <td className="num">
                    <div className="head-actions end">
                      <button className="btn small" onClick={() => updateUser(u.id, { role: 'teacher' })}>
                        อนุมัติเป็นครู
                      </button>
                      <button className="btn secondary small" onClick={() => updateUser(u.id, { role: 'admin' })}>
                        เป็นผู้ดูแลระบบ
                      </button>
                      <button className="btn ghost small danger" onClick={() => confirm(`ปฏิเสธ ${u.name}?`) && removeUser(u.id)}>
                        ปฏิเสธ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>ผู้ใช้ ({members.length})</h2>
        <table className="table">
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th className="hide-sm">อีเมล</th>
              <th>สิทธิ์</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="hide-sm">{u.email}</td>
                <td>
                  <select value={u.role} disabled={u.id === me?.id} onChange={(e) => updateUser(u.id, { role: e.target.value as Role })}>
                    <option value="teacher">ครู</option>
                    <option value="admin">ผู้ดูแลระบบ</option>
                  </select>
                </td>
                <td className="num">
                  {u.id !== me?.id && (
                    <button className="btn ghost small danger" onClick={() => confirm(`ลบผู้ใช้ ${u.name}?`) && removeUser(u.id)}>
                      ลบ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {CLOUD && (
          <>
            <h2 className="mt">อีเมลที่อนุมัติล่วงหน้า</h2>
            <p className="hint">ครูที่สมัครด้วยอีเมลเหล่านี้จะใช้งานได้ทันทีโดยไม่ต้องรออนุมัติ</p>
            {db.allowedEmails.length > 0 && (
              <ul className="plain-list">
                {db.allowedEmails.map((a) => (
                  <li key={a.email}>
                    <span>
                      {a.name ? `${a.name} · ` : ''}
                      {a.email} <span className="muted small">({a.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ครู'})</span>
                    </span>
                    <button className="btn ghost small danger" onClick={() => removeAllowedEmail(a.email)}>
                      ลบ
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <form
          className="inline-form wrap"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim() || (CLOUD && !email.trim())) return
            addUser({ name: name.trim(), email: email.trim(), role })
            setName('')
            setEmail('')
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ-สกุลครู" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="อีเมลโรงเรียน" type="email" />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="teacher">ครู</option>
            <option value="admin">ผู้ดูแลระบบ</option>
          </select>
          <button className="btn small" disabled={!name.trim() || (CLOUD && !email.trim())}>
            {CLOUD ? 'อนุมัติอีเมลล่วงหน้า' : 'เพิ่มผู้ใช้'}
          </button>
        </form>
      </div>
    </section>
  )
}
