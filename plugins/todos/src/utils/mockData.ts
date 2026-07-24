/**
 * 开发模式下的模拟数据
 * 用于展示所有特性
 */

import { Task, Workspace } from '../types';
import { formatDate, generateId } from './dateUtils';

function getDate(daysOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return formatDate(date);
}

function createTask(
  title: string,
  priority: 'high' | 'medium' | 'low',
  dates: string[],
  status: 'todo' | 'done' = 'todo',
  description?: string
): Task {
  return {
    id: generateId(),
    title,
    description,
    priority,
    dates,
    status,
    createdAt: getDate(-7),
    updatedAt: getDate(0),
  };
}

export function generateMockData(): Record<Workspace, Task[]> {
  return {
    work: [
      // 逾期任务
      createTask('完成项目报告', 'high', [getDate(-3)], 'todo', '需要在周五前提交'),
      createTask('修复线上 Bug', 'high', [getDate(-1)], 'todo', '影响用户登录功能'),
      createTask('代码审查', 'medium', [getDate(-2), getDate(-1)]),

      // 今天的任务
      createTask('参加站会', 'medium', [getDate(0)], 'todo', '每日同步进度'),
      createTask('编写单元测试', 'high', [getDate(0)], 'todo', '覆盖核心业务逻辑'),
      createTask('更新 API 文档', 'low', [getDate(0)]),

      // 本周任务
      createTask('设计新功能原型', 'high', [getDate(2)], 'todo', '用户反馈模块'),
      createTask('数据库优化', 'medium', [getDate(3)], 'todo', '提升查询性能'),
      createTask('部署测试环境', 'low', [getDate(4), getDate(5)]),

      // 未安排任务
      createTask('学习新技术', 'low', [], 'todo', '研究微服务架构'),
      createTask('整理技术文档', 'medium', []),

      // 已完成任务
      createTask('需求评审', 'high', [getDate(-5)], 'done'),
      createTask('搭建开发环境', 'medium', [getDate(-4)], 'done'),
    ],
    life: [
      // 逾期任务
      createTask('缴纳水电费', 'high', [getDate(-2)], 'todo', '已逾期两天'),

      // 今天的任务
      createTask('去健身房', 'medium', [getDate(0)], 'todo', '有氧运动 30 分钟'),
      createTask('购买日用品', 'low', [getDate(0)]),

      // 本周任务
      createTask('预约牙医', 'medium', [getDate(2)]),
      createTask('周末聚餐', 'low', [getDate(5), getDate(6)], 'todo', '和朋友见面'),

      // 未安排任务
      createTask('阅读书籍', 'low', [], 'todo', '《深度工作》'),
      createTask('学习烹饪', 'medium', []),

      // 已完成任务
      createTask('打扫房间', 'medium', [getDate(-3)], 'done'),
    ],
    study: [
      // 今天的任务
      createTask('完成算法练习', 'high', [getDate(0)], 'todo', 'LeetCode 第 100 题'),
      createTask('复习英语单词', 'medium', [getDate(0)]),

      // 本周任务
      createTask('阅读技术书籍', 'medium', [getDate(1), getDate(3)], 'todo', '《设计模式》第 5-8 章'),
      createTask('观看在线课程', 'low', [getDate(4)]),

      // 未安排任务
      createTask('准备考试', 'high', [], 'todo', '下个月的认证考试'),
      createTask('写学习笔记', 'medium', []),

      // 已完成任务
      createTask('完成课程作业', 'high', [getDate(-2)], 'done'),
    ],
  };
}

export const isDevMode = import.meta.env.DEV;
