import { useState } from 'react'
import { addUser, removeUser, updateSettings, updateUser, useCurrentUser, useDB } from '../data/store'
import type { Role } from '../data/types'
import { MAX_ID_DIGITS, MIN_ID_DIGITS } from '../omr/config'

export function AdminUsersPage() {
  const db = useDB()
  const me = useCurrentUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('teacher')

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

      <div className="card">
        <h2>ผู้ใช้ ({db.users.length})</h2>
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
            {db.users.map((u) => (
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
        <form
          className="inline-form wrap"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
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
          <button className="btn small" disabled={!name.trim()}>
            เพิ่มผู้ใช้
          </button>
        </form>
      </div>
    </section>
  )
}
