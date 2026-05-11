import React, {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Button,
  Avatar,
  Spinner,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@heroui/react";
import { Icon } from "@iconify/react";
import { cn } from "@heroui/react";

import MarkdownRenderer from "@/components/ai/MarkdownRenderer.tsx";
import { CopyIcon, MenuDotsIcon } from "@/components/Icons.tsx";
import { OpenAIService } from "@/services/openAIService";
import toast from "@/utils/toast";
import { useSettingsStore } from "@/store/useSettingsStore";

// 使用一个更简单的自定义实现，避免类型问题
const PromptInput = React.forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    placeholder?: string;
    minRows?: number;
    radius?: string;
    variant?: string;
    classNames?: Record<string, string>;
    onValueChange?: (value: string) => void;
    endContent?: React.ReactNode;
    onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  }
>((props, ref) => {
  const {
    value,
    placeholder,
    minRows,
    classNames = {},
    onValueChange,
    endContent,
    onKeyDown,
  } = props;

  return (
    <div className={cn("relative w-full", classNames.base)}>
      <div className={cn("bg-transparent", classNames.inputWrapper)}>
        <div className={cn("relative", classNames.innerWrapper)}>
          <textarea
            ref={ref}
            aria-label="Prompt"
            className={cn(
              "min-h-[40px] w-full resize-none rounded-lg bg-transparent p-2 text-default-900 outline-none transition-colors dark:text-white",
              "py-0 overflow-y-auto",
              classNames.input,
            )}
            placeholder={placeholder || "输入提示..."}
            rows={minRows || 2}
            value={value}
            onChange={(e) => onValueChange?.(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {endContent && (
            <div className="absolute bottom-2 right-2">{endContent}</div>
          )}
        </div>
      </div>
    </div>
  );
});

PromptInput.displayName = "PromptInput";

// 对话模式的消息卡片组件
interface MessageCardProps {
  avatar?: string;
  message?: React.ReactNode;
  messageClassName?: string;
  isLoading?: boolean;
  isUser?: boolean; // 标识是否为用户消息
  timestamp?: number; // 添加时间戳参数
  onCopyMessage?: () => void; // 添加复制消息回调
  onDeleteMessage?: () => void; // 添加删除消息回调
  onRegenerateMessage?: () => void; // 添加重新生成回调
}

const MessageCard: React.FC<MessageCardProps> = ({
  avatar,
  message,
  messageClassName,
  isLoading = false,
  isUser = false,
  timestamp,
  onCopyMessage,
  onDeleteMessage,
  onRegenerateMessage,
}) => {
  // 格式化时间
  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "";

  return (
    <div
      className={cn(
        "flex gap-3 items-start w-full mb-2",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      <div className="relative flex-none">
        <Avatar src={avatar} />
      </div>
      <div
        className={cn(
          "flex flex-col",
          isUser ? "items-end" : "items-start",
          "max-w-[85%]",
        )}
      >
        <div
          className={cn(
            "relative rounded-lg px-4 py-3 text-default-600 shadow-sm w-full overflow-hidden",
            isLoading && "animate-pulse-gentle",
            isUser
              ? "rounded-tr-none bg-primary/10 text-foreground border border-primary/10"
              : "rounded-tl-none bg-content2/50 border border-content2/50 backdrop-blur-sm",
            messageClassName,
          )}
        >
          <div className="text-small break-words overflow-hidden">
            {message}
          </div>

          {/* 时间显示和菜单按钮并排 */}
          <div className="flex items-center justify-between mt-1">
            {timestamp && (
              <div className="text-xs text-default-400">{formattedTime}</div>
            )}

            {/* 按钮组 */}
            {!isLoading && (
              <div className="relative flex items-center gap-1 ml-5">
                {/* 复制按钮 */}
                <Button
                  isIconOnly
                  className="min-w-0 w-5 h-5 p-0"
                  size="sm"
                  title="复制"
                  variant="light"
                  onPress={() => {
                    onCopyMessage?.();
                  }}
                >
                  <CopyIcon />
                </Button>

                {/* 更多功能下拉菜单 */}
                <Dropdown placement={isUser ? "bottom-end" : "bottom-start"}>
                  <DropdownTrigger>
                    <Button
                      isIconOnly
                      className="min-w-0 w-5 h-5 p-0"
                      size="sm"
                      title="更多"
                      variant="light"
                    >
                      <MenuDotsIcon size={18} />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu aria-label="消息操作">
                    <DropdownItem
                      key="delete"
                      startContent={
                        <Icon icon="solar:trash-bin-trash-linear" width={16} />
                      }
                      onPress={() => {
                        onDeleteMessage?.();
                      }}
                    >
                      删除
                    </DropdownItem>
                    {!isUser ? (
                      <DropdownItem
                        key="regenerate"
                        startContent={
                          <Icon icon="solar:refresh-linear" width={16} />
                        }
                        onPress={() => {
                          onDeleteMessage?.();
                          onRegenerateMessage?.();
                        }}
                      >
                        重新生成
                      </DropdownItem>
                    ) : null}
                  </DropdownMenu>
                </Dropdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// 文档模式的消息卡片组件
interface DocumentMessageProps {
  role: "user" | "assistant";
  message?: React.ReactNode;
  isLoading?: boolean;
  timestamp?: number; // 添加时间戳参数
  onCopyMessage?: () => void; // 添加复制消息回调
  onDeleteMessage?: () => void; // 添加删除消息回调
  onRegenerateMessage?: () => void; // 添加重新生成回调
}

const DocumentMessage: React.FC<DocumentMessageProps> = ({
  role,
  message,
  isLoading = false,
  timestamp,
  onCopyMessage,
  onDeleteMessage,
  onRegenerateMessage,
}) => {
  // 格式化时间
  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "";

  return (
    <div
      className={cn(
        "w-full py-2 px-3 relative",
        role === "user"
          ? "bg-primary/5 border-l-4 border-primary/30"
          : "border-default-50 border-l-4",
        isLoading && "animate-pulse-gentle",
      )}
    >
      <div className="flex items-start gap-3 w-full">
        <Avatar
          className="bg-default-50"
          size="sm"
          src={role === "user" ? "./avatar_user.png" : "./logo.png"}
        />
        <div className="mt-1 flex-1 w-full text-small overflow-hidden break-words">
          {message}

          {/* 时间显示和菜单按钮并排 */}
          <div className="flex items-center mt-1">
            {timestamp && (
              <div className="text-xs text-default-400">{formattedTime}</div>
            )}

            {/* 按钮组 */}
            {!isLoading && (
              <div className="relative flex items-center gap-1 ml-2">
                {/* 复制按钮 */}
                <Button
                  isIconOnly
                  className="min-w-0 w-5 h-5 p-0"
                  size="sm"
                  title="复制"
                  variant="light"
                  onPress={() => {
                    onCopyMessage?.();
                  }}
                >
                  <CopyIcon />
                </Button>

                {/* 更多功能下拉菜单 */}
                <Dropdown placement="bottom-start">
                  <DropdownTrigger>
                    <Button
                      isIconOnly
                      className="min-w-0 w-5 h-5 p-0"
                      size="sm"
                      title="更多"
                      variant="light"
                    >
                      <MenuDotsIcon size={16} />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu aria-label="消息操作">
                    <DropdownItem
                      key="delete"
                      startContent={
                        <Icon icon="solar:trash-bin-trash-linear" width={16} />
                      }
                      onPress={() => {
                        onDeleteMessage?.();
                      }}
                    >
                      删除
                    </DropdownItem>
                    {role === "assistant" ? (
                      <DropdownItem
                        key="regenerate"
                        startContent={
                          <Icon icon="solar:refresh-linear" width={16} />
                        }
                        onPress={() => {
                          onDeleteMessage?.();
                          onRegenerateMessage?.();
                        }}
                      >
                        重新生成
                      </DropdownItem>
                    ) : null}
                  </DropdownMenu>
                </Dropdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// 定义组件ref的类型
export interface PromptContainerRef {
  sendMessage: (content: string) => void;
}

interface PromptContainerProps {
  onSubmit?: (prompt: string) => Promise<string>;
  onStopGeneration?: () => void;
  initialMessages?: Message[];
  className?: string;
  placeholder?: string;
  showAttachButtons?: boolean;
  onApplyCode?: (code: string) => void;
  editorContent?: string; // 编辑器内容，用于AI分析
  useDirectApi?: boolean; // 是否直接使用API而不通过父组件的onSubmit
  // 差异编辑器相关属性
  isDiffEditor?: boolean; // 是否是差异编辑器
  onApplyCodeToLeft?: (code: string) => void; // 应用到左侧编辑器
  onApplyCodeToRight?: (code: string) => void; // 应用到右侧编辑器
}

const PromptContainer = forwardRef<PromptContainerRef, PromptContainerProps>(
  (
    {
      onSubmit,
      onStopGeneration,
      initialMessages = [],
      className,
      placeholder = "输入您的问题...",
      onApplyCode,
      editorContent = "",
      useDirectApi = false,
      isDiffEditor = false,
      onApplyCodeToLeft,
      onApplyCodeToRight,
    },
    ref,
  ) => {
    const [messages, setMessages] = useState<Message[]>(initialMessages);
    const [prompt, setPrompt] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const maxPromptLength = 2000;
    const [lastContentLength, setLastContentLength] = useState<number>(0);

    // 获取设置中的聊天样式
    const { chatStyle } = useSettingsStore();

    // AI控制器引用
    const aiControllerRef = useRef<AbortController | null>(null);

    // 监听 initialMessages 变化，保持同步
    useEffect(() => {
      setMessages(initialMessages);

      // 检查最后一条消息是否正在更新
      if (initialMessages.length > 0) {
        const lastMessage = initialMessages[initialMessages.length - 1];

        if (lastMessage.role === "assistant") {
          const currentLength = lastMessage.content.length;

          // 如果内容长度增加，说明在流式更新
          if (currentLength > lastContentLength) {
            setIsLoading(true);
            setLastContentLength(currentLength);
          } else if (currentLength === lastContentLength) {
            // 如果内容长度没变，可能是更新完成
            setIsLoading(false);
          } else {
            // 如果是新消息，重置计数
            setLastContentLength(currentLength);
          }
        }
      }
    }, [initialMessages]);

    // 自动滚动到最新消息
    const scrollToBottom = () => {
      if (scrollContainerRef.current) {
        const { scrollHeight, clientHeight } = scrollContainerRef.current;

        scrollContainerRef.current.scrollTop = scrollHeight - clientHeight;
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    };

    useEffect(() => {
      // 使用requestAnimationFrame确保DOM已更新
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }, [messages]);

    // 直接向OpenAI发送请求的方法
    const sendToOpenAI = async (userPrompt: string): Promise<string> => {
      try {
        // 创建一个中止控制器用于取消请求
        const controller = new AbortController();

        aiControllerRef.current = controller;

        // 使用OpenAI服务
        const openAiService = OpenAIService.createInstance();

        // 修改AI系统提示
        const messages = [
          {
            role: "system" as const,
            content:
              "您是一个JSON工具助手，请帮助用户解决JSON相关问题。您可以：\n1. 返回纯代码，请使用```json```包裹代码\n2. 返回解释性文本，使用Markdown格式进行排版\n\n请根据问题类型选择最合适的回复格式。只提供json业务、编码和技术相关的回答，其他不相关的请拒绝回答。",
          },
          {
            role: "user" as const,
            content: `${userPrompt}\n\n以下是用户的JSON数据:\n\`\`\`json\n${editorContent || ""}\n\`\`\``,
          },
        ];

        if (messages[1].content.length > openAiService.maxTokens) {
          throw new Error("内容超出限制，请缩短内容或使用其他方式描述需求。");
        }

        let response = "";

        await openAiService.createChatCompletion(messages, {
          onStart: () => {
            // 已经在外部设置了loading状态
          },
          onChunk: (_chunk, accumulated) => {
            // 检查是否已取消
            if (controller.signal.aborted) {
              throw new Error("已取消生成");
            }

            // 更新响应文本
            response = accumulated;

            // 更新消息中的内容
            setMessages((prev) => {
              const updatedMessages = [...prev];

              if (
                updatedMessages.length > 0 &&
                updatedMessages[updatedMessages.length - 1].role === "assistant"
              ) {
                const lastMessage = updatedMessages[updatedMessages.length - 1];

                updatedMessages[updatedMessages.length - 1] = {
                  role: "assistant",
                  content: accumulated,
                  timestamp: lastMessage.timestamp, // 保持原有时间戳不变
                };
              }

              return updatedMessages;
            });
          },
          onComplete: (final) => {
            response = final;
            aiControllerRef.current = null;
          },
          onError: (error) => {
            console.error("AI请求错误:", error);

            if (error.message === "已取消生成") {
              // 保留已生成内容，什么都不做
            } else {
              response = `处理您的请求时发生错误: ${error.message || "未知错误"}`;
              toast.error(`AI响应错误：${error.message || "请稍后重试"}`);
            }

            aiControllerRef.current = null;
          },
        });

        return response;
      } catch (error: any) {
        console.error("AI请求失败:", error);

        return `请求处理失败: ${error?.message || "未知错误"}`;
      }
    };

    // 复制消息
    const handleCopyMessage = (content: string) => {
      navigator.clipboard
        .writeText(content)
        .then(() => toast.success("已复制到剪贴板"))
        .catch(() => toast.error("复制失败"));
    };

    // 删除消息
    const handleDeleteMessage = (index: number) => {
      setMessages((prevMessages) => prevMessages.filter((_, i) => i !== index));
    };

    // 删除并重新生成消息（找到前一个用户消息并重新提交）
    const handleRegenerateMessage = (index: number) => {
      // 删除当前消息及之后所有消息
      const newMessages = messages.slice(0, index);

      setMessages(newMessages);

      // 找到最后一个用户消息
      const lastUserMessage = [...newMessages]
        .reverse()
        .find((msg) => msg.role === "user");

      if (lastUserMessage) {
        // 重新发送该消息
        handleSendMessage(lastUserMessage.content);
      }
    };

    // 处理发送消息
    const handleSendMessage = async (customPrompt?: string) => {
      const messageContent = customPrompt || prompt;

      if (!messageContent.trim() || isLoading) return;

      // 添加用户消息
      const userMessage: Message = {
        role: "user",
        content: messageContent,
        timestamp: Date.now(),
      };

      // 如果使用自定义prompt，直接添加到消息中
      if (!customPrompt) {
        setMessages((prevMessages) => [...prevMessages, userMessage]);
        setPrompt("");
      }

      setIsLoading(true);

      try {
        // 显示AI正在输入的状态
        const loadingMessage: Message = {
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        };

        setMessages((prevMessages) => [...prevMessages, loadingMessage]);

        let response: string;

        // 判断是直接使用API还是通过父组件的onSubmit
        if (useDirectApi) {
          response = await sendToOpenAI(messageContent);
        } else {
          // 调用提交处理函数获取AI响应
          response =
            (await onSubmit?.(messageContent)) ||
            "抱歉，暂时无法处理您的请求。";
        }

        // 更新消息列表，替换加载消息为实际响应
        setMessages((prevMessages) => [
          ...prevMessages.slice(0, prevMessages.length - 1),
          {
            role: "assistant",
            content: response,
            timestamp: loadingMessage.timestamp, // 使用初始加载消息的时间戳
          },
        ]);
      } catch (error) {
        console.error("发送消息时出错:", error);
        // 更新消息列表，替换加载消息为错误信息
        setMessages((prevMessages) => [
          ...prevMessages.slice(0, prevMessages.length - 1),
          {
            role: "assistant",
            content: "处理您的请求时发生错误，请稍后再试。",
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
      sendMessage: (content: string) => {
        handleSendMessage(content);
      },
    }));

    // 处理按钮点击，根据当前状态决定是发送消息还是停止生成
    const handleButtonClick = () => {
      if (isLoading) {
        // 如果正在加载中，点击按钮停止生成
        if (aiControllerRef.current) {
          aiControllerRef.current.abort();
          aiControllerRef.current = null;
        }
        setIsLoading(false);
        onStopGeneration?.();
      } else {
        // 否则发送消息
        handleSendMessage();
      }
    };

    // 渲染聊天信息 - 根据样式选择渲染方式
    const renderMessages = () => {
      return (
        <div
          className={cn(
            "flex flex-col pb-2",
            chatStyle === "bubble" ? "gap-2 w-full" : "gap-0 w-full",
          )}
        >
          {messages.map((message, index) => {
            const isLastMessage = index === messages.length - 1;
            const isAssistantLastMessage =
              isLastMessage && message.role === "assistant";

            // 共用的消息内容组件
            const messageContent =
              isLoading && isAssistantLastMessage && message.content === "" ? (
                <div className="flex items-center gap-2">
                  <span>AI正在思考</span>
                  <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
                  <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse delay-150" />
                  <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse delay-300" />
                </div>
              ) : (
                <MarkdownRenderer
                  className={cn(
                    "prose prose-sm dark:prose-invert max-w-none overflow-hidden break-words",
                    chatStyle === "document" && "prose-compact w-full",
                    isLoading && isAssistantLastMessage && "relative",
                    "[&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:max-w-full",
                    "[&_code]:whitespace-pre-wrap [&_code]:break-words",
                    "[&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full",
                    "[&_img]:max-w-full [&_img]:h-auto",
                    "[&_p]:break-words [&_p]:overflow-wrap-normal",
                    "[&_ul]:break-words [&_ol]:break-words [&_li]:break-words",
                  )}
                  content={message.content}
                  isDiffEditor={isDiffEditor}
                  onApplyCode={onApplyCode}
                  onApplyCodeToLeft={onApplyCodeToLeft}
                  onApplyCodeToRight={onApplyCodeToRight}
                />
              );

            if (chatStyle === "bubble") {
              // 对话模式
              return (
                <div
                  key={message.timestamp + index}
                  className="animate-in fade-in slide-in-from-bottom-4 duration-300 w-full"
                >
                  {message.role === "user" ? (
                    <MessageCard
                      avatar="./avatar_user.png"
                      isUser={true}
                      message={message.content}
                      messageClassName="shadow-sm"
                      timestamp={message.timestamp}
                      onCopyMessage={() => handleCopyMessage(message.content)}
                      onDeleteMessage={() => handleDeleteMessage(index)}
                    />
                  ) : (
                    <MessageCard
                      avatar="./logo.png"
                      isLoading={
                        isLoading &&
                        isAssistantLastMessage &&
                        message.content === ""
                      }
                      isUser={false}
                      message={messageContent}
                      messageClassName={cn(
                        "shadow-sm",
                        isLastMessage &&
                          "border-blue-200 dark:border-blue-800/40",
                      )}
                      timestamp={message.timestamp}
                      onCopyMessage={() => handleCopyMessage(message.content)}
                      onDeleteMessage={() => handleDeleteMessage(index)}
                      onRegenerateMessage={() => handleRegenerateMessage(index)}
                    />
                  )}
                </div>
              );
            } else {
              // 文档模式
              return (
                <div
                  key={message.timestamp + index}
                  className="animate-in fade-in duration-200 w-full"
                >
                  <DocumentMessage
                    isLoading={
                      isLoading &&
                      isAssistantLastMessage &&
                      message.content === ""
                    }
                    message={messageContent}
                    role={message.role}
                    timestamp={message.timestamp}
                    onCopyMessage={() => handleCopyMessage(message.content)}
                    onDeleteMessage={() => handleDeleteMessage(index)}
                    onRegenerateMessage={
                      message.role === "assistant"
                        ? () => handleRegenerateMessage(index)
                        : undefined
                    }
                  />
                </div>
              );
            }
          })}
          <div ref={messagesEndRef} />
        </div>
      );
    };

    return (
      <div className={cn("flex flex-col h-full w-full", className)}>
        {/* 消息历史区域 - 使用更简单的布局 */}
        <div className="flex-1 overflow-hidden relative">
          <div
            ref={scrollContainerRef}
            className={cn(
              "absolute inset-0 w-full h-full overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent",
              chatStyle === "bubble" ? "px-4 py-3" : "p-0",
            )}
          >
            {renderMessages()}
          </div>
        </div>

        {/* 输入区域 - 使用自适应高度 */}
        <div className="flex-none w-full flex flex-col gap-3 p-4 border-t border-default-200 bg-content1/80 backdrop-blur-sm">
          <form
            className="flex-none w-full flex flex-col items-start rounded-lg bg-default-50/50 transition-colors hover:bg-default-100/70 dark:bg-default-100/10 dark:hover:bg-default-100/20 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
          >
            <PromptInput
              classNames={{
                base: "w-full",
                inputWrapper: "!bg-transparent",
                innerWrapper: "relative",
                input: cn(
                  "pt-3 px-5 pb-12 text-medium max-h-[120px] focus:outline-none focus:ring-0 dark:bg-transparent border-none",
                ),
              }}
              endContent={
                <div className="absolute bottom-3 right-3 flex items-center gap-3">
                  <p className="text-tiny text-default-400 opacity-80">
                    {prompt.length}/{maxPromptLength}
                  </p>

                  <Button
                    className={cn(
                      "flex items-center gap-1 px-3",
                      isLoading && "hover:bg-red-600",
                    )}
                    color={isLoading ? "danger" : "default"}
                    isIconOnly={false}
                    radius="full"
                    size="sm"
                    variant={isLoading ? "solid" : "solid"}
                    onPress={handleButtonClick}
                  >
                    {isLoading ? (
                      <>
                        <Spinner className="mr-2" color="white" size="sm" />
                        <span>停止</span>
                      </>
                    ) : (
                      <>
                        <Icon
                          className={cn(
                            "transition-transform duration-300 [&>path]:stroke-[2px] text-default-600",
                          )}
                          icon="solar:arrow-up-linear"
                          width={20}
                        />
                        <span>发送</span>
                      </>
                    )}
                  </Button>
                </div>
              }
              minRows={2}
              placeholder={placeholder}
              value={prompt}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Cmd+Enter 或 Ctrl+Enter 换行
                  if (e.metaKey || e.ctrlKey) {
                    return;
                  }

                  if (e.shiftKey) {
                    return;
                  }

                  // 普通回车发送消息
                  if (!isLoading && prompt.trim()) {
                    e.preventDefault(); // 阻止默认的换行行为
                    handleSendMessage();
                  }
                }
              }}
              onValueChange={setPrompt}
            />
          </form>
        </div>
      </div>
    );
  },
);

PromptContainer.displayName = "PromptContainer";

export default PromptContainer;
