import type { ReactNode } from 'react'
import { logout, useCurrentUser, useDB } from './data/store'
import { go, useRoute } from './lib/router'
import { AdminClassesPage } from './pages/AdminClassesPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { ExamsPage } from './pages/ExamsPage'
import { KeyPage } from './pages/KeyPage'
import { LoginPage } from './pages/LoginPage'
import { NewExamPage } from './pages/NewExamPage'
import { PrintPage } from './pages/PrintPage'
import { ResultsPage } from './pages/ResultsPage'
import { ScanPage } from './pages/ScanPage'

export default function App() {
  const user = useCurrentUser()
  const route = useRoute()
  const db = useDB()
  if (!user) return <LoginPage />

  const [section, id, sub] = route
  let page: ReactNode
  if (section === 'exams' && id === 'new') page = <NewExamPage user={user} />
  else if (section === 'exams' && id && sub === 'key') page = <KeyPage examId={id} />
  else if (section === 'exams' && id && sub === 'print') page = <PrintPage examId={id} />
  else if (section === 'exams' && id && sub === 'scan') page = <ScanPage examId={id} user={user} />
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
      <div className="demo-banner no-print">โหมดทดลอง: ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น (ยังไม่เชื่อมฐานข้อมูลกลาง)</div>
      <main className="content">{page}</main>
    </div>
  )
}
