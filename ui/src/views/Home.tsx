import { Link } from 'react-router'

export default function Home() {
  return (
    <div className="page">
      <div>
        <Link to={`/groups`}>Streak Groups</Link>
      </div>
      <div>
        <Link to={`/todo`}>Todo</Link>
      </div>
    </div>
  )
}
