import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider, redirect } from 'react-router'
import NotFound from './components/NotFound'
import Home from './views/Home'
import SignIn from './views/SignIn'
import SignUp from './views/SignUp'
import StreakGroup from './views/StreakGroup'
import StreakGroups from './views/StreakGroups'
import TodoGroup from './views/TodoGroup'
import TodoGroups from './views/TodoGroups'
import './index.css'
import { authClient } from './auth-client'

async function redirectIfAuthed() {
  try {
    const { data } = await authClient.getSession()
    if (data && typeof data === 'object' && 'user' in data) {
      return redirect('/')
    }
  } catch (_) {
    // swallow; show page to allow auth
  }
  return null
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Home />,
  },
  {
    path: '/signup',
    element: <SignUp />,
    loader: redirectIfAuthed,
  },
  {
    path: '/signin',
    element: <SignIn />,
    loader: redirectIfAuthed,
  },
  {
    path: '/streaks',
    element: <StreakGroups />,
  },
  {
    path: '/streaks/:groupId',
    element: <StreakGroup />,
  },
  {
    path: '/todo',
    element: <TodoGroups />,
  },
  {
    path: '/todo/:groupId',
    element: <TodoGroup />,
  },
  {
    path: '*',
    element: <NotFound />,
  },
])

const container = document.querySelector('#root') as Element

createRoot(container).render(<RouterProvider router={router} />)
