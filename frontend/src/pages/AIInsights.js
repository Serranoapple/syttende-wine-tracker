import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabase'

/**
 * AI Insights page — uses the Anthropic API to analyse the wine list.
 * Requires REACT_APP_ANTHROPIC_API_KEY set in environment.
 * Three analyses:
 *   1. "Mest interessante nye vine"
 *   2. "Undervurderede flasker" (low market ratio)
 *   3. Free-form wine advisor chat
 */

const MODEL = 'claude-sonnet-4-20250514'

async function callClaude(systemPrompt, userPrompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })
  const data = await resp.json()
  return data.content?.find(b => b.type === 'text')?.text || ''
}

function InsightBlock({ title, emoji, content, loading, error }) {
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="section-rule" style={{ marginBottom: '1rem' }}>
        <span>{emoji} {title}</span>
      </div>
      {loading ? (
        <div>
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 16, width: `${70 + i * 8}%`, marginBottom: '0.5rem' }} />
          ))}
        </div>
      ) : error ? (
        <div style={{ color: '#e88a75', fontSize: '0.85rem', fontFamily: 'var(--sans)' }}>
          {error}
        </div>
      ) : (
        <div style={{
          fontFamily: 'var(--serif)',
          fontSize: '0.95rem',
          lineHeight: 1.8,
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
        }}>
          {content}
        </div>
      )}
    </div>
  )
}

export default function AIInsights() {
  const [newWinesAnalysis, setNewWinesAnalysis]   = useState('')
  const [undervaluedAnalysis, setUndervaluedAnalysis] = useState('')
  const [loadingNew, setLoadingNew]               = useState(false)
  const [loadingUnder, setLoadingUnder]           = useState(false)
  const [errorNew, setErrorNew]                   = useState('')
  const [errorUnder, setErrorUnder]               = useState('')

  // Chat
  const [chatHistory, setChatHistory] = useState([])
  const [chatInput, setChatInput]     = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Wine context for AI
  const [wineContext, setWineContext] = useState('')

  useEffect(() => {
    async function loadContext() {
      // Load a sample of wines for AI context
      const [newRes, underRes] = await Promise.all([
        supabase.from('recent_changes').select('description,wine_name,producer,vintage,category').eq('change_type', 'added').order('created_at', { ascending: false }).limit(20),
        supabase.from('wines_current_price').select('name,producer,vintage,current_price_dkk,ws_price_eur,restaurant_market_ratio,category,country').not('ws_price_eur', 'is', null).order('restaurant_market_ratio', { ascending: true }).limit(20),
      ])
      const ctx = JSON.stringify({
        recentlyAdded: newRes.data || [],
        bestMarketValue: underRes.data || [],
      }, null, 2)
      setWineContext(ctx)
    }
    loadContext()
  }, [])

  async function analyseNewWines() {
    if (!wineContext) return
    setLoadingNew(true)
    setErrorNew('')
    try {
      const result = await callClaude(
        `Du er en erfaren sommelier og vinekspert med dyb viden om fine vine fra hele verden. 
Du analyserer vinkort fra Restaurant 17. i Sønderborg, Danmark. 
Skriv på dansk. Vær præcis, indsigtsfuld og entusiastisk. Undgå generiske sætninger.`,
        `Her er de seneste vine tilføjet til vinkortet på Restaurant 17.:

${wineContext}

Skriv en analyse på max 300 ord af de mest interessante nye tilføjelser.
Fremhæv specifikke vine der er bemærkelsesværdige pga. producent, region, årgange eller sjældenhed.
Brug vine-fagsprog men hold det forståeligt. Strukturer med korte afsnit.`
      )
      setNewWinesAnalysis(result)
    } catch (e) {
      setErrorNew('Kunne ikke hente analyse. Tjek at REACT_APP_ANTHROPIC_API_KEY er sat.')
    }
    setLoadingNew(false)
  }

  async function analyseUndervalued() {
    if (!wineContext) return
    setLoadingUnder(true)
    setErrorUnder('')
    try {
      const result = await callClaude(
        `Du er en erfaren sommelier og vinekspert med dyb viden om fine vine fra hele verden.
Du analyserer vinkort fra Restaurant 17. i Sønderborg, Danmark.
Skriv på dansk. Vær præcis og analytisk.`,
        `Her er vine fra Restaurant 17. med de laveste prissætninger i forhold til markedsprisen (Wine-Searcher EU):

${wineContext}

Identificer de mest interessante "undervurderede" flasker — vine hvor restauranten prissætter 
relativt tæt på markedsprisen, hvilket giver god value for money for gæsten.
Skriv max 250 ord. Nævn specifikke vine og forklar hvorfor de er bemærkelsesværdige value-picks.`
      )
      setUndervaluedAnalysis(result)
    } catch (e) {
      setErrorUnder('Kunne ikke hente analyse. Tjek at REACT_APP_ANTHROPIC_API_KEY er sat.')
    }
    setLoadingUnder(false)
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return
    const userMsg = chatInput.trim()
    setChatInput('')
    const newHistory = [...chatHistory, { role: 'user', content: userMsg }]
    setChatHistory(newHistory)
    setChatLoading(true)

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1000,
          system: `Du er en personlig vinguide og sommelier for Restaurant 17. i Sønderborg.
Du har adgang til vinkortet og kan rådgive om specifikke vine, årgange og producers.
Svar altid på dansk. Vær konkret og hjælpsom. Her er vindata:

${wineContext}`,
          messages: newHistory,
        }),
      })
      const data = await resp.json()
      const assistantMsg = data.content?.find(b => b.type === 'text')?.text || 'Ingen svar.'
      setChatHistory([...newHistory, { role: 'assistant', content: assistantMsg }])
    } catch {
      setChatHistory([...newHistory, { role: 'assistant', content: 'Fejl — tjek API-nøgle.' }])
    }
    setChatLoading(false)
  }

  return (
    <div className="container" style={{ paddingTop: '3rem', paddingBottom: '4rem' }}>
      <div className="fade-up" style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ color: 'var(--gold)', fontStyle: 'italic' }}>AI Vinanalyse</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.3rem', fontFamily: 'var(--sans)' }}>
          Intelligente indsigter om vinkortet · Kræver API-nøgle
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem', alignItems: 'start' }}>
        <div>
          {/* Most interesting new wines */}
          <div className="card fade-up-2" style={{ marginBottom: '1.5rem' }}>
            <div className="section-rule" style={{ marginBottom: '1rem' }}><span>✦ Mest interessante nye vine</span></div>
            {newWinesAnalysis ? (
              <div style={{ fontFamily: 'var(--serif)', fontSize: '0.95rem', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                {newWinesAnalysis}
              </div>
            ) : loadingNew ? (
              <div>{[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 16, width: `${60 + i * 7}%`, marginBottom: '0.5rem' }} />)}</div>
            ) : (
              <div>
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Analyser de seneste tilføjelser til vinkortet og find de mest interessante vine.
                </div>
                <button className="btn active" onClick={analyseNewWines}>Generer analyse</button>
              </div>
            )}
            {errorNew && <div style={{ color: '#e88a75', fontSize: '0.8rem', marginTop: '0.5rem' }}>{errorNew}</div>}
          </div>

          {/* Undervalued bottles */}
          <div className="card fade-up-3" style={{ marginBottom: '1.5rem' }}>
            <div className="section-rule" style={{ marginBottom: '1rem' }}><span>◈ Undervurderede flasker</span></div>
            {undervaluedAnalysis ? (
              <div style={{ fontFamily: 'var(--serif)', fontSize: '0.95rem', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                {undervaluedAnalysis}
              </div>
            ) : loadingUnder ? (
              <div>{[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 16, width: `${65 + i * 5}%`, marginBottom: '0.5rem' }} />)}</div>
            ) : (
              <div>
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Find vine med bedst value for money — prisen tæt på markedsprisen.
                </div>
                <button className="btn active" onClick={analyseUndervalued}>Find undervurderede vine</button>
              </div>
            )}
            {errorUnder && <div style={{ color: '#e88a75', fontSize: '0.8rem', marginTop: '0.5rem' }}>{errorUnder}</div>}
          </div>
        </div>

        {/* Chat sidebar */}
        <div className="card fade-up-2" style={{ position: 'sticky', top: '2rem' }}>
          <div className="section-rule" style={{ marginBottom: '1rem' }}><span>◉ Vinsommelier chat</span></div>
          <div style={{
            minHeight: 320,
            maxHeight: 440,
            overflowY: 'auto',
            marginBottom: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}>
            {chatHistory.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '0.875rem', padding: '0.5rem 0' }}>
                Spørg om vine på kortet — anbefalinger, årgange, producenter, value for money...
              </div>
            ) : (
              chatHistory.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  background: m.role === 'user' ? 'rgba(201,169,110,0.12)' : 'var(--surface-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  padding: '0.6rem 0.9rem',
                  fontSize: '0.85rem',
                  fontFamily: m.role === 'assistant' ? 'var(--serif)' : 'var(--sans)',
                  fontStyle: m.role === 'assistant' ? 'italic' : 'normal',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}>
                  {m.content}
                </div>
              ))
            )}
            {chatLoading && <div className="skeleton" style={{ height: 40, width: '80%' }} />}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              className="search-input"
              style={{ flex: 1, maxWidth: 'none' }}
              placeholder="Stil et spørgsmål..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
            />
            <button className="btn active" onClick={sendChat} disabled={chatLoading} style={{ whiteSpace: 'nowrap' }}>
              Send
            </button>
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>
            Kræver <code style={{ background: 'var(--surface-3)', padding: '0.1em 0.3em', borderRadius: 2 }}>REACT_APP_ANTHROPIC_API_KEY</code>
          </div>
        </div>
      </div>
    </div>
  )
}
