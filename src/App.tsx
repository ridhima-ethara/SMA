import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AppShell } from './components/layout'
import { useStore } from './store'
import { AgentActivity } from './pages/AgentActivity'
import { AgentStudio } from './pages/AgentStudio'
import { CalendarPage } from './pages/CalendarPage'
import { ContentIntelligence } from './pages/ContentIntelligence'
import { Dashboard } from './pages/Dashboard'
import { KnowledgeBase } from './pages/KnowledgeBase'
import { KnowledgeDrawer } from './pages/KnowledgeDrawer'
import { LeadershipReview } from './pages/LeadershipReview'
import { LoginPage } from './pages/LoginPage'
import { PipelineTheater } from './pages/PipelineTheater'
import { PublishedPosts } from './pages/PublishedPosts'
import { ReviewPanel } from './pages/ReviewPanel'
import { RunConsole } from './pages/RunConsole'
import { SettingsPage } from './pages/SettingsPage'
import { WelcomeFlow } from './pages/WelcomeFlow'

export default function App() {
  const { user, page, theme, introOpen, theaterOpen, reviewIdeaId, connectToRuntime } = useStore(useShallow((s) => ({ user: s.user, page: s.page, theme: s.theme, introOpen: s.introOpen, theaterOpen: s.theaterOpen, reviewIdeaId: s.reviewIdeaId, connectToRuntime: s.connectToRuntime })))
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const st = useStore.getState()
    const th = q.get('theme'); if (th === 'light' || th === 'dark') st.setTheme(th)
    const as = q.get('as'); if (as === 'marketing' || as === 'leadership') { st.login(as); if (q.get('intro') === '0') st.closeIntro() }
    const pg = q.get('page'); if (pg) st.setPage(pg as Parameters<typeof st.setPage>[0])
    if (q.get('kb') === '1') st.openKnowledge()
    const rv = q.get('review')
    const openReview = () => { if (!rv) return; const cur = useStore.getState(); const first = cur.ideas.find((i) => (rv === 'first' ? i.status !== 'published' && i.status !== 'rejected' && i.calendarSlot === 'primary' : i.id === rv)); if (first) cur.openReview(first.id) }
    void connectToRuntime().then(() => { openReview(); if (q.get('theater') === '1') useStore.getState().openTheater() })
  }, [connectToRuntime])
  if (!user) return <LoginPage />
  const body = (() => {
    switch (page) {
      case 'dashboard': return <Dashboard />
      case 'calendar': return <CalendarPage />
      case 'published': return <PublishedPosts />
      case 'activity': return <AgentActivity />
      case 'intelligence': return <ContentIntelligence />
      case 'studio': return <AgentStudio />
      case 'console': return <RunConsole />
      case 'settings': return <SettingsPage />
      case 'leadership': return <LeadershipReview />
      case 'knowledge': return <KnowledgeBase />
      default: return <Dashboard />
    }
  })()
  return (
    <>
      <AppShell><div key={page} className="anim-fade-in">{body}</div></AppShell>
      <KnowledgeDrawer />
      {reviewIdeaId && <ReviewPanel />}
      {theaterOpen && <PipelineTheater />}
      {introOpen && <WelcomeFlow />}
    </>
  )
}
