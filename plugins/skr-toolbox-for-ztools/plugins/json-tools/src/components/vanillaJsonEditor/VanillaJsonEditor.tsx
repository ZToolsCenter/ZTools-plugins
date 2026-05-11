import React, { useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@heroui/react";
import {
  Content,
  createJSONEditor,
  JsonEditor,
  JSONEditorPropsOptional,
  Mode,
} from "vanilla-jsoneditor-cn";

import "@/styles/vanilla.scss";

export interface VanillaJsonEditorProps {
  ref?: React.Ref<VanillaJsonEditorRef>;
  tabKey: string;
  height?: number | string;
  content?: Content;
  mode?: Mode;
  onUpdateValue?: (value: Content) => void;
  onChangeMode?: (mode: Mode) => void;
  onMount?: () => void;
}

export interface VanillaJsonEditorRef {
  updateEditorContentAndMode: (mode: Mode, content: Content) => void;
}

const VanillaJsonEditor: React.FC<VanillaJsonEditorProps> = ({
  ref,
  height,
  mode,
  content,
  onUpdateValue,
  onChangeMode,
  onMount,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<JsonEditor | null>(null);
  //
  // const clearButtonItem = {
  //   type: 'button',
  //   text: '清空',
  //   icon: { iconName: '', prefix: '', icon: [96, 96, [], '', 'M15 2H9c-1.103 0-2 .897-2 2v2H3v2h2v12c0 1.103.897 2 2 2h10c1.103 0 2-.897 2-2V8h2V6h-4V4c0-1.103-.897-2-2-2M9 4h6v2H9zm8 16H7V8h10z'] },
  //   onClick: () => {
  //     console.log('清空当前内容');
  //   },
  //   title: '清空当前内容',
  //   className: 'jse-group-text-button',
  // }

  const options: JSONEditorPropsOptional = {
    mode: mode,
    // parser
    content: content,

    // react-compiler error
    // @ts-ignore
    // eslint-disable-next-line react-compiler/react-compiler
    target: containerRef.current,
    onChange: (content: Content) => {
      // console.log('onChange', 'content', content, 'previousContent', previousContent, 'changeStatus', changeStatus)
      // let jsonText = ''
      // if (content.json !== undefined) {
      //   console.log('当前 tree 模式更新数据', 'content.json', content.json)
      //   jsonText = stringifyJson(content.json, null, 2)
      // } else if (content.text !== undefined) {
      //   console.log('当前 text 模式更新数据', 'content.text', content.text)
      //   jsonText = content.text
      // }
      // emit('update:modelValue', jsonText)
      // sidebarStore.activeTab.vanilla = content
      onUpdateValue && onUpdateValue(content);
    },
    onChangeMode: (mode: Mode) => {
      onChangeMode && onChangeMode(mode);
    },
    onError(err: Error) {
      console.error("error in VanillaEditor:", err);
    },
  };

  // 更新 editor 的内容和模式
  const updateEditorContentAndMode = (mode: Mode, content: Content) => {
    return new Promise<void>((resolve, reject) => {
      const maxWaitTime = 5000; // 最大等待时间5秒
      const startTime = Date.now();

      const checkEditor = () => {
        if (editorRef.current) {
          const options: JSONEditorPropsOptional = {
            mode: mode,
          };

          editorRef.current.set(content);
          editorRef.current.updateProps(options);
          resolve();
        } else if (Date.now() - startTime < maxWaitTime) {
          // 继续等待
          setTimeout(checkEditor, 100);
        } else {
          // 超时
          console.warn("编辑器初始化超时");
          reject(new Error("编辑器初始化超时"));
        }
      };

      checkEditor();
    });
  };

  const initEditor = () => {
    if (containerRef.current) {
      editorRef.current = createJSONEditor({
        target: containerRef.current,
        props: options,
      });
    }
    onMount && onMount();
  };

  useImperativeHandle(ref, () => ({
    updateEditorContentAndMode: (mode: Mode, content: Content) => {
      return updateEditorContentAndMode(mode, content);
    },
  }));

  useEffect(() => {
    if (!editorRef.current) {
      initEditor();
    }
  }, []);

  // 添加新的useEffect，监听content和mode的变化
  useEffect(() => {
    if (editorRef.current && content) {
      updateEditorContentAndMode(mode || Mode.tree, content)
        .then(() => {
          console.log("编辑器内容和模式更新成功");
        })
        .catch((error) => {
          console.error("编辑器内容和模式更新失败", error);
        });
    }
  }, [content, mode]);

  return (
    <div
      ref={containerRef}
      className={cn("w-full flex-grow vanilla-json-editor", {
        // "jse-theme-dark": theme == "dark",
      })}
      style={{ height: height }}
    />
  );
};

VanillaJsonEditor.displayName = "VanillaJsonEditor";
export default VanillaJsonEditor;
