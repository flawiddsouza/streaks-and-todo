import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { authClient } from '../auth-client'

export default function SignIn() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await authClient.signIn.email(
        { email, password, callbackURL: '/' },
        {
          onError(ctx) {
            setError(ctx.error.message)
          },
        },
      )
      if (!error) {
        navigate('/')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-nav">
        <div className="nav-left">
          <Link to="/" className="back-link">
            ← Back to Home
          </Link>
        </div>
        <div className="nav-right"></div>
      </div>
      <div className="page-header">
        <h1 className="page-title">Sign In</h1>
      </div>
      <form onSubmit={onSubmit} className="form">
        <div className="form-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={loading}
            autoComplete="email"
          />
        </div>
        <div className="form-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
            minLength={8}
            autoComplete="current-password"
          />
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <div style={{ fontSize: '0.75rem' }}>
            Need an account? <Link to="/signup">Create one</Link>
          </div>
        </div>
      </form>
    </div>
  )
}
