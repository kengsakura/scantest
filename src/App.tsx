import type { ReactNode } from 'react'
import { CLOUD, dismissError, logout, useAppState, useCurrentUser, useDB } from './data/store'
import { go, useRoute } from './lib/router'
import { AdminClassesPage } from './pages/AdminClassesPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { ExamsPage } from './pages/ExamsPage'
import { KeyPage } from './pages/KeyPage'
import { LoginPage } from './pages/LoginPage'
import { NewExamPage } from './pages/NewExamPage'
import { PaperPage } from './pages/PaperPage'
import { PrintPage } from './pages/PrintPage'
import { ResultsPage } from './pages/ResultsPage'
import { ScanPage } from './pages/ScanPage'

export default function App() {
  const user = useCurrentUser()
  const route = useRoute()
  const db = useDB()
  const { phase, error } = useAppState()
  if (phase === 'starting' || phase === 'loading') return <div className="splash">กำลังโหลด…</div>
  if (phase === 'signed-out' || !user) {
    if (CLOUD && phase === 'ready') return <PendingPage reason="no-profile" error={error} />
    return <LoginPage />
  }
  if (user.role === 'pending') return <PendingPage reason="pending" error={error} />

  const [section, id, sub, extra] = route
  let page: ReactNode
  if (section === 'exams' && id === 'new') page = <NewExamPage user={user} />
  else if (section === 'exams' && id && sub === 'key') page = <KeyPage examId={id} />
  else if (section === 'exams' && id && sub === 'print') page = <PrintPage examId={id} />
  else if (section === 'exams' && id && sub === 'scan') page = <ScanPage examId={id} user={user} />
  else if (section === 'exams' && id && sub === 'paper' && extra) page = <PaperPage examId={id} scanId={extra} />
  else if (section === 'exams' && id && sub === 'analysis') page = <AnalysisPage examId={id} />
  else if (section === 'exams' && id) page = <ResultsPage examId={id} />
  else if (section === 'classes' && user.role === 'admin') page = <AdminClassesPage selectedId={id} />
  else if (section === 'users' && user.role === 'admin') page = <AdminUsersPage />
  else page = <ExamsPage user={user} />

  const nav = (path: string, label: string) => (
    <a href={`#/${path}`} className={section === path || (!section && path === 'exams') ? 'active' : ''}>
      {label}
    </a>
  )

  return (
    <div className="app">
      <header className="topbar no-print">
        <button className="brand" onClick={() => go('/exams')}>
          <span className="brand-mark" aria-hidden>
            ◉
          </span>
          <span>
            <strong>ScanTest</strong>
            <small>{db.settings.schoolName}</small>
          </span>
        </button>
        <nav>
          {nav('exams', 'ข้อสอบ')}
          {user.role === 'admin' && nav('classes', 'ห้องเรียน')}
          {user.role === 'admin' && nav('users', 'ผู้ใช้ & ตั้งค่า')}
        </nav>
        <div className="who">
          <span>
            {user.name}
            <small>{user.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ครู'}</small>
          </span>
          <button className="btn ghost small" onClick={logout}>
            ออกจากระบบ
          </button>
        </div>
      </header>
      {!CLOUD && <div className="demo-banner no-print">โหมดทดลอง: ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น (ยังไม่เชื่อมฐานข้อมูลกลาง)</div>}
      {error && (
        <div className="error-bar no-print" role="alert">
          <span>{error}</span>
          <button className="btn ghost small" onClick={dismissError}>
            ปิด
          </button>
        </div>
      )}
      <main className="content">{page}</main>
    </div>
  )
}

function PendingPage({ reason, error }: { reason: 'pending' | 'no-profile'; error: string | null }) {
  return (
    <div className="login">
      <div className="card login-card">
        <h1>{reason === 'pending' ? 'รอผู้ดูแลระบบอนุมัติ' : 'ไม่พบบัญชีผู้ใช้'}</h1>
        <p className="muted">
          {reason === 'pending'
            ? 'สมัครเรียบร้อยแล้ว ให้ผู้ดูแลระบบของโรงเรียนอนุมัติบัญชีของคุณ (หน้า ผู้ใช้ & ตั้งค่า) แล้วกดรีเฟรชหน้านี้'
            : 'บัญชีนี้ยังไม่มีข้อมูลผู้ใช้ในระบบ หรือถูกลบไปแล้ว ติดต่อผู้ดูแลระบบ'}
        </p>
        {error && <p className="hint warn">{error}</p>}
        <div className="head-actions">
          <button className="btn" onClick={() => window.location.reload()}>
            รีเฟรช
          </button>
          <button className="btn secondary" onClick={logout}>
            ออกจากระบบ
          </button>
        </div>
      </div>
    </div>
  )
}
