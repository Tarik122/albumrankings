export type TabId = 'compare' | 'leaderboard' | 'discover' | 'library' | 'settings'

const TABS: { id: TabId; label: string }[] = [
  { id: 'compare', label: 'Compare' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'discover', label: 'Discover' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' },
]

export function Tabs({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) {
  return (
    <nav className="flex flex-wrap gap-1 rounded-xl border border-ink-800 bg-ink-900 p-1">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? 'page' : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            active === tab.id
              ? 'bg-ink-700 text-white'
              : 'text-ink-500 hover:bg-ink-800 hover:text-ink-300'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
