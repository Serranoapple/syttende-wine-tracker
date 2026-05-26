import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import WineList from './pages/WineList'
import WineDetail from './pages/WineDetail'
import ChangeLog from './pages/ChangeLog'
import AIInsights from './pages/AIInsights'
import Watchlist from './pages/Watchlist'
import './styles/global.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="wines" element={<WineList />} />
          <Route path="wines/:id" element={<WineDetail />} />
          <Route path="log" element={<ChangeLog />} />
          <Route path="insights" element={<AIInsights />} />
          <Route path="watchlist" element={<Watchlist />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
