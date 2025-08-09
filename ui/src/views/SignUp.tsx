import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { authClient } from '../auth-client'

export default function SignUp() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await authClient.signUp.email(
        { email, password, name, callbackURL: '/' },
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
      setError(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Create Account</h1>
      </div>
      <form onSubmit={onSubmit} className="form">
        <div className="form-field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            disabled={loading}
            autoComplete="name"
          />
        </div>
        <div className="form-field">
          <label htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
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
          <label htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            className="input"
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? 'Creating...' : 'Sign Up'}
          </button>
          <div style={{ fontSize: '0.75rem' }}>
            Already have an account? <Link to="/signin">Sign In</Link>
          </div>
        </div>
      </form>
    </div>
  )
}
