/**
 * 历史记录预览弹窗
 * 提供完整的历史记录预览和恢复功能
 */

import React from 'react';
import { Icon } from '@iconify/react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react';
import { HistoryItem } from '@/types/history';
import { ReadOnlyMonacoPreview } from './ReadOnlyMonacoPreview';

interface HistoryPreviewModalProps {
  isOpen: boolean;
  history: HistoryItem | null;
  onRestore: (historyKey: string) => void;
  onOpenChange: (open: boolean) => void;
}

export const HistoryPreviewModal: React.FC<HistoryPreviewModalProps> = ({
  isOpen,
  history,
  onRestore,
  onOpenChange,
}) => {
  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (!history) return null;

  return (
    <Modal
      size="5xl"
      isOpen={isOpen}
      onClose={() => onOpenChange(false)}
      scrollBehavior="inside"
      classNames={{
        base: 'max-h-[95vh]',
        wrapper: 'items-start justify-center pt-20',
      }}
    >
      <ModalContent className="max-h-[95vh]">
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1 shrink-0 border-b border-default-200 dark:border-default-700 pb-4">
              <div className="flex items-center gap-3">
                <Icon
                  className="text-primary"
                  icon={
                    history.type === 'vanilla'
                      ? 'solar:widget-2-outline'
                      : 'solar:document-text-outline'
                  }
                  width={28}
                />
                <div>
                  <h2 className="text-xl font-semibold">{history.title}</h2>
                  <p className="text-sm text-default-400">{formatTime(history.timestamp)}</p>
                </div>
              </div>
            </ModalHeader>

            <ModalBody className="flex-1 overflow-hidden p-0">
              {/* Monaco 编辑器预览 */}
              <div className="h-[60vh] w-full">
                <ReadOnlyMonacoPreview
                  content={history.content}
                  language={history.editorSettings.language || 'json'}
                  fontSize={history.editorSettings.fontSize || 14}
                  height="60vh"
                />
              </div>

              {/* 统计信息 */}
              <div className="flex items-center justify-between px-6 py-3 border-t border-default-200 dark:border-default-700 bg-default-50 dark:bg-default-100">
                <div className="flex items-center gap-4 text-sm text-default-500">
                  <span>字符数：{history.content.length}</span>
                  <span>行数：{history.content.split('\n').length}</span>
                </div>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<Icon icon="solar:copy-line-duotone" width={16} />}
                  onPress={() => {
                    navigator.clipboard.writeText(history.content);
                  }}
                >
                  复制内容
                </Button>
              </div>
            </ModalBody>

            <ModalFooter className="shrink-0">
              <Button variant="light" onPress={onClose}>
                关闭
              </Button>
              <Button
                color="primary"
                startContent={<Icon icon="mynaui:redo" width={20} />}
                onPress={() => onRestore(history.key)}
              >
                恢复到新标签页
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
