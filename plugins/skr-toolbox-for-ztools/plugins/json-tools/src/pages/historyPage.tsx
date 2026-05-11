/**
 * 历史记录页面
 * 展示所有已关闭的 Tab 历史记录
 */

import React, { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Card,
  CardHeader,
  CardBody,
  Button,
  Input,
  Chip,
  Spacer,
  Tooltip,
} from '@heroui/react';
import { useNavigate } from 'react-router-dom';
import { useHistoryStore } from '@/store/useHistoryStore';
import { HistoryItem } from '@/types/history';
import { HistoryPreviewModal } from '@/components/history/HistoryPreviewModal';
import { cn } from '@heroui/react';

const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const historyStore = useHistoryStore();
  const { histories, isLoading, stats, loadHistories, removeHistory, clearHistories } =
    historyStore;

  const [searchKeyword, setSearchKeyword] = useState('');
  const [filteredHistories, setFilteredHistories] = useState<HistoryItem[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 加载历史记录
  useEffect(() => {
    loadHistories();
    setMounted(true);
  }, []);

  // 搜索过滤
  useEffect(() => {
    if (!searchKeyword.trim()) {
      setFilteredHistories(histories);
    } else {
      const filtered = historyStore.searchHistories(searchKeyword);
      setFilteredHistories(filtered);
    }
  }, [searchKeyword, histories]);

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return minutes === 0 ? '刚刚' : `${minutes} 分钟前`;
      }
      return `${hours} 小时前`;
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days} 天前`;
    } else {
      return date.toLocaleDateString('zh-CN');
    }
  };

  // 获取内容预览
  const getContentPreview = (content: string, maxLength = 100) => {
    if (!content) return '无内容';
    const trimmed = content.trim();
    if (trimmed.length <= maxLength) return trimmed;
    return trimmed.substring(0, maxLength) + '...';
  };

  // 处理预览
  const handlePreview = (history: HistoryItem) => {
    setSelectedHistory(history);
    setIsPreviewOpen(true);
  };

  // 处理恢复
  const handleRestore = async (historyKey: string) => {
    await historyStore.restoreHistory(historyKey);
    setIsPreviewOpen(false);

    // 跳转到首页（编辑器页面）
    navigate('/');
  };

  // 处理删除
  const handleDelete = async (historyKey: string) => {
    await removeHistory(historyKey);
  };

  // 处理清空
  const handleClearAll = async () => {
    if (window.confirm('确定要清空所有历史记录吗？此操作不可恢复。')) {
      await clearHistories();
    }
  };

  // 容器动画变体
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
      },
    },
  };

  // 卡片动画变体
  const cardVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: 'spring',
        stiffness: 260,
        damping: 20,
      },
    },
    exit: {
      scale: 0.95,
      opacity: 0,
      transition: { duration: 0.2 },
    },
  };

  if (!mounted) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Icon
            className="mx-auto animate-spin text-default-400"
            icon="solar:loader-line-duotone"
            width={48}
          />
          <p className="mt-4 text-default-400">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      {/* 页面头部 */}
      <div className="border-b border-default-200 bg-default-50 px-6 py-4 dark:border-default-700 dark:bg-default-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon
              className="text-default-500"
              icon="solar:history-linear"
              width={28}
            />
            <div>
              <h1 className="text-2xl font-semibold">历史记录</h1>
              <p className="text-sm text-default-400">
                查看和恢复已关闭的标签页
              </p>
            </div>
          </div>

          {stats.total > 0 && (
            <div className="flex items-center gap-2">
              <Chip color="primary" size="sm" variant="flat">
                共 {stats.total} 条
              </Chip>
              <Button
                color="danger"
                size="sm"
                variant="flat"
                startContent={<Icon icon="solar:trash-bin-trash-line-duotone" width={16} />}
                onPress={handleClearAll}
              >
                清空全部
              </Button>
            </div>
          )}
        </div>

        <Spacer y={4} />

        {/* 搜索框 */}
        <Input
          isClearable
          className="max-w-md"
          placeholder="搜索历史记录..."
          startContent={
            <Icon className="text-default-400" icon="solar:magnifer-linear" width={20} />
          }
          value={searchKeyword}
          onValueChange={setSearchKeyword}
        />
      </div>

      {/* 历史记录列表 */}
      <div className="h-[calc(100%-140px)] overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Icon
                className="mx-auto animate-spin text-default-400"
                icon="solar:loader-line-duotone"
                width={48}
              />
              <p className="mt-4 text-default-400">加载中...</p>
            </div>
          </div>
        ) : filteredHistories.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Icon
                className="mx-auto text-default-300"
                icon="solar:document-outline"
                width={64}
              />
              <p className="mt-4 text-lg text-default-400">
                {searchKeyword ? '未找到相关历史记录' : '暂无历史记录'}
              </p>
              <p className="mt-2 text-sm text-default-400">
                {searchKeyword
                  ? '请尝试其他关键词'
                  : '关闭的标签页将自动保存到历史记录'}
              </p>
            </div>
          </div>
        ) : (
          <motion.div
            animate="visible"
            className="flex flex-col gap-4"
            initial="hidden"
            variants={containerVariants}
          >
            <AnimatePresence>
              {filteredHistories.map((history) => (
                <motion.div
                  key={history.key}
                  animate="visible"
                  exit="exit"
                  layout
                  variants={cardVariants}
                  className="w-full"
                >
                  <Card
                    className="hover:border-default-400 hover:shadow-md transition-all cursor-pointer w-full"
                  >
                    <CardHeader
                      className="flex items-center justify-between p-4 cursor-pointer"
                      onClick={() => handlePreview(history)}
                    >
                      {/* 左侧：图标和标题 */}
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Icon
                          className={cn(
                            'text-primary shrink-0',
                            history.type === 'vanilla' ? 'text-secondary' : 'text-primary',
                          )}
                          icon={
                            history.type === 'vanilla'
                              ? 'solar:widget-2-outline'
                              : 'solar:document-text-outline'
                          }
                          width={24}
                        />
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <h3 className="text-lg font-semibold truncate text-left">{history.title}</h3>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-default-400">
                              {formatTime(history.timestamp)}
                            </span>
                            <Chip size="sm" variant="flat">
                              {history.type === 'vanilla' ? '树形视图' : '文本视图'}
                            </Chip>
                          </div>
                        </div>
                      </div>

                      {/* 右侧：操作按钮 */}
                      <div
                        className="flex items-center gap-2 shrink-0 ml-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Tooltip content="恢复">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            onPress={() => historyStore.restoreHistory(history.key)}
                          >
                            <Icon icon="mynaui:redo" width={20} />
                          </Button>
                        </Tooltip>

                        <Tooltip content="删除">
                          <Button
                            color="danger"
                            isIconOnly
                            size="sm"
                            variant="light"
                            onPress={() => handleDelete(history.key)}
                          >
                            <Icon
                              icon="solar:trash-bin-trash-line-duotone"
                              width={20}
                            />
                          </Button>
                        </Tooltip>
                      </div>
                    </CardHeader>

                    <CardBody
                      className="pt-0 px-4 pb-4 cursor-pointer"
                      onClick={() => handlePreview(history)}
                    >
                      <div className="rounded-lg bg-default-100 p-3 dark:bg-default-200/50">
                        <pre className="overflow-x-auto text-sm text-default-600 dark:text-default-400">
                          {getContentPreview(history.content)}
                        </pre>
                      </div>
                    </CardBody>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* 预览弹窗 */}
      <HistoryPreviewModal
        history={selectedHistory}
        isOpen={isPreviewOpen}
        onOpenChange={(open) => {
          setIsPreviewOpen(open);
          if (!open) setSelectedHistory(null);
        }}
        onRestore={handleRestore}
      />
    </div>
  );
};

export default HistoryPage;
