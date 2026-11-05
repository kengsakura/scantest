import { login, useDB } from '../data/store'

export function LoginPage() {
  const db = useDB()
  return (
    <div className="login">
      <div className="card login-card">
        <div className="login-brand">
          <span className="brand-mark big" aria-hidden>
            ◉
          </span>
          <h1>ScanTest</h1>
          <p className="muted">{db.settings.schoolName} · ระบบตรวจกระดาษคำตอบ</p>
        </div>
        <button className="btn block" disabled title="ใช้ได้เมื่อเชื่อม Supabase แล้ว">
          เข้าสู่ระบบด้วย Google (เร็วๆ นี้)
        </button>
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
      </div>
    </div>
  )
}
