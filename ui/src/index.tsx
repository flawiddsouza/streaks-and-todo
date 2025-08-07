import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import NotFound from './components/NotFound'
import Group from './views/Group'
import Home from './views/Home'
import StreakGroups from './views/StreakGroups'
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
    element: <Group />,
  },
  {
    path: '/todo',
    element: <TodoGroups />,
  },
  {
    path: '/todo/:groupId',
    element: <TodoGroups />, // TODO: Create a TodoGroup component similar to Group
  },
  {
    path: '*',
    element: <NotFound />,
  },
])

const container = document.querySelector('#root') as Element

createRoot(container).render(<RouterProvider router={router} />)
