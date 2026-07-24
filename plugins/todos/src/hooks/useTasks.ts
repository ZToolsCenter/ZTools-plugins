import { useAppContext } from '../context/AppContext';
import { createTask, getTaskStatus } from '../utils/taskUtils';
import { Task } from '../types';

export function useTasks() {
  const { state, dispatch } = useAppContext();

  const addTask = (title: string, description?: string) => {
    const task = createTask(title, description);
    dispatch({ 
      type: 'ADD_TASK', 
      payload: { workspace: state.currentWorkspace, task } 
    });
  };

  const completeTask = (taskId: string) => {
    dispatch({ type: 'COMPLETE_TASK', payload: { taskId } });
  };

  const deleteTask = (taskId: string) => {
    dispatch({ type: 'DELETE_TASK', payload: { taskId } });
  };

  const updateTask = (taskId: string, updates: Partial<Task>) => {
    dispatch({ type: 'UPDATE_TASK', payload: { taskId, updates } });
  };

  const addDateToTask = (taskId: string, date: string) => {
    dispatch({ type: 'ADD_DATE_TO_TASK', payload: { taskId, date } });
  };

  const removeDateFromTask = (taskId: string, date: string) => {
    dispatch({ type: 'REMOVE_DATE_FROM_TASK', payload: { taskId, date } });
  };

  const getCurrentTasks = () => {
    return state.workspaces[state.currentWorkspace];
  };

  const getTaskStatusById = (taskId: string) => {
    const tasks = getCurrentTasks();
    const task = tasks.find(t => t.id === taskId);
    return task ? getTaskStatus(task) : null;
  };

  return {
    addTask,
    completeTask,
    deleteTask,
    updateTask,
    addDateToTask,
    removeDateFromTask,
    getCurrentTasks,
    getTaskStatusById
  };
}
