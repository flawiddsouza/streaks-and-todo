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
import Toasts from './components/Toasts'
import { attemptAutoSignIn } from './credential-management'

async function redirectIfAuthed() {
  try {
    const { data } = await authClient.getSession()
    if (data && typeof data === 'object' && 'user' in data) {
      return redirect('/')
    }
  } catch (_) {
    // swallow; show page to allow auth
  }

  try {
    const ok = await attemptAutoSignIn()
    if (ok) return redirect('/')
  } catch {}

  return null
}

async function requireAuth({ request }: { request: Request }) {
  try {
    const { data } = await authClient.getSession()
    if (data && typeof data === 'object' && 'user' in data) {
      return null
    }
  } catch (_) {
    // ignore and redirect to signin below
  }

  try {
    const ok = await attemptAutoSignIn()
    if (ok) return null
  } catch {}

  try {
    const url = new URL(request.url)
    const returnTo = url.pathname + url.search
    return redirect(`/signin?next=${encodeURIComponent(returnTo)}`)
  } catch (_) {
    return redirect('/signin')
  }
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
    HydrateFallback: () => null,
  },
  {
    path: '/signin',
    element: <SignIn />,
    loader: redirectIfAuthed,
    HydrateFallback: () => null,
  },
  {
    path: '/streaks',
    element: <StreakGroups />,
    loader: requireAuth,
    HydrateFallback: () => null,
  },
  {
    path: '/streaks/:groupId',
    element: <StreakGroup />,
    loader: requireAuth,
    HydrateFallback: () => null,
  },
  {
    path: '/todo',
    element: <TodoGroups />,
    loader: requireAuth,
    HydrateFallback: () => null,
  },
  {
    path: '/todo/:groupId',
    element: <TodoGroup />,
    loader: requireAuth,
    HydrateFallback: () => null,
  },
  {
    path: '*',
    element: <NotFound />,
  },
])

const container = document.querySelector('#root') as Element

createRoot(container).render(
  <>
    <RouterProvider router={router} />
    <Toasts />
  </>,
)
