import { lazy, Suspense, type ReactNode } from 'react'
import { CLOUD, dismissError, logout, setViewTerm, useAppState, useCurrentUser, useDB, useViewTerm } from './data/store'
import { compareTerms, termLabel } from './lib/terms'
import { go, useRoute } from './lib/router'
import { ExamsPage } from './pages/ExamsPage'
import { LoginPage } from './pages/LoginPage'

// Pages load on demand so the first screen (login / exam list) downloads less on phones.
const AdminPage = lazy(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })))
const ExportPage = lazy(() => import('./pages/ExportPage').then((m) => ({ default: m.ExportPage })))
const AnalysisPage = lazy(() => import('./pages/AnalysisPage').then((m) => ({ default: m.AnalysisPage })))
const KeyPage = lazy(() => import('./pages/KeyPage').then((m) => ({ default: m.KeyPage })))
const NewExamPage = lazy(() => import('./pages/NewExamPage').then((m) => ({ default: m.NewExamPage })))
const PaperPage = lazy(() => import('./pages/PaperPage').then((m) => ({ default: m.PaperPage })))
const PrintPage = lazy(() => import('./pages/PrintPage').then((m) => ({ default: m.PrintPage })))
const ResultsPage = lazy(() => import('./pages/ResultsPage').then((m) => ({ default: m.ResultsPage })))
const ScanPage = lazy(() => import('./pages/ScanPage').then((m) => ({ default: m.ScanPage })))

export default function App() {
  const user = useCurrentUser()
  const route = useRoute()
  const db = useDB()
  const { phase, error } = useAppState()
  const viewTerm = useViewTerm()
  if (phase === 'starting' || phase === 'loading') return <div className="splash">กำลังโหลด…</div>
  if (phase === 'signed-out' || !user) {
    if (CLOUD && phase === 'ready') return <PendingPage reason="no-profile" error={error} />
    return <LoginPage />
  }
  if (user.role === 'pending') return <PendingPage reason="pending" error={error} />

  const [section, id, sub, extra] = route
  let content: ReactNode
  if (section === 'exams' && id === 'new') content = <NewExamPage user={user} />
  else if (section === 'exams' && id && sub === 'key') content = <KeyPage examId={id} />
  else if (section === 'exams' && id && sub === 'print') content = <PrintPage examId={id} />
  else if (section === 'exams' && id && sub === 'scan') content = <ScanPage examId={id} user={user} />
  else if (section === 'exams' && id && sub === 'paper' && extra) content = <PaperPage examId={id} scanId={extra} />
  else if (section === 'exams' && id && sub === 'analysis') content = <AnalysisPage examId={id} />
  else if (section === 'exams' && id && sub === 'export') content = <ExportPage examId={id} />
  else if (section === 'exams' && id) content = <ResultsPage examId={id} />
  else if (section === 'admin' && user.role === 'admin') content = <AdminPage tab={id} sub={sub} />
  else content = <ExamsPage user={user} />

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
          {user.role === 'admin' && nav('admin', 'จัดการระบบ')}
        </nav>
        <label className="term-pick" title="ภาคเรียนที่กำลังดู">
          <span>ภาคเรียน</span>
          <select value={viewTerm?.id ?? ''} onChange={(e) => setViewTerm(e.target.value)}>
            {[...db.terms].sort(compareTerms).reverse().map((t) => (
              <option key={t.id} value={t.id}>
                {termLabel(t)}
                {t.id === db.settings.currentTermId ? ' (ปัจจุบัน)' : ''}
              </option>
            ))}
          </select>
        </label>
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
      {viewTerm && viewTerm.id !== db.settings.currentTermId && (
        <div className="old-term-bar no-print">
          กำลังดูข้อมูลภาคเรียน {termLabel(viewTerm)} (ไม่ใช่ภาคเรียนปัจจุบัน)
          {db.settings.currentTermId && (
            <button className="btn ghost small" onClick={() => setViewTerm(db.settings.currentTermId!)}>
              กลับภาคเรียนปัจจุบัน
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="error-bar no-print" role="alert">
          <span>{error}</span>
          <button className="btn ghost small" onClick={dismissError}>
            ปิด
          </button>
        </div>
      )}
      <main className="content">
        <Suspense fallback={<p className="muted">กำลังโหลด…</p>}>{content}</Suspense>
      </main>
    </div>
  )
}

function PendingPage({ reason, error }: { reason: 'pending' | 'no-profile'; error: string | null }) {
  return (
    <div className="login">
      <div className="card login-card">
        <h1>{reason === 'pending' ? 'บัญชียังใช้งานไม่ได้' : 'ไม่พบบัญชีผู้ใช้'}</h1>
        <p className="muted">
          {reason === 'pending'
            ? 'บัญชีนี้ยังไม่ได้รับอนุมัติ หรือถูกปิดใช้งาน ติดต่อผู้ดูแลระบบของโรงเรียน (เมนู จัดการระบบ → ครู & ผู้ใช้) แล้วกดรีเฟรช'
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
