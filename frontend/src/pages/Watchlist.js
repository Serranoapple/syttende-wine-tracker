import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'

/**
 * Watchlist — persisted in browser localStorage.
 * User can add wines by searching and get a custom view of "their" wines
 * with current prices, Wine-Searcher comparison and change history.
 */

const LS_KEY = 'syttende_watchlist_v1'

function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') }
  catch { return [] }
}
function saveWatchlist(ids) {
  localStorage.setItem(LS_KEY, JSON.stringify(ids))
}

export default function Watchlist() {
  const [watchIds, setWatchIds]   = useState(loadWatchlist)
  const [wines, setWines]         = useState([])
  const [searchQ, setSearchQ]     = useState('')
  const [searchRes, setSearchRes] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [loading, setLoading]     = useState(false)

  // Load watched wines
  useEffect(() => {
    if (watchIds.length === 0) { setWines([]); return }
    setLoading(true)
    supabase
      .from('wines_current_price')
      .select('id,name,producer,vintage,current_price_dkk,ws_price_eur,restaurant_market_ratio,category,country,last_seen')
      .in('id', watchIds)
      .then(({ data }) => { setWines(data || []); setLoading(false) })
  }, [watchIds])

  // Search
  useEffect(() => {
    if (!searchQ.trim()) { setSearchRes([]); return }
    setSearchLoading(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('wines_current_price')
        .select('id,name,producer,vintage,current_price_dkk,category')
        .or(`name.ilike.%${searchQ}%,producer.ilike.%${searchQ}%`)
        .order('current_price_dkk', { ascending: false })
        .limit(8)
      setSearchRes(data || [])
      setSearchLoading(false)
    }, 350)
    return () => clearTimeout(t)
  }, [searchQ])

  function addWine(id) {
    if (watchIds.includes(id)) return
    const next = [...watchIds, id]
    setWatchIds(next)
    saveWatchlist(next)
    setSearchQ('')
    setSearchRes([])
  }

  function removeWine(id) {
    const next = watchIds.filter(w => w !== id)
    setWatchIds(next)
    saveWatchlist(next)
  }

  const CAT_BADGE = { white: 'badge-white', red: 'badge-red', rose: 'badge-rose', sparkling: 'badge-sparkling', dessert: 'badge-dessert' }
  const CAT_LABEL = { white: 'Hvid', red: 'Rød', rose: 'Rosé', sparkling: 'Bobler', dessert: 'Dessert' }

  return (
    <div className="container" style={{ paddingTop: '3rem', paddingBottom: '4rem' }}>
      <div className="fade-up" style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ color: 'var(--gold)', fontStyle: 'italic' }}>Watchlist</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.3rem', fontFamily: 'var(--sans)' }}>
          Overvåg specifikke vine — se prishistorik og ændringer
        </div>
      </div>

      {/* Search to add */}
      <div className="card fade-up-2" style={{ marginBottom: '1.5rem' }}>
        <div className="section-rule" style={{ marginBottom: '1rem' }}><span>Tilføj vin til watchlist</span></div>
        <div style={{ position: 'relative' }}>
          <input
            className="search-input"
            style={{ maxWidth: '100%' }}
            placeholder="Søg på vin, producent..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
          {(searchRes.length > 0 || searchLoading) && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              zIndex: 50,
              maxHeight: 260,
              overflowY: 'auto',
            }}>
              {searchLoading ? (
                <div style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Søger...</div>
              ) : searchRes.map(w => (
                <div key={w.id}
                  onClick={() => addWine(w.id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.65rem 1rem',
                    cursor: 'pointer',
                    borderBottom: '1px solid rgba(201,169,110,0.07)',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,169,110,0.06)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '0.9rem', fontStyle: 'italic' }}>
                      {w.vintage} {w.name}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{w.producer}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontFamily: 'var(--serif)', color: 'var(--gold)', fontSize: '0.9rem' }}>
                      {w.current_price_dkk?.toLocaleString('da-DK')} DKK
                    </span>
                    {watchIds.includes(w.id)
                      ? <span style={{ fontSize: '0.65rem', color: '#72c290' }}>✓ Tilføjet</span>
                      : <span className="btn" style={{ padding: '0.2em 0.6em', fontSize: '0.65rem' }}>+ Tilføj</span>
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Watchlist */}
      {loading ? (
        <div className="card">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 68, marginBottom: '0.5rem' }} />)}
        </div>
      ) : watchIds.length === 0 ? (
        <div className="card fade-up-3" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: '1.15rem', fontStyle: 'italic', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Din watchlist er tom
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Søg på en vin ovenfor for at tilføje den.
          </div>
        </div>
      ) : (
        <div className="card fade-up-3" style={{ padding: 0 }}>
          <table className="wine-table">
            <thead>
              <tr>
                <th>Vin</th>
                <th>Producent</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Restaurantpris</th>
                <th style={{ textAlign: 'right' }}>Wine-Searcher EU</th>
                <th style={{ textAlign: 'right' }}>Faktor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {wines.map(w => {
                const marketDkk = w.ws_price_eur ? Math.round(w.ws_price_eur * 7.46) : null
                const ratio     = w.restaurant_market_ratio
                return (
                  <tr key={w.id}>
                    <td>
                      <Link to={`/wines/${w.id}`} style={{ textDecoration: 'none' }}>
                        <div className="wine-name" style={{ fontSize: '0.9rem' }}>{w.vintage} {w.name}</div>
                      </Link>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{w.producer}</td>
                    <td>
                      {w.category && <span className={`badge ${CAT_BADGE[w.category] || 'badge-white'}`}>{CAT_LABEL[w.category] || w.category}</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--serif)', color: 'var(--gold)', fontSize: '0.95rem' }}>
                      {w.current_price_dkk?.toLocaleString('da-DK')} DKK
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {w.ws_price_eur ? `€${w.ws_price_eur} (~${marketDkk?.toLocaleString('da-DK')} DKK)` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--serif)', fontSize: '1rem',
                      color: ratio ? (ratio < 2 ? '#72c290' : ratio < 3.5 ? 'var(--gold)' : '#e88a75') : 'var(--text-muted)' }}>
                      {ratio ? `${ratio}×` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button onClick={() => removeWine(w.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', padding: '0 0.3rem', transition: 'color .15s' }}
                        onMouseEnter={e => e.target.style.color = '#e88a75'}
                        onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
                        title="Fjern fra watchlist">
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {watchIds.length > 0 && (
        <div style={{ marginTop: '1rem', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--sans)' }}>
          {watchIds.length} vine · Gemmes lokalt i browseren
        </div>
      )}
    </div>
  )
}
