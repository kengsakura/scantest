import { useState, type FormEvent } from 'react'
import { CLOUD, login, signInWithPassword, signUp, useDB } from '../data/store'

export function LoginPage() {
  return (
    <div className="login">
      <div className="card login-card">
        <div className="login-brand">
          <span className="brand-mark big" aria-hidden>
            ◉
          </span>
          <h1>ScanTest</h1>
          <p className="muted">ระบบตรวจกระดาษคำตอบ</p>
        </div>
        {CLOUD ? <CloudLogin /> : <DemoLogin />}
      </div>
    </div>
  )
}

function CloudLogin() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    if (mode === 'signin') {
      const err = await signInWithPassword(email.trim(), password)
      if (err) setError(err)
    } else {
      const res = await signUp(email.trim(), password, name.trim())
      if (res.error) setError(res.error)
      else if (res.needsConfirm) setNotice('สมัครแล้ว กรุณาเปิดอีเมลแล้วกดลิงก์ยืนยัน จากนั้นกลับมาเข้าสู่ระบบ')
    }
    setBusy(false)
  }

  return (
    <>
      {mode === 'signup' && (
        <p className="notice">ตั้งค่าครั้งแรก: บัญชีแรกที่สมัครจะเป็นผู้ดูแลระบบ จากนั้นผู้ดูแลระบบสร้างบัญชีให้ครูเองที่เมนู จัดการระบบ</p>
      )}
      <form onSubmit={submit}>
        {mode === 'signup' && (
          <label>
            ชื่อ-สกุล
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label>
          {mode === 'signin' ? 'ชื่อผู้ใช้' : 'อีเมล'}
          <input
            type={mode === 'signin' ? 'text' : 'email'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete={mode === 'signin' ? 'username' : 'email'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label>
          รหัสผ่าน
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className="hint warn">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <button className="btn block" disabled={busy}>
          {busy ? 'กำลังดำเนินการ…' : mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัคร'}
        </button>
      </form>
      <button type="button" className="btn ghost small" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'ตั้งค่าระบบครั้งแรก (สร้างบัญชีผู้ดูแลระบบ)' : '← กลับไปเข้าสู่ระบบ'}
      </button>
    </>
  )
}

function DemoLogin() {
  const db = useDB()
  return (
    <>
      <div className="divider">
        <span>โหมดทดลอง เลือกผู้ใช้</span>
      </div>
      <ul className="user-pick">
        {db.users.map((u) => (
          <li key={u.id}>
            <button className="btn secondary block" onClick={() => login(u.id)}>
              <span>{u.name}</span>
              <small>{u.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ครู'}</small>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
