import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import NotFound from './components/NotFound'
import Home from './views/Home'
import StreakGroup from './views/StreakGroup'
import StreakGroups from './views/StreakGroups'
import TodoGroup from './views/TodoGroup'
import TodoGroups from './views/TodoGroups'
import './index.css'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Home />,
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
