import TodoApp from './components/TodoApp'
import { useThemeChange } from './hooks/useThemeChange'

export default function App() {
  useThemeChange();

  return <TodoApp />
}
