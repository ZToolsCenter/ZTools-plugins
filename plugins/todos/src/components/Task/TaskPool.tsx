import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTasks } from '../../hooks/useTasks';
import { useAppContext } from '../../context/AppContext';
import { TaskGroup } from './TaskGroup';
import { EmptyState } from '../Common/EmptyState';
import { isToday, isThisWeek } from '../../utils/dateUtils';
import { getTaskStatus, searchTasks } from '../../utils/taskUtils';
import { FileText } from 'lucide-react';
import './Task.css';

interface TaskPoolProps {
  hoveredTaskId?: string | null;
  onHoverTask?: (taskId: string | null) => void;
}

export function TaskPool({ hoveredTaskId, onHoverTask }: TaskPoolProps) {
  const { state, dispatch } = useAppContext();
  const { addTask, completeTask, deleteTask, getCurrentTasks } = useTasks();
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const skipScrollRef = useRef(false);
  
  // Refs for task groups
  const overdueRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const weekRef = useRef<HTMLDivElement>(null);
  const unscheduledRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<HTMLDivElement>(null);

  // Track expanded state for each group
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    overdue: false,
    today: true,
    week: true,
    unscheduled: true,
    completed: false
  });

  const tasks = getCurrentTasks();
  const filteredTasks = searchTasks(tasks, state.searchQuery);

  // 自动调整 textarea 高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [inputValue]);

  // 处理提交任务
  const handleSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (inputValue.trim()) {
        addTask(inputValue.trim());
        setInputValue('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    }
  };

  // 处理拖拽
  const handleDragStart = (taskId: string) => {
    dispatch({ type: 'SET_DRAG_STATE', payload: { taskId, dropTarget: null } });
  };

  const handleDragEnd = () => {
    dispatch({ type: 'SET_DRAG_STATE', payload: { taskId: null, dropTarget: null } });
  };

  const handleSelectTask = useCallback((taskId: string) => {
    skipScrollRef.current = true;
    dispatch({ type: 'SET_SELECTED_TASK', payload: { taskId } });
  }, [dispatch]);

  const isPoolOnly = state.layoutMode === 'pool-only';

  // 使用 useMemo 缓存分组计算
  const { overdueTasks, todayTasks, thisWeekTasks, unscheduledTasks, completedTasks, pendingTasks } = useMemo(() => {
    if (isPoolOnly) {
      return {
        overdueTasks: [],
        todayTasks: [],
        thisWeekTasks: [],
        unscheduledTasks: [],
        completedTasks: filteredTasks.filter(t => t.status === 'done'),
        pendingTasks: filteredTasks.filter(t => t.status !== 'done')
      };
    }
    return {
      overdueTasks: filteredTasks.filter(t => getTaskStatus(t) === 'overdue'),
      todayTasks: filteredTasks.filter(t => t.dates.some(d => isToday(d))),
      thisWeekTasks: filteredTasks.filter(t =>
        t.dates.some(d => isThisWeek(d)) &&
        !t.dates.some(d => isToday(d)) &&
        getTaskStatus(t) !== 'overdue'
      ),
      unscheduledTasks: filteredTasks.filter(t => t.dates.length === 0),
      completedTasks: filteredTasks.filter(t => t.status === 'done'),
      pendingTasks: []
    };
  }, [filteredTasks, isPoolOnly]);

  // Handle status click to scroll and expand
  const handleStatusClick = useCallback((groupType: string) => {
    const refs: Record<string, React.RefObject<HTMLDivElement>> = {
      overdue: overdueRef,
      today: todayRef,
      week: weekRef,
      unscheduled: unscheduledRef
    };

    const ref = refs[groupType];
    if (ref?.current) {
      // Expand the group
      setExpandedGroups(prev => ({ ...prev, [groupType]: true }));
      
      // Scroll into view
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Scroll to selected task when selectedTaskId changes
  useEffect(() => {
    if (isPoolOnly) return;
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }

    const taskId = state.selectedTaskId;
    if (!taskId) return;

    let groupType: string | null = null;
    if (overdueTasks.some(t => t.id === taskId)) groupType = 'overdue';
    else if (todayTasks.some(t => t.id === taskId)) groupType = 'today';
    else if (thisWeekTasks.some(t => t.id === taskId)) groupType = 'week';
    else if (unscheduledTasks.some(t => t.id === taskId)) groupType = 'unscheduled';
    else if (completedTasks.some(t => t.id === taskId)) groupType = 'completed';

    if (!groupType) return;

    if (!expandedGroups[groupType]) {
      setExpandedGroups(prev => ({ ...prev, [groupType!]: true }));
    }

    const scrollToEl = () => {
      const container = contentRef.current;
      if (!container) return false;
      const el = container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement | null;
      if (!el) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    };

    if (scrollToEl()) return;

    let resolved = false;
    const onMutate = () => {
      if (resolved) return;
      if (scrollToEl()) {
        resolved = true;
        observer.disconnect();
      }
    };

    const container = contentRef.current;
    if (!container) return;
    const observer = new MutationObserver(onMutate);
    observer.observe(container, { childList: true, subtree: true });

    requestAnimationFrame(() => {
      if (!resolved) onMutate();
    });

    const timer = setTimeout(() => { resolved = true; observer.disconnect(); }, 3000);
    return () => { clearTimeout(timer); resolved = true; observer.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedTaskId]);

  return (
    <div className="task-pool">
      <div className="task-pool-header">
        <h2>待办池</h2>
        {isPoolOnly ? (
          <div className="task-status-distribution">
            {pendingTasks.length > 0 && (
              <button
                className="status-item pending"
                onClick={() => {
                  setExpandedGroups(prev => ({ ...prev, completed: false }));
                  setTimeout(() => pendingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
                }}
              >
                <span className="status-dot"></span>
                <span className="status-text">待办</span>
                <span className="status-count">{pendingTasks.length}</span>
              </button>
            )}
            {completedTasks.length > 0 && (
              <button
                className="status-item done"
                onClick={() => {
                  setExpandedGroups(prev => ({ ...prev, completed: true }));
                  setTimeout(() => completedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
                }}
              >
                <span className="status-dot"></span>
                <span className="status-text">已完成</span>
                <span className="status-count">{completedTasks.length}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="task-status-distribution">
            {overdueTasks.length > 0 && (
              <button 
                className="status-item overdue"
                onClick={() => handleStatusClick('overdue')}
              >
                <span className="status-dot"></span>
                <span className="status-text">逾期</span>
                <span className="status-count">{overdueTasks.length}</span>
              </button>
            )}
            {todayTasks.length > 0 && (
              <button 
                className="status-item today"
                onClick={() => handleStatusClick('today')}
              >
                <span className="status-dot"></span>
                <span className="status-text">今天</span>
                <span className="status-count">{todayTasks.length}</span>
              </button>
            )}
            {thisWeekTasks.length > 0 && (
              <button 
                className="status-item week"
                onClick={() => handleStatusClick('week')}
              >
                <span className="status-dot"></span>
                <span className="status-text">本周</span>
                <span className="status-count">{thisWeekTasks.length}</span>
              </button>
            )}
            {unscheduledTasks.length > 0 && (
              <button 
                className="status-item unscheduled"
                onClick={() => handleStatusClick('unscheduled')}
              >
                <span className="status-dot"></span>
                <span className="status-text">未安排</span>
                <span className="status-count">{unscheduledTasks.length}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="task-pool-content" ref={contentRef}>
        {tasks.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="暂无任务"
            description="在下方输入框中添加新任务"
          />
        ) : isPoolOnly ? (
          <>
            <div ref={pendingRef}>
              <TaskGroup
                title="待办"
                tasks={pendingTasks}
                onComplete={completeTask}
                onDelete={deleteTask}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                hoveredTaskId={hoveredTaskId}
                selectedTaskId={state.selectedTaskId}
                onHoverTask={onHoverTask}
                onSelectTask={handleSelectTask}
                showDates={false}
              />
            </div>
            <div ref={completedRef}>
              <TaskGroup
                title="已完成"
                tasks={completedTasks}
                onComplete={completeTask}
                onDelete={deleteTask}
                collapsed={!expandedGroups.completed}
                hoveredTaskId={hoveredTaskId}
                selectedTaskId={state.selectedTaskId}
                onHoverTask={onHoverTask}
                onSelectTask={handleSelectTask}
                onToggleCollapse={() => setExpandedGroups(prev => ({ ...prev, completed: !prev.completed }))}
                showDates={false}
              />
            </div>
          </>
        ) : (
          <>
            <div ref={overdueRef}>
              <TaskGroup
                title="逾期任务"
                tasks={overdueTasks}
                onComplete={completeTask}
                onDelete={deleteTask}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                hoveredTaskId={hoveredTaskId}
                selectedTaskId={state.selectedTaskId}
                onHoverTask={onHoverTask}
                onSelectTask={handleSelectTask}
                onToggleCollapse={() => setExpandedGroups(prev => ({ ...prev, overdue: !prev.overdue }))}
                showDates
                collapsed={!expandedGroups.overdue}
              />
            </div>
            <div ref={todayRef}>
              <TaskGroup
                title="今天的任务"
                tasks={todayTasks}
                onComplete={completeTask}
                onDelete={deleteTask}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                hoveredTaskId={hoveredTaskId}
                selectedTaskId={state.selectedTaskId}
                onHoverTask={onHoverTask}
                onSelectTask={handleSelectTask}
                onToggleCollapse={() => setExpandedGroups(prev => ({ ...prev, today: !prev.today }))}
                showDates
                collapsed={!expandedGroups.today}
              />
            </div>
            <div ref={weekRef}>
              <TaskGroup
                title="本周任务"
                tasks={thisWeekTasks}
                onComplete={completeTask}
                onDelete={deleteTask}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                hoveredTaskId={hoveredTaskId}
                selectedTaskId={state.selectedTaskId}
                onHoverTask={onHoverTask}
                onSelectTask={handleSelectTask}
                onToggleCollapse={() => setExpandedGroups(prev => ({ ...prev, week: !prev.week }))}
                showDates
                collapsed={!expandedGroups.week}
              />
            </div>
            <div ref={unscheduledRef}>
              <TaskGroup
                title="未安排任务"
                tasks={unscheduledTasks}
                onComplete={completeTask}
                onDelete={deleteTask}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                hoveredTaskId={hoveredTaskId}
                selectedTaskId={state.selectedTaskId}
                onHoverTask={onHoverTask}
                onSelectTask={handleSelectTask}
                onToggleCollapse={() => setExpandedGroups(prev => ({ ...prev, unscheduled: !prev.unscheduled }))}
                showDates={false}
                collapsed={!expandedGroups.unscheduled}
              />
            </div>
            <div ref={completedRef}>
              <TaskGroup
                title="已完成任务"
                tasks={completedTasks}
                onComplete={completeTask}
                onDelete={deleteTask}
                collapsed={!expandedGroups.completed}
                hoveredTaskId={hoveredTaskId}
                selectedTaskId={state.selectedTaskId}
                onHoverTask={onHoverTask}
                onSelectTask={handleSelectTask}
                onToggleCollapse={() => setExpandedGroups(prev => ({ ...prev, completed: !prev.completed }))}
                showDates
              />
            </div>
          </>
        )}
      </div>

      <div className="task-pool-input">
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleSubmit}
          placeholder="输入任务名称...&#10;Ctrl+Enter 提交"
          rows={2}
        />
      </div>
    </div>
  );
}