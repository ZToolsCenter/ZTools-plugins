/**
 * 只读 Monaco 编辑器预览组件
 * 用于历史记录预览
 */

import React, { useRef } from 'react';
import Editor from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

interface ReadOnlyMonacoPreviewProps {
  content: string;
  language?: string;
  fontSize?: number;
  height?: string;
  theme?: string;
}

export const ReadOnlyMonacoPreview: React.FC<ReadOnlyMonacoPreviewProps> = ({
  content,
  language = 'json',
  fontSize = 14,
  height = '50vh',
  theme,
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleEditorDidMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;

    // 设置为只读
    editor.updateOptions({
      readOnly: true,
      domReadOnly: true,
    });

    // 禁用右键菜单
    editor.updateOptions({
      contextmenu: false,
    });

    // 禁用滚动动画
    editor.updateOptions({
      smoothScrolling: false,
    });

    // 设置字体大小
    editor.updateOptions({
      fontSize: fontSize,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
    });

    // 优化显示
    editor.updateOptions({
      lineNumbers: 'on',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      automaticLayout: true,
    });
  };

  // 获取当前主题
  const getTheme = () => {
    if (theme) return theme;
    // 检测系统主题
    if (typeof window !== 'undefined') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return isDark ? 'vs-dark' : 'light';
    }
    return 'light';
  };

  return (
    <div className="w-full">
      <Editor
        height={height}
        language={language}
        theme={getTheme()}
        value={content}
        options={{
          readOnly: true,
          domReadOnly: true,
          contextmenu: false,
          lineNumbers: 'on',
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          fontSize: fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
          scrollbar: {
            vertical: 'visible',
            horizontal: 'visible',
            useShadows: false,
            verticalScrollbarSize: 12,
            horizontalScrollbarSize: 12,
          },
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
};
