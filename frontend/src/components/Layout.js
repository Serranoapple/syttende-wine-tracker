import React from 'react'
import { Outlet, NavLink } from 'react-router-dom'

const NAV = [
  { to: '/',          label: 'Dashboard',  icon: '◈' },
  { to: '/wines',     label: 'Vinkort',    icon: '◇' },
  { to: '/log',       label: 'Historik',   icon: '◎' },
  { to: '/watchlist', label: 'Watchlist',  icon: '◉' },
  { to: '/insights',  label: 'AI Analyse', icon: '✦' },
]

export default function Layout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0, left: 0,
        height: '100vh',
        zIndex: 100,
      }}>
        {/* Logo */}
        <div style={{ padding: '2rem 1.5rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', color: 'var(--gold)', letterSpacing: '0.04em', fontStyle: 'italic' }}>
            Syttende
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: '0.58rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            Wine Tracker
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '1.5rem 0', flex: 1 }}>
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.65rem 1.5rem',
                fontFamily: 'var(--sans)',
                fontSize: '0.78rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: isActive ? 'var(--gold)' : 'var(--text-muted)',
                background: isActive ? 'rgba(201,169,110,0.08)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--gold)' : '2px solid transparent',
                textDecoration: 'none',
                transition: 'all .15s',
              })}
            >
              <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid var(--border)' }}>
          <a
            href="https://www.syttende.dk/vinen"
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block',
              fontFamily: 'var(--sans)',
              fontSize: '0.62rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >
            → Restaurant 17.
          </a>
        </div>
      </aside>

      {/* Content */}
      <main style={{ marginLeft: 220, flex: 1, minHeight: '100vh', background: 'var(--ink)' }}>
        <Outlet />
      </main>
    </div>
  )
}
