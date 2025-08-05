import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import NotFound from './components/NotFound'
import Group from './views/Group'
import Home from './views/Home'
import './index.css'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Home />,
  },
  {
    path: '/group/:groupId',
    element: <Group />,
  },
  {
    path: '*',
    element: <NotFound />,
  },
])

const container = document.querySelector('#root') as Element

createRoot(container).render(<RouterProvider router={router} />)
