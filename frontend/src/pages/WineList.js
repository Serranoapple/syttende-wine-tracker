import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'

const CATEGORIES = ['', 'white', 'red', 'rose', 'sparkling', 'dessert', 'avec', 'non_alcoholic']
const CAT_LABELS  = { '': 'Alle', white: 'Hvidvin', red: 'Rødvin', rose: 'Rosé', sparkling: 'Mousserende', dessert: 'Dessertvin', avec: 'Avec', non_alcoholic: 'Alkoholfri' }
const CAT_BADGE   = { white: 'badge-white', red: 'badge-red', rose: 'badge-rose', sparkling: 'badge-sparkling', dessert: 'badge-dessert', non_alcoholic: 'badge-white' }

export default function WineList() {
  const [wines, setWines]       = useState([])
  const [total, setTotal]       = useState(0)
  const [query, setQuery]       = useState('')
  const [category, setCategory] = useState('')
  const [sort, setSort]         = useState('price_desc')
  const [page, setPage]         = useState(0)
  const [loading, setLoading]   = useState(true)
  const PER_PAGE = 50

  const load = useCallback(async () => {
    setLoading(true)

    let q = supabase
      .from('wines_current_price')
      .select('id,name,producer,vintage,category,country,region,current_price_dkk,ws_price_eur,last_seen,volume_cl', { count: 'exact' })

    if (category) q = q.eq('category', category)

    if (query) {
      q = q.or(`name.ilike.%${query}%,producer.ilike.%${query}%`)
    }

    const [col, dir] = sort === 'price_desc'   ? ['current_price_dkk', false]
                     : sort === 'price_asc'    ? ['current_price_dkk', true]
                     : sort === 'name_asc'     ? ['name', true]
                     : sort === 'vintage_desc' ? ['vintage', false]
                     :                           ['current_price_dkk', false]

    q = q.order(col, { ascending: dir })
         .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)

    const { data, count } = await q
    setWines(data || [])
    setTotal(count || 0)
    setLoading(false)
  }, [query, category, sort, page])

  useEffect(() => { setPage(0) }, [query, category, sort])
  useEffect(() => { load() }, [load])

  return (
    <div className="container" style={{ paddingTop: '3rem', paddingBottom: '4rem' }}>

      {/* Header */}
      <div className="fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ color: 'var(--gold)', fontStyle: 'italic' }}>Vinkort</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.3rem' }}>{total.toLocaleString('da-DK')} vine</div>
      </div>

      {/* Filters */}
      <div className="fade-up-2" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <input
          className="search-input"
          placeholder="Søg på vin eller producent..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {CATEGORIES.map(c => (
            <button key={c} className={`btn ${category === c ? 'active' : ''}`}
              onClick={() => setCategory(c)}>
              {CAT_LABELS[c]}
            </button>
          ))}
        </div>

        <select className="filter-select" value={sort} onChange={e => setSort(e.target.value)} style={{ marginLeft: 'auto' }}>
          <option value="price_desc">Pris ↓</option>
          <option value="price_asc">Pris ↑</option>
          <option value="name_asc">Navn A–Z</option>
          <option value="vintage_desc">Årgang ↓</option>
        </select>
      </div>

      {/* Table */}
      <div className="card fade-up-3" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '2rem' }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 44, marginBottom: '0.5rem' }} />
            ))}
          </div>
        ) : (
          <table className="wine-table">
            <thead>
              <tr>
                <th>Vin</th>
                <th>Producent</th>
                <th>Årgang</th>
                <th>Region</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Pris</th>
                <th style={{ textAlign: 'right' }}>Wine-Searcher EU</th>
              </tr>
            </thead>
            <tbody>
              {wines.map(w => {
                const marketDkk = w.ws_price_eur ? Math.round(w.ws_price_eur * 7.46) : null
                const ratio     = marketDkk ? (w.current_price_dkk / marketDkk).toFixed(1) : null
                const volLabel  = w.volume_cl !== 75 ? ` ${w.volume_cl}cl` : ''

                return (
                  <tr key={w.id}>
                    <td>
                      <Link to={`/wines/${w.id}`} style={{ textDecoration: 'none' }}>
                        <div className="wine-name">{w.name}{volLabel}</div>
                      </Link>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{w.producer}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{w.vintage ?? 'NV'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {[w.region, w.country].filter(Boolean).join(', ')}
                    </td>
                    <td>
                      {w.category && (
                        <span className={`badge ${CAT_BADGE[w.category] || 'badge-white'}`}>
                          {CAT_LABELS[w.category] || w.category}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--serif)', color: 'var(--gold)', fontSize: '1rem', whiteSpace: 'nowrap' }}>
                      {w.current_price_dkk?.toLocaleString('da-DK')} DKK
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {w.ws_price_eur ? (
                        <>
                          <div>€{w.ws_price_eur}</div>
                          <div style={{ color: ratio < 2 ? '#72c290' : ratio > 4 ? '#e88a75' : 'var(--text-muted)' }}>
                            {ratio}× marked
                          </div>
                        </>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > PER_PAGE && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Forrige</button>
          <span style={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0 1rem' }}>
            Side {page + 1} / {Math.ceil(total / PER_PAGE)}
          </span>
          <button className="btn" disabled={(page + 1) * PER_PAGE >= total} onClick={() => setPage(p => p + 1)}>Næste →</button>
        </div>
      )}
    </div>
  )
}

// PDF export utility — called from WineList toolbar
export function exportWinesToCSV(wines) {
  const headers = ['Årgang', 'Vin', 'Producent', 'Region', 'Land', 'Type', 'Pris DKK', 'Wine-Searcher EUR', 'Faktor']
  const rows = wines.map(w => [
    (w.vintage ?? 'NV'),
    w.name,
    w.producer,
    w.region || '',
    w.country || '',
    w.category || '',
    w.current_price_dkk || '',
    w.ws_price_eur || '',
    w.restaurant_market_ratio || '',
  ])
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: `syttende-vinkort-${new Date().toISOString().slice(0,10)}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}
