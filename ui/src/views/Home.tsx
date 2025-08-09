import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { authClient } from '../auth-client'

interface SessionData {
  user: { id: string; email: string; name: string }
}

function useAuthSession() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const { data, error } = await authClient.getSession()
      if (error?.message) setError(error.message)
      if (data && typeof data === 'object' && 'user' in data) {
        const d = data as { user: { id: string; email: string; name: string } }
        setSession({
          user: { id: d.user.id, email: d.user.email, name: d.user.name },
        })
      } else setSession(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { session, loading, error, reload: load }
}

function SessionBar({
  session,
  loading,
}: {
  session: SessionData | null
  loading: boolean
}) {
  if (loading) return <div>Loading session...</div>
  if (!session) {
    return (
      <div style={{ display: 'flex', gap: '1rem' }}>
        <Link to="/signin">Sign In</Link>
        <Link to="/signup">Sign Up</Link>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <span style={{ fontSize: '0.9rem' }}>
        Hi {session.user.name || session.user.email}
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() =>
          authClient.signOut({
            fetchOptions: { onSuccess: () => window.location.reload() },
          })
        }
      >
        Sign Out
      </button>
    </div>
  )
}

export default function Home() {
  // Single session fetch for page & session bar
  const { session, loading } = useAuthSession()
  return (
    <div className="page">
      <div className="page-nav">
        <div className="nav-left">
          <Link to="dummy" className="back-link">
            <span style={{ visibility: 'hidden' }}>Take Space</span>
          </Link>
        </div>
        <div className="nav-right">
          <SessionBar session={session} loading={loading} />
        </div>
      </div>
      {session && !loading && (
        <>
          <div style={{ marginTop: '0.5rem' }}>
            <Link to={`/streaks`}>Streak Groups</Link>
          </div>
          <div>
            <Link to={`/todo`}>Todo Groups</Link>
          </div>
        </>
      )}
    </div>
  )
}
