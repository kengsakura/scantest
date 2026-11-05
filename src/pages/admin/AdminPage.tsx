import { ClassesTab } from './ClassesTab'
import { PresetsTab } from './PresetsTab'
import { SettingsTab } from './SettingsTab'
import { TermsTab } from './TermsTab'
import { UsersTab } from './UsersTab'

const TABS = [
  { id: 'classes', label: 'ห้องเรียน & นักเรียน' },
  { id: 'terms', label: 'ภาคเรียน & เลื่อนชั้น' },
  { id: 'users', label: 'ครู & ผู้ใช้' },
  { id: 'presets', label: 'แบบกระดาษคำตอบ' },
  { id: 'settings', label: 'ตั้งค่าโรงเรียน' },
] as const

export function AdminPage({ tab, sub }: { tab?: string; sub?: string }) {
  const current = TABS.find((t) => t.id === tab)?.id ?? 'classes'
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>จัดการระบบ</h1>
        </div>
      </div>
      <nav className="tabbar" aria-label="เมนูผู้ดูแลระบบ">
        {TABS.map((t) => (
          <a key={t.id} href={`#/admin/${t.id}`} className={current === t.id ? 'on' : ''} aria-current={current === t.id ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
      {current === 'classes' && <ClassesTab selectedId={sub} />}
      {current === 'terms' && <TermsTab />}
      {current === 'users' && <UsersTab />}
      {current === 'presets' && <PresetsTab />}
      {current === 'settings' && <SettingsTab />}
    </section>
  )
}
