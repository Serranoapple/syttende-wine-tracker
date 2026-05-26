import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../supabase'

const CAT_LABELS = { white: 'Hvidvin', red: 'Rødvin', rose: 'Rosé', sparkling: 'Mousserende', dessert: 'Dessertvin', avec: 'Avec' }

function CustomTooltip({ active, payload, label }) {
  if (active && payload?.length) {
    return (
      <div style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 2,
        padding: '0.6rem 1rem',
        fontFamily: 'var(--sans)',
        fontSize: '0.8rem',
      }}>
        <div style={{ color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</div>
        <div style={{ color: 'var(--gold)', fontFamily: 'var(--serif)', fontSize: '1.1rem' }}>
          {payload[0].value.toLocaleString('da-DK')} DKK
        </div>
      </div>
    )
  }
  return null
}

export default function WineDetail() {
  const { id } = useParams()
  const [wine, setWine]       = useState(null)
  const [prices, setPrices]   = useState([])
  const [changes, setChanges] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [wineRes, priceRes, changeRes] = await Promise.all([
        supabase.from('wines_current_price').select('*').eq('id', id).single(),
        supabase.from('wine_prices').select('price_dkk,observed_at').eq('wine_id', id).order('observed_at', { ascending: true }),
        supabase.from('change_log').select('*').eq('wine_id', id).order('created_at', { ascending: false }).limit(20),
      ])
      setWine(wineRes.data)
      setPrices(priceRes.data || [])
      setChanges(changeRes.data || [])
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return (
    <div className="container" style={{ paddingTop: '3rem' }}>
      <div className="skeleton" style={{ height: 200, marginBottom: '1.5rem' }} />
      <div className="skeleton" style={{ height: 300 }} />
    </div>
  )

  if (!wine) return (
    <div className="container" style={{ paddingTop: '3rem' }}>
      <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Vin ikke fundet.</div>
      <Link to="/wines" style={{ marginTop: '1rem', display: 'block', fontSize: '0.8rem' }}>← Tilbage til vinkort</Link>
    </div>
  )

  const chartData = prices.map(p => ({
    date: new Date(p.observed_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }),
    price: p.price_dkk,
  }))

  const priceMin = prices.length ? Math.min(...prices.map(p => p.price_dkk)) : null
  const priceMax = prices.length ? Math.max(...prices.map(p => p.price_dkk)) : null
  const marketDkk = wine.ws_price_eur ? Math.round(wine.ws_price_eur * 7.46) : null

  const typeMap = {
    added:      { badge: 'badge-added',   icon: '+' },
    removed:    { badge: 'badge-removed', icon: '−' },
    price_up:   { badge: 'badge-up',      icon: '↑' },
    price_down: { badge: 'badge-down',    icon: '↓' },
  }

  return (
    <div className="container" style={{ paddingTop: '3rem', paddingBottom: '4rem' }}>

      {/* Breadcrumb */}
      <div className="fade-up" style={{ marginBottom: '1.5rem' }}>
        <Link to="/wines" style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          ← Vinkort
        </Link>
      </div>

      {/* Hero */}
      <div className="fade-up" style={{ marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            {wine.category && (
              <span className={`badge badge-white`} style={{ marginBottom: '0.75rem', display: 'inline-block' }}>
                {CAT_LABELS[wine.category] || wine.category}
              </span>
            )}
            <h1 style={{ fontStyle: 'italic', marginBottom: '0.4rem', color: 'var(--text)', lineHeight: 1.15 }}>
              {wine.vintage} {wine.name}
            </h1>
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              {wine.producer}
              {(wine.region || wine.country) && (
                <span style={{ marginLeft: '1rem' }}>
                  {[wine.region, wine.country].filter(Boolean).join(', ')}
                </span>
              )}
              {wine.volume_cl !== 75 && (
                <span style={{ marginLeft: '1rem' }}>{wine.volume_cl} cl</span>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: '2.2rem', color: 'var(--gold)', lineHeight: 1 }}>
              {wine.current_price_dkk?.toLocaleString('da-DK')} DKK
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              Aktuel restaurantpris
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem' }}>
        <div>
          {/* Price history chart */}
          <div className="card fade-up-2" style={{ marginBottom: '1.5rem' }}>
            <div className="section-rule"><span>Prishistorik</span></div>
            {chartData.length < 2 ? (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--serif)', padding: '1rem 0' }}>
                Endnu kun ét prispunkt — grafen opdateres løbende.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="rgba(201,169,110,0.08)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#8c8278', fontSize: 11, fontFamily: 'var(--sans)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#8c8278', fontSize: 11, fontFamily: 'var(--sans)' }} axisLine={false} tickLine={false} width={60} tickFormatter={v => `${v.toLocaleString('da-DK')}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="price" stroke="var(--gold)" strokeWidth={2} dot={{ fill: 'var(--gold)', r: 4, strokeWidth: 0 }} activeDot={{ r: 6, fill: 'var(--gold-light)' }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Change history */}
          <div className="card fade-up-3">
            <div className="section-rule"><span>Ændringshistorik</span></div>
            {changes.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Ingen ændringer registreret.</div>
            ) : (
              <table className="wine-table">
                <thead>
                  <tr>
                    <th>Dato</th>
                    <th>Ændring</th>
                    <th>Fra</th>
                    <th>Til</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map(c => {
                    const t = typeMap[c.change_type] || { badge: '', icon: '·' }
                    return (
                      <tr key={c.id}>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(c.created_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td><span className={`badge ${t.badge}`}>{t.icon} {c.change_type.replace('_', ' ')}</span></td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{c.old_value ? `${Number(c.old_value).toLocaleString('da-DK')} DKK` : '—'}</td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{c.new_value ? `${Number(c.new_value).toLocaleString('da-DK')} DKK` : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Price stats */}
          <div className="card fade-up-2">
            <div className="section-rule"><span>Prisnøgletal</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {[
                { label: 'Minimum', value: priceMin ? `${priceMin.toLocaleString('da-DK')} DKK` : '—' },
                { label: 'Maximum', value: priceMax ? `${priceMax.toLocaleString('da-DK')} DKK` : '—' },
                { label: 'Antal prispunkter', value: prices.length },
                { label: 'Første registreret', value: prices.length ? new Date(prices[0].observed_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{label}</div>
                  <div style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--text)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Wine-Searcher */}
          <div className="card fade-up-3">
            <div className="section-rule"><span>Wine-Searcher EU</span></div>
            {wine.ws_price_eur ? (
              <>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--gold)', marginBottom: '0.5rem' }}>
                  €{wine.ws_price_eur}
                  <span style={{ fontSize: '1rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                    (~{marketDkk?.toLocaleString('da-DK')} DKK)
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Laveste markedspris i EU
                </div>
                {marketDkk && wine.current_price_dkk && (
                  <div style={{
                    padding: '0.6rem 0.9rem',
                    background: 'rgba(201,169,110,0.07)',
                    border: '1px solid var(--border)',
                    borderRadius: 2,
                    fontSize: '0.82rem',
                    marginBottom: '0.75rem',
                  }}>
                    <span style={{ color: 'var(--text-muted)' }}>Restaurantpris vs marked: </span>
                    <span style={{ color: wine.current_price_dkk < marketDkk * 2 ? '#72c290' : '#e88a75', fontFamily: 'var(--serif)', fontSize: '1rem' }}>
                      {(wine.current_price_dkk / marketDkk).toFixed(1)}×
                    </span>
                  </div>
                )}
                {wine.ws_url && (
                  <a href={wine.ws_url} target="_blank" rel="noreferrer"
                    style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Se på Wine-Searcher →
                  </a>
                )}
                {wine.ws_checked_at && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Opdateret {new Date(wine.ws_checked_at).toLocaleDateString('da-DK')}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '0.9rem' }}>
                Wine-Searcher pris hentes ved næste scrape.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
