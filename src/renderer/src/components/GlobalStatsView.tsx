import { useEffect, useState } from 'react'
import type { GlobalStats } from '../types/stats'

export function GlobalStatsView() {
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.getGlobalStats()
      .then((s) => { setStats(s as GlobalStats | null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const recent = stats
    ? [...stats.dailyActivity].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)
    : []

  // Aggregate model tokens across shown days
  const modelTotals: Record<string, number> = {}
  if (stats) {
    const shownDates = new Set(recent.map((d) => d.date))
    for (const row of stats.dailyModelTokens) {
      if (!shownDates.has(row.date)) continue
      for (const [model, tokens] of Object.entries(row.tokensByModel)) {
        modelTotals[model] = (modelTotals[model] || 0) + tokens
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-surface-0 pt-[38px] min-w-0">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold text-text-primary">Stats</h2>
        <p className="text-[11px] text-text-muted mt-0.5">Local Claude CLI activity</p>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          Loading stats…
        </div>
      )}

      {!loading && !stats && (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          No stats found. Run some Claude sessions first.
        </div>
      )}

      {!loading && stats && (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Daily Activity */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-3">
              Daily Activity (last 30 days)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-text-muted border-b border-border">
                    <th className="text-left py-1.5 pr-4 font-medium">Date</th>
                    <th className="text-right py-1.5 pr-4 font-medium">Sessions</th>
                    <th className="text-right py-1.5 pr-4 font-medium">Messages</th>
                    <th className="text-right py-1.5 font-medium">Tool Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => (
                    <tr key={row.date} className="border-b border-border/40 hover:bg-surface-1 transition-colors">
                      <td className="py-1.5 pr-4 font-mono text-text-secondary">{row.date}</td>
                      <td className="py-1.5 pr-4 text-right text-text-primary">{row.sessionCount}</td>
                      <td className="py-1.5 pr-4 text-right text-text-primary">{row.messageCount}</td>
                      <td className="py-1.5 text-right text-text-primary">{row.toolCallCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Model Token Totals */}
          {Object.keys(modelTotals).length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-3">
                Tokens by Model (shown period)
              </h3>
              <div className="space-y-1.5">
                {Object.entries(modelTotals)
                  .sort(([, a], [, b]) => b - a)
                  .map(([model, tokens]) => (
                    <div key={model} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-text-secondary truncate mr-4">{model}</span>
                      <span className="text-text-primary shrink-0">{tokens.toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* Footer */}
          <p className="text-[10px] text-text-muted">
            Last computed: {stats.lastComputedDate}
          </p>
        </div>
      )}
    </div>
  )
}
