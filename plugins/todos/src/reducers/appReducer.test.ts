import { AppState, Task, Workspace } from '../types';
import { appReducer, initialState } from './appReducer';

const createTask = (id: string, title: string, workspace: Workspace = 'work'): Task => ({
  id,
  title,
  priority: 'medium',
  dates: [],
  status: 'todo',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01'
});

const createInitialState = (overrides: Partial<AppState> = {}): AppState => ({
  ...initialState,
  ...overrides
});

describe('appReducer', () => {
  describe('ADD_TASK', () => {
    it('should add task to the beginning of specified workspace', () => {
      const existingTask = createTask('1', 'Existing Task');
      const state = createInitialState({
        workspaces: { work: [existingTask], life: [], study: [] }
      });
      
      const newTask = createTask('2', 'New Task');
      const result = appReducer(state, {
        type: 'ADD_TASK',
        payload: { workspace: 'work', task: newTask }
      });
      
      expect(result.workspaces.work).toHaveLength(2);
      expect(result.workspaces.work[0].id).toBe('2');
      expect(result.workspaces.work[1].id).toBe('1');
    });
    
    it('should not affect other workspaces', () => {
      const lifeTask = createTask('1', 'Life Task', 'life');
      const state = createInitialState({
        workspaces: { work: [], life: [lifeTask], study: [] }
      });
      
      const newTask = createTask('2', 'Work Task');
      const result = appReducer(state, {
        type: 'ADD_TASK',
        payload: { workspace: 'work', task: newTask }
      });
      
      expect(result.workspaces.life).toHaveLength(1);
      expect(result.workspaces.life[0].id).toBe('1');
    });
  });
  
  describe('UPDATE_TASK', () => {
    it('should update task properties', () => {
      const task = createTask('1', 'Original Title');
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] }
      });
      
      const result = appReducer(state, {
        type: 'UPDATE_TASK',
        payload: { taskId: '1', updates: { title: 'Updated Title' } }
      });
      
      expect(result.workspaces.work[0].title).toBe('Updated Title');
    });
    
    it('should update task in any workspace', () => {
      const task = createTask('1', 'Task in Life', 'life');
      const state = createInitialState({
        workspaces: { work: [], life: [task], study: [] }
      });
      
      const result = appReducer(state, {
        type: 'UPDATE_TASK',
        payload: { taskId: '1', updates: { priority: 'high' } }
      });
      
      expect(result.workspaces.life[0].priority).toBe('high');
    });
    
    it('should not affect other tasks', () => {
      const task1 = createTask('1', 'Task 1');
      const task2 = createTask('2', 'Task 2');
      const state = createInitialState({
        workspaces: { work: [task1, task2], life: [], study: [] }
      });
      
      const result = appReducer(state, {
        type: 'UPDATE_TASK',
        payload: { taskId: '1', updates: { title: 'Updated Task 1' } }
      });
      
      expect(result.workspaces.work[1].title).toBe('Task 2');
    });
  });
  
  describe('DELETE_TASK', () => {
    it('should remove task from all workspaces', () => {
      const task = createTask('1', 'Task to Delete');
      const state = createInitialState({
        workspaces: { work: [task], life: [task], study: [task] }
      });
      
      const result = appReducer(state, {
        type: 'DELETE_TASK',
        payload: { taskId: '1' }
      });
      
      expect(result.workspaces.work).toHaveLength(0);
      expect(result.workspaces.life).toHaveLength(0);
      expect(result.workspaces.study).toHaveLength(0);
    });
    
    it('should only remove the specified task', () => {
      const task1 = createTask('1', 'Task 1');
      const task2 = createTask('2', 'Task 2');
      const state = createInitialState({
        workspaces: { work: [task1, task2], life: [], study: [] }
      });
      
      const result = appReducer(state, {
        type: 'DELETE_TASK',
        payload: { taskId: '1' }
      });
      
      expect(result.workspaces.work).toHaveLength(1);
      expect(result.workspaces.work[0].id).toBe('2');
    });
    
    it('should clear selectedTaskId if deleted task was selected', () => {
      const state = createInitialState({ selectedTaskId: '1' });
      
      const result = appReducer(state, {
        type: 'DELETE_TASK',
        payload: { taskId: '1' }
      });
      
      expect(result.selectedTaskId).toBeNull();
    });
    
    it('should not affect selectedTaskId if different task deleted', () => {
      const state = createInitialState({ selectedTaskId: '1' });
      
      const result = appReducer(state, {
        type: 'DELETE_TASK',
        payload: { taskId: '2' }
      });
      
      expect(result.selectedTaskId).toBe('1');
    });
  });
  
  describe('COMPLETE_TASK', () => {
    it('should mark task as done', () => {
      const task = createTask('1', 'Task to Complete');
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] }
      });
      
      const result = appReducer(state, {
        type: 'COMPLETE_TASK',
        payload: { taskId: '1' }
      });
      
      expect(result.workspaces.work[0].status).toBe('done');
    });
    
    it('should complete task in any workspace', () => {
      const task = createTask('1', 'Task in Study', 'study');
      const state = createInitialState({
        workspaces: { work: [], life: [], study: [task] }
      });
      
      const result = appReducer(state, {
        type: 'COMPLETE_TASK',
        payload: { taskId: '1' }
      });
      
      expect(result.workspaces.study[0].status).toBe('done');
    });
  });
  
  describe('ADD_DATE_TO_TASK', () => {
    it('should add date to task', () => {
      const task = createTask('1', 'Task');
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] }
      });
      
      const result = appReducer(state, {
        type: 'ADD_DATE_TO_TASK',
        payload: { taskId: '1', date: '2024-01-15' }
      });
      
      expect(result.workspaces.work[0].dates).toContain('2024-01-15');
    });
    
    it('should not add duplicate dates', () => {
      const task = createTask('1', 'Task');
      task.dates = ['2024-01-15'];
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] }
      });
      
      const result = appReducer(state, {
        type: 'ADD_DATE_TO_TASK',
        payload: { taskId: '1', date: '2024-01-15' }
      });
      
      expect(result.workspaces.work[0].dates.filter(d => d === '2024-01-15')).toHaveLength(1);
    });
    
    it('should add multiple different dates', () => {
      const task = createTask('1', 'Task');
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] }
      });
      
      const result1 = appReducer(state, {
        type: 'ADD_DATE_TO_TASK',
        payload: { taskId: '1', date: '2024-01-15' }
      });
      
      const result2 = appReducer(result1, {
        type: 'ADD_DATE_TO_TASK',
        payload: { taskId: '1', date: '2024-01-20' }
      });
      
      expect(result2.workspaces.work[0].dates).toHaveLength(2);
      expect(result2.workspaces.work[0].dates).toContain('2024-01-15');
      expect(result2.workspaces.work[0].dates).toContain('2024-01-20');
    });
  });
  
  describe('REMOVE_DATE_FROM_TASK', () => {
    it('should remove date from task', () => {
      const task = createTask('1', 'Task');
      task.dates = ['2024-01-15', '2024-01-20'];
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] }
      });
      
      const result = appReducer(state, {
        type: 'REMOVE_DATE_FROM_TASK',
        payload: { taskId: '1', date: '2024-01-15' }
      });
      
      expect(result.workspaces.work[0].dates).toEqual(['2024-01-20']);
    });
    
    it('should handle removing non-existent date', () => {
      const task = createTask('1', 'Task');
      task.dates = ['2024-01-20'];
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] }
      });
      
      const result = appReducer(state, {
        type: 'REMOVE_DATE_FROM_TASK',
        payload: { taskId: '1', date: '2024-01-15' }
      });
      
      expect(result.workspaces.work[0].dates).toEqual(['2024-01-20']);
    });
  });
  
  describe('SWITCH_WORKSPACE', () => {
    it('should switch to specified workspace', () => {
      const state = createInitialState({ currentWorkspace: 'work' });
      
      const result = appReducer(state, {
        type: 'SWITCH_WORKSPACE',
        payload: { workspace: 'life' }
      });
      
      expect(result.currentWorkspace).toBe('life');
    });
    
    it('should switch to study workspace', () => {
      const state = createInitialState({ currentWorkspace: 'work' });
      
      const result = appReducer(state, {
        type: 'SWITCH_WORKSPACE',
        payload: { workspace: 'study' }
      });
      
      expect(result.currentWorkspace).toBe('study');
    });
  });
  
  describe('SET_VIEW_MODE', () => {
    it('should set view mode to month', () => {
      const state = createInitialState({ viewMode: 'week' });
      
      const result = appReducer(state, {
        type: 'SET_VIEW_MODE',
        payload: { viewMode: 'month' }
      });
      
      expect(result.viewMode).toBe('month');
    });
    
    it('should set view mode to week', () => {
      const state = createInitialState({ viewMode: 'month' });
      
      const result = appReducer(state, {
        type: 'SET_VIEW_MODE',
        payload: { viewMode: 'week' }
      });
      
      expect(result.viewMode).toBe('week');
    });
  });
  
  describe('SET_CURRENT_DATE', () => {
    it('should update current date', () => {
      const state = createInitialState({ currentDate: '2024-01-01' });
      
      const result = appReducer(state, {
        type: 'SET_CURRENT_DATE',
        payload: { date: '2024-01-15' }
      });
      
      expect(result.currentDate).toBe('2024-01-15');
    });
  });
  
  describe('SET_SEARCH_QUERY', () => {
    it('should update search query', () => {
      const state = createInitialState({ searchQuery: '' });
      
      const result = appReducer(state, {
        type: 'SET_SEARCH_QUERY',
        payload: { query: 'test search' }
      });
      
      expect(result.searchQuery).toBe('test search');
    });
    
    it('should clear search query', () => {
      const state = createInitialState({ searchQuery: 'test' });
      
      const result = appReducer(state, {
        type: 'SET_SEARCH_QUERY',
        payload: { query: '' }
      });
      
      expect(result.searchQuery).toBe('');
    });
  });
  
  describe('SET_DRAG_STATE', () => {
    it('should set drag state', () => {
      const state = createInitialState({
        draggedTaskId: null,
        dropTargetDate: null
      });
      
      const result = appReducer(state, {
        type: 'SET_DRAG_STATE',
        payload: { taskId: '1', dropTarget: '2024-01-15' }
      });
      
      expect(result.draggedTaskId).toBe('1');
      expect(result.dropTargetDate).toBe('2024-01-15');
    });
    
    it('should clear drag state', () => {
      const state = createInitialState({
        draggedTaskId: '1',
        dropTargetDate: '2024-01-15'
      });
      
      const result = appReducer(state, {
        type: 'SET_DRAG_STATE',
        payload: { taskId: null, dropTarget: null }
      });
      
      expect(result.draggedTaskId).toBeNull();
      expect(result.dropTargetDate).toBeNull();
    });
  });
  
  describe('LOAD_DATA', () => {
    it('should load data into state', () => {
      const state = createInitialState({ searchQuery: '' });
      
      const result = appReducer(state, {
        type: 'LOAD_DATA',
        payload: {
          data: {
            currentWorkspace: 'life',
            viewMode: 'month',
            searchQuery: 'test'
          }
        }
      });
      
      expect(result.currentWorkspace).toBe('life');
      expect(result.viewMode).toBe('month');
      expect(result.searchQuery).toBe('test');
    });
    
    it('should not override unspecified fields', () => {
      const task = createTask('1', 'Existing Task');
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] },
        searchQuery: 'existing'
      });
      
      const result = appReducer(state, {
        type: 'LOAD_DATA',
        payload: {
          data: {
            currentWorkspace: 'life'
          }
        }
      });
      
      expect(result.workspaces.work).toHaveLength(1);
      expect(result.searchQuery).toBe('existing');
    });
  });
  
  describe('default case', () => {
    it('should return current state for unknown action', () => {
      const state = createInitialState();
      
      const result = appReducer(state, {
        type: 'UNKNOWN_ACTION' as any,
        payload: {} as any
      });
      
      expect(result).toBe(state);
    });
  });
  
  describe('immutability', () => {
    it('should not mutate original state', () => {
      const task = createTask('1', 'Task');
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] },
        searchQuery: 'original'
      });
      
      const originalState = JSON.parse(JSON.stringify(state));
      
      appReducer(state, {
        type: 'UPDATE_TASK',
        payload: { taskId: '1', updates: { title: 'Updated' } }
      });
      
      expect(state).toEqual(originalState);
    });
    
    it('should not mutate original task objects', () => {
      const task = createTask('1', 'Original');
      const state = createInitialState({
        workspaces: { work: [task], life: [], study: [] }
      });
      
      const originalTask = JSON.parse(JSON.stringify(task));
      
      appReducer(state, {
        type: 'UPDATE_TASK',
        payload: { taskId: '1', updates: { title: 'Updated' } }
      });
      
      expect(task).toEqual(originalTask);
    });
  });
  
  describe('initial state', () => {
    it('should have correct default values', () => {
      expect(initialState.workspaces).toEqual({
        work: [],
        life: [],
        study: []
      });
      expect(initialState.currentWorkspace).toBe('work');
      expect(initialState.viewMode).toBe('week');
      expect(initialState.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(initialState.searchQuery).toBe('');
      expect(initialState.selectedTaskId).toBeNull();
      expect(initialState.draggedTaskId).toBeNull();
      expect(initialState.dropTargetDate).toBeNull();
    });
  });
});