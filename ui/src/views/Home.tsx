import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { authClient } from '../auth-client'
import NotificationSettingsModal from '../components/shared/NotificationSettingsModal'

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
  const [showNotificationsModal, setShowNotificationsModal] = useState(false)
  return (
    <div className="page">
      <div className="page-nav">
        <div className="nav-left">
          <Link to="dummy" className="back-link">
            <span style={{ visibility: 'hidden' }}>Take Space</span>
          </Link>
        </div>
        <div
          className="nav-right"
          style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
        >
          {session && !loading && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowNotificationsModal(true)}
            >
              Notification Settings
            </button>
          )}
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

      {!session && !loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '2rem',
            maxWidth: '600px',
            margin: '0 auto',
          }}
        >
          <h1 style={{ marginBottom: '1rem', color: '#333' }}>
            Welcome to Streaks & Todo
          </h1>
          <p
            style={{
              fontSize: '1.1rem',
              lineHeight: '1.6',
              marginBottom: '1.5rem',
              color: '#666',
            }}
          >
            Track your daily habits and manage your tasks effectively. Build
            consistent streaks and stay organized with our simple, powerful
            productivity tools.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1.5rem',
              marginBottom: '2rem',
            }}
          >
            <div
              style={{
                padding: '1.5rem',
                border: '1px solid #ddd',
                borderRadius: '8px',
                backgroundColor: '#f9f9f9',
              }}
            >
              <h3 style={{ marginBottom: '0.5rem', color: '#333' }}>
                📈 Streak Tracking
              </h3>
              <p style={{ color: '#666', fontSize: '0.9rem' }}>
                Build and maintain daily habits. Track your progress and
                celebrate your longest streaks.
              </p>
            </div>

            <div
              style={{
                padding: '1.5rem',
                border: '1px solid #ddd',
                borderRadius: '8px',
                backgroundColor: '#f9f9f9',
              }}
            >
              <h3 style={{ marginBottom: '0.5rem', color: '#333' }}>
                ✅ Task Management
              </h3>
              <p style={{ color: '#666', fontSize: '0.9rem' }}>
                Organize your todos in groups. Pin important tasks and stay on
                top of your daily responsibilities.
              </p>
            </div>
          </div>

          <div
            style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}
          >
            <Link
              to="/signup"
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#007bff',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '5px',
                fontWeight: 'bold',
              }}
            >
              Get Started
            </Link>
            <Link
              to="/signin"
              style={{
                padding: '0.75rem 1.5rem',
                border: '1px solid #007bff',
                color: '#007bff',
                textDecoration: 'none',
                borderRadius: '5px',
              }}
            >
              Sign In
            </Link>
          </div>
        </div>
      )}

      <NotificationSettingsModal
        isOpen={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
      />
    </div>
  )
}
