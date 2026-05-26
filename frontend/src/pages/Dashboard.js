import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'

// ─── Small helpers ────────────────────────────────────────────────────────────

function StatCard({ value, label, sub, color, delay = 0 }) {
  return (
    <div className={`card fade-up-${Math.min(delay + 1, 4)}`}
      style={{ textAlign: 'center', padding: '1.75rem 1.5rem' }}>
      <div className="stat-value" style={{ color: color || 'var(--gold)' }}>{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>{sub}</div>}
    </div>
  )
}

const TYPE = {
  added:      { badge: 'badge-added',   icon: '+' },
  removed:    { badge: 'badge-removed', icon: '−' },
  price_up:   { badge: 'badge-up',      icon: '↑' },
  price_down: { badge: 'badge-down',    icon: '↓' },
}

function ChangeRow({ change, showDate = true }) {
  const t = TYPE[change.change_type] || { badge: '', icon: '·' }
  const dateStr = new Date(change.created_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: showDate ? '64px 32px 1fr auto' : '32px 1fr auto',
      alignItems: 'center',
      gap: '0.75rem',
      padding: '0.75rem 0',
      borderBottom: '1px solid rgba(201,169,110,0.07)',
    }}>
      {showDate && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--sans)', whiteSpace: 'nowrap' }}>
          {dateStr}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span className={`badge ${t.badge}`} style={{ fontSize: '0.7rem', minWidth: 22, textAlign: 'center' }}>{t.icon}</span>
      </div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: '0.9rem', fontStyle: 'italic', lineHeight: 1.4 }}>
        {change.description}
      </div>
      {change.wine_id ? (
        <Link to={`/wines/${change.wine_id}`}
          style={{ fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          → Se vin
        </Link>
      ) : <span />}
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <div className="section-rule" style={{ marginBottom: '1rem' }}>
      <span>{title}</span>
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div style={{ padding: '1.25rem 0', color: 'var(--text-muted)', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '0.9rem' }}>
      {text}
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats]           = useState({})
  const [allChanges, setAllChanges] = useState([])
  const [newWines, setNewWines]     = useState([])
  const [priceUps, setPriceUps]     = useState([])
  const [priceDowns, setPriceDowns] = useState([])
  const [mostExp, setMostExp]       = useState([])
  const [bestDeals, setBestDeals]   = useState([])
  const [lastScrape, setLastScrape] = useState(null)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      const since7  = new Date(Date.now() - 7  * 86400000).toISOString()
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString()

      const [
        totalRes, new30Res, upWeekRes, downWeekRes,
        changesRes, newWinesRes, priceUpsRes, priceDownsRes,
        expRes, dealRes, scrapeRes,
      ] = await Promise.all([
        supabase.from('wines_current_price').select('id', { count: 'exact', head: true }),
        supabase.from('change_log').select('id', { count: 'exact', head: true }).eq('change_type', 'added').gte('created_at', since30),
        supabase.from('change_log').select('id', { count: 'exact', head: true }).eq('change_type', 'price_up').gte('created_at', since7),
        supabase.from('change_log').select('id', { count: 'exact', head: true }).eq('change_type', 'price_down').gte('created_at', since7),

        // All recent changes (mixed feed)
        supabase.from('recent_changes').select('*').order('created_at', { ascending: false }).limit(15),

        // New wines last 30 days
        supabase.from('recent_changes').select('*').eq('change_type', 'added').gte('created_at', since30).order('created_at', { ascending: false }).limit(8),

        // Price increases last 30 days
        supabase.from('recent_changes').select('*').eq('change_type', 'price_up').gte('created_at', since30).order('created_at', { ascending: false }).limit(8),

        // Price drops last 30 days
        supabase.from('recent_changes').select('*').eq('change_type', 'price_down').gte('created_at', since30).order('created_at', { ascending: false }).limit(8),

        // Most expensive
        supabase.from('wines_current_price').select('id,name,producer,vintage,current_price_dkk,category').order('current_price_dkk', { ascending: false }).limit(8),

        // Best deals (lowest restaurant/market ratio — i.e. closest to retail)
        supabase.from('wines_current_price').select('id,name,producer,vintage,current_price_dkk,ws_price_eur,restaurant_market_ratio').not('ws_price_eur', 'is', null).order('restaurant_market_ratio', { ascending: true }).limit(6),

        supabase.from('scrape_runs').select('finished_at,status,wines_total,wines_added,price_changes').eq('status', 'success').order('finished_at', { ascending: false }).limit(1),
      ])

      setStats({
        total:     totalRes.count,
        new30:     new30Res.count,
        priceUp:   upWeekRes.count,
        priceDown: downWeekRes.count,
      })
      setAllChanges(changesRes.data || [])
      setNewWines(newWinesRes.data || [])
      setPriceUps(priceUpsRes.data || [])
      setPriceDowns(priceDownsRes.data || [])
      setMostExp(expRes.data || [])
      setBestDeals(dealRes.data || [])
      if (scrapeRes.data?.length) setLastScrape(scrapeRes.data[0])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return (
    <div className="container" style={{ paddingTop: '3rem' }}>
      <div className="skeleton" style={{ height: 44, width: 280, marginBottom: '2.5rem' }} />
      <div className="grid-4" style={{ marginBottom: '2rem' }}>
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 110 }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div className="skeleton" style={{ height: 500 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="skeleton" style={{ height: 240 }} />
          <div className="skeleton" style={{ height: 240 }} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="container" style={{ paddingTop: '3rem', paddingBottom: '4rem' }}>

      {/* ── Page header ── */}
      <div className="fade-up" style={{ marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ color: 'var(--gold)', fontStyle: 'italic' }}>Vinkort Oversigt</h1>
          <div style={{ fontFamily: 'var(--sans)', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', letterSpacing: '0.06em' }}>
            Restaurant 17. · Sønderborg
          </div>
        </div>
        {lastScrape && (
          <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--sans)' }}>
            <div>Sidst tjekket {new Date(lastScrape.finished_at).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            <div style={{ marginTop: '0.2rem' }}>{lastScrape.wines_total} vine på kortet</div>
          </div>
        )}
      </div>

      {/* ── Stat row ── */}
      <div className="grid-4" style={{ marginBottom: '2.5rem' }}>
        <StatCard value={stats.total?.toLocaleString('da-DK')} label="Vine på kortet" delay={0} />
        <StatCard value={stats.new30}    label="Nye vine"         sub="Seneste 30 dage"  color="#72c290" delay={1} />
        <StatCard value={stats.priceUp}  label="Prisstigninger"   sub="Seneste 7 dage"   color="#e88a75" delay={2} />
        <StatCard value={stats.priceDown} label="Prisfald"        sub="Seneste 7 dage"   color="#75b8e8" delay={3} />
      </div>

      {/* ── Row 1: All changes + Most expensive ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '1.5rem', marginBottom: '1.5rem' }}>

        {/* All recent changes — the main feed */}
        <div className="card fade-up-2">
          <SectionHeader title="Seneste ændringer" />
          {allChanges.length === 0
            ? <EmptyState text="Ingen ændringer endnu — første scrape afventer." />
            : allChanges.map(c => <ChangeRow key={c.id} change={c} showDate />)
          }
          <div style={{ marginTop: '1rem', textAlign: 'right' }}>
            <Link to="/log" style={{ fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Fuld historik →
            </Link>
          </div>
        </div>

        {/* Most expensive */}
        <div className="card fade-up-3">
          <SectionHeader title="Dyreste vine" />
          <table className="wine-table">
            <tbody>
              {mostExp.map(w => (
                <tr key={w.id}>
                  <td style={{ paddingLeft: 0 }}>
                    <Link to={`/wines/${w.id}`} style={{ textDecoration: 'none' }}>
                      <div className="wine-name" style={{ fontSize: '0.88rem' }}>{w.vintage ?? 'NV'} {w.name}</div>
                      <div className="wine-producer">{w.producer}</div>
                    </Link>
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: 0, fontFamily: 'var(--serif)', color: 'var(--gold)', whiteSpace: 'nowrap', fontSize: '0.95rem' }}>
                    {w.current_price_dkk?.toLocaleString('da-DK')}
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>DKK</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: '1rem', textAlign: 'right' }}>
            <Link to="/wines?sort=price_desc" style={{ fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Se alle →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Row 2: New wines + Price movements ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>

        {/* New wines */}
        <div className="card fade-up-2">
          <SectionHeader title="Nye vine (seneste 30 dage)" />
          {newWines.length === 0
            ? <EmptyState text="Ingen nye vine registreret." />
            : newWines.map(c => <ChangeRow key={c.id} change={c} showDate />)
          }
          {newWines.length > 0 && (
            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
              <Link to="/log?type=added" style={{ fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Alle nye vine →
              </Link>
            </div>
          )}
        </div>

        {/* Price changes: up + down */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="card fade-up-3">
            <SectionHeader title="Prisstigninger" />
            {priceUps.length === 0
              ? <EmptyState text="Ingen prisstigninger de seneste 30 dage." />
              : priceUps.map(c => <ChangeRow key={c.id} change={c} showDate />)
            }
          </div>

          <div className="card fade-up-4">
            <SectionHeader title="Prisfald" />
            {priceDowns.length === 0
              ? <EmptyState text="Ingen prisfald de seneste 30 dage." />
              : priceDowns.map(c => <ChangeRow key={c.id} change={c} showDate />)
            }
          </div>
        </div>
      </div>

      {/* ── Row 3: Best deal vs Wine-Searcher ── */}
      <div className="card fade-up-2">
        <SectionHeader title="Best deal vs. Wine-Searcher EU" />
        {bestDeals.length === 0 ? (
          <EmptyState text="Wine-Searcher priser samles løbende ved næste scrape..." />
        ) : (
          <table className="wine-table">
            <thead>
              <tr>
                <th>Vin</th>
                <th>Producent</th>
                <th style={{ textAlign: 'right' }}>Restaurantpris</th>
                <th style={{ textAlign: 'right' }}>Markedspris EU</th>
                <th style={{ textAlign: 'right' }}>Forskel</th>
                <th style={{ textAlign: 'right' }}>Faktor</th>
              </tr>
            </thead>
            <tbody>
              {bestDeals.map(w => {
                const marketDkk = w.ws_price_eur ? Math.round(w.ws_price_eur * 7.46) : null
                const diff      = marketDkk ? w.current_price_dkk - marketDkk : null
                const ratio     = w.restaurant_market_ratio

                return (
                  <tr key={w.id}>
                    <td>
                      <Link to={`/wines/${w.id}`} style={{ textDecoration: 'none' }}>
                        <div className="wine-name" style={{ fontSize: '0.88rem' }}>{w.vintage ?? 'NV'} {w.name}</div>
                      </Link>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{w.producer}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--serif)', color: 'var(--gold)', fontSize: '0.95rem' }}>
                      {w.current_price_dkk?.toLocaleString('da-DK')} DKK
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {w.ws_price_eur ? <>€{w.ws_price_eur} <span style={{ fontSize: '0.7rem' }}>(~{marketDkk?.toLocaleString('da-DK')} DKK)</span></> : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: '0.82rem',
                      color: diff !== null ? (diff < 0 ? '#72c290' : '#e88a75') : 'var(--text-muted)' }}>
                      {diff !== null ? `${diff > 0 ? '+' : ''}${diff.toLocaleString('da-DK')} DKK` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--serif)', fontSize: '1rem',
                      color: ratio < 2 ? '#72c290' : ratio < 3.5 ? 'var(--gold)' : '#e88a75' }}>
                      {ratio ? `${ratio}×` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )
}
