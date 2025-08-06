import { Link } from 'react-router'

export default function Todo() {
  return (
    <div className="page">
      <nav className="page-nav">
        <div className="nav-left">
          <Link to="/" className="back-link">
            ← Back to Home
          </Link>
        </div>
        <div className="nav-right">
          {/* Future: Add todo-specific nav buttons here */}
        </div>
      </nav>

      <h1 className="page-title">Todo</h1>
    </div>
  )
}
