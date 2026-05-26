import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'

const TYPES = ['', 'added', 'removed', 'price_up', 'price_down']
const TYPE_LABELS = { '': 'Alle', added: 'Ny vin', removed: 'Fjernet', price_up: 'Prisstigning', price_down: 'Prisfald' }
const TYPE_BADGE  = { added: 'badge-added', removed: 'badge-removed', price_up: 'badge-up', price_down: 'badge-down' }
const TYPE_ICON   = { added: '+', removed: '−', price_up: '↑', price_down: '↓' }

export default function ChangeLog() {
  const [changes, setChanges]   = useState([])
  const [total, setTotal]       = useState(0)
  const [type, setType]         = useState('')
  const [days, setDays]         = useState(30)
  const [page, setPage]         = useState(0)
  const [loading, setLoading]   = useState(true)
  const PER_PAGE = 60

  // Group changes by date for the timeline view
  const grouped = changes.reduce((acc, c) => {
    const d = new Date(c.created_at)
    // Short date: "26 maj", "25 maj" etc.
    const key = d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })
    if (!acc[key]) acc[key] = []
    acc[key].push(c)
    return acc
  }, {})

  const load = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - days * 86400000).toISOString()

    let q = supabase
      .from('recent_changes')
      .select('*', { count: 'exact' })
      .gte('created_at', since)

    if (type) q = q.eq('change_type', type)

    const { data, count } = await q
      .order('created_at', { ascending: false })
      .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)

    setChanges(data || [])
    setTotal(count || 0)
    setLoading(false)
  }, [type, days, page])

  useEffect(() => { setPage(0) }, [type, days])
  useEffect(() => { load() }, [load])

  return (
    <div className="container" style={{ paddingTop: '3rem', paddingBottom: '4rem' }}>

      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ color: 'var(--gold)', fontStyle: 'italic' }}>Historik</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.3rem', fontFamily: 'var(--sans)' }}>
          Alle observerede ændringer på vinkortet · {total.toLocaleString('da-DK')} poster
        </div>
      </div>

      {/* Filter bar */}
      <div className="fade-up-2" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '2rem', alignItems: 'center' }}>
        {TYPES.map(t => (
          <button key={t} className={`btn ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>
            {TYPE_ICON[t] && <span style={{ marginRight: '0.3rem' }}>{TYPE_ICON[t]}</span>}
            {TYPE_LABELS[t]}
          </button>
        ))}

        <select className="filter-select" value={days} onChange={e => setDays(Number(e.target.value))} style={{ marginLeft: 'auto' }}>
          <option value={7}>Seneste 7 dage</option>
          <option value={30}>Seneste 30 dage</option>
          <option value={90}>Seneste 3 måneder</option>
          <option value={365}>Seneste år</option>
        </select>
      </div>

      {/* Timeline */}
      {loading ? (
        <div>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ marginBottom: '2rem' }}>
              <div className="skeleton" style={{ height: 18, width: 80, marginBottom: '0.75rem' }} />
              <div className="card" style={{ padding: 0 }}>
                {[...Array(3)].map((_, j) => (
                  <div key={j} style={{ padding: '0.9rem 1.25rem', borderBottom: j < 2 ? '1px solid rgba(201,169,110,0.07)' : 'none' }}>
                    <div className="skeleton" style={{ height: 18, width: '70%' }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="card fade-up-2" style={{ padding: '2rem' }}>
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>
            Ingen ændringer i den valgte periode.
          </div>
        </div>
      ) : (
        Object.entries(grouped).map(([dateLabel, items], groupIdx) => (
          <div key={dateLabel} className={`fade-up-${Math.min(groupIdx + 2, 4)}`}
            style={{ marginBottom: '2rem' }}>

            {/* Date header — exactly: "26 maj", "25 maj" */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '72px 1fr',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '0.6rem',
            }}>
              <div style={{
                fontFamily: 'var(--serif)',
                fontStyle: 'italic',
                fontSize: '1rem',
                color: 'var(--gold)',
              }}>
                {dateLabel}
              </div>
              <div style={{ height: 1, background: 'var(--border)' }} />
            </div>

            {/* Rows for this date — same 3-col layout as header */}
            <div className="card" style={{ padding: 0 }}>
              {/* Column headers (only once per group, subtle) */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '72px 36px 1fr',
                gap: '0.75rem',
                padding: '0.45rem 1.25rem',
                borderBottom: '1px solid rgba(201,169,110,0.1)',
              }}>
                <div style={{ fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Tidspunkt</div>
                <div />
                <div style={{ fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Ændring</div>
              </div>

              {items.map((c, i) => {
                const badge = TYPE_BADGE[c.change_type] || ''
                const icon  = TYPE_ICON[c.change_type]  || '·'
                const time  = new Date(c.created_at).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })

                return (
                  <div key={c.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '72px 36px 1fr',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.85rem 1.25rem',
                    borderBottom: i < items.length - 1 ? '1px solid rgba(201,169,110,0.07)' : 'none',
                    transition: 'background 0.15s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,169,110,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Time */}
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--sans)', fontVariantNumeric: 'tabular-nums' }}>
                      {time}
                    </div>

                    {/* Badge */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <span className={`badge ${badge}`} style={{ fontSize: '0.72rem', minWidth: 24, textAlign: 'center', padding: '0.15em 0.5em' }}>
                        {icon}
                      </span>
                    </div>

                    {/* Description + link */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                      <div style={{ fontFamily: 'var(--serif)', fontSize: '0.92rem', fontStyle: 'italic', lineHeight: 1.4 }}>
                        {c.description}
                      </div>
                      {c.wine_id && (
                        <Link to={`/wines/${c.wine_id}`}
                          style={{ fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          Se vin →
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {/* Pagination */}
      {total > PER_PAGE && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem', alignItems: 'center' }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Forrige</button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0 1rem' }}>
            Side {page + 1} / {Math.ceil(total / PER_PAGE)}
          </span>
          <button className="btn" disabled={(page + 1) * PER_PAGE >= total} onClick={() => setPage(p => p + 1)}>Næste →</button>
        </div>
      )}
    </div>
  )
}
