import { Link } from 'react-router'

export default function Home() {
  return (
    <div className="page">
      <div>
        <Link to={`/streaks`}>Streak Groups</Link>
      </div>
      <div>
        <Link to={`/todo`}>Todo Groups</Link>
      </div>
    </div>
  )
}
