import * as LucideIcons from "lucide-react";
import {
  Button,
  Input,
  Label,
  Spinner,
  Switch,
  Tooltip,
} from "@/lib/heroui";
import {
  getProviderConsoleUrl,
  type AIProviderId,
  type LocalAuthHint,
} from "@/lib/ai-provider";
import { cn } from "@/lib/utils";

/** 与数据层 AIAuthMode 对齐：api_key | oauth */
export type ProviderAuthMode = "api_key" | "oauth";

export type ProviderOAuthStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "expired"
  | "error";

/** 卡片内行：抬于 surface 的 bg，对比清晰 */
const SETTINGS_OPTION_ROW_CLASS =
  "rounded-[12px] border border-border-soft bg-bg";

/** 偏好选中：实色 accent 边，无 color-mix */
const PANEL_SELECTED_CLASS = "border-accent";

function openExternalUrl(url: string) {
  const utools = window.utools as
    | {
        shellOpenExternal?: (u: string) => void;
        openUrl?: (u: string) => void;
      }
    | undefined;
  try {
    if (typeof utools?.shellOpenExternal === "function") {
      utools.shellOpenExternal(url);
      return;
    }
    if (typeof utools?.openUrl === "function") {
      utools.openUrl(url);
      return;
    }
  } catch {
    // fall through
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export interface LocalAuthHintUi {
  displayPath: string;
  hasAuthMaterial: boolean;
  importAllowed: boolean;
  sourceLabel?: string;
  statusNote?: string;
  source?: string;
  providerId?: string | null;
  accountHint?: string;
}

export interface ApiKeyPanelProps {
  providerId: AIProviderId;
  apiKeyDraft: string;
  onApiKeyChange: (value: string) => void;
  apiKeyVisible: boolean;
  onApiKeyVisibleChange: (visible: boolean) => void;
  saveButtonReason: string | null;
  savingCustomConfig: boolean;
  onSaveAndFetch: () => void;
  disabled?: boolean;
  /** 保存前可选：标记 preferred=api_key */
  onPreferApiKey?: () => void;
  /**
   * 是否在 Composer 模型列表中显示该供应商。
   * 有已保存模型/凭证时展示 Switch；undefined 则不渲染。
   */
  providerEnabled?: boolean;
  onProviderEnabledChange?: (enabled: boolean) => void;
  /** 是否展示「在模型列表中显示」开关（通常在已配置凭证后） */
  showProviderEnabledSwitch?: boolean;
}

/** Key 页单列：API 密钥 + 保存拉取 */
export function ApiKeyPanel({
  providerId,
  apiKeyDraft,
  onApiKeyChange,
  apiKeyVisible,
  onApiKeyVisibleChange,
  saveButtonReason,
  savingCustomConfig,
  onSaveAndFetch,
  disabled = false,
  onPreferApiKey,
  providerEnabled = true,
  onProviderEnabledChange,
  showProviderEnabledSwitch = false,
}: ApiKeyPanelProps) {
  const consoleUrl = getProviderConsoleUrl(providerId);

  const handleOpenConsole = () => {
    if (!consoleUrl) return;
    openExternalUrl(consoleUrl);
  };

  const handleSaveAndFetch = () => {
    onPreferApiKey?.();
    onSaveAndFetch();
  };

  return (
    <div className={cn("min-w-0 space-y-2 p-3", SETTINGS_OPTION_ROW_CLASS)}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <LucideIcons.KeyRound
            className="h-3.5 w-3.5 shrink-0 text-fg-muted"
            strokeWidth={1.75}
          />
          <Label
            htmlFor="custom-ai-api-key"
            className="text-[12.5px] font-medium text-fg"
          >
            API 密钥
          </Label>
        </div>
        {consoleUrl ? (
          <Button
            size="sm"
            variant="ghost"
            isDisabled={disabled}
            onPress={handleOpenConsole}
            className="shrink-0"
          >
            <LucideIcons.ExternalLink
              className="h-3.5 w-3.5"
              strokeWidth={1.75}
            />
            打开控制台获取 Key
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Input
            id="custom-ai-api-key"
            fullWidth
            type={apiKeyVisible ? "text" : "password"}
            value={apiKeyDraft}
            onChange={(event) => {
              onApiKeyChange(event.target.value);
            }}
            onFocus={() => onPreferApiKey?.()}
            placeholder="填写后点保存拉取模型"
            autoComplete="off"
            spellCheck={false}
            className="pr-10"
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            isIconOnly
            className="absolute right-1 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
            onPress={() => onApiKeyVisibleChange(!apiKeyVisible)}
            aria-label={
              apiKeyVisible ? "隐藏 API 密钥" : "显示 API 密钥"
            }
            aria-pressed={apiKeyVisible}
            isDisabled={disabled}
          >
            {apiKeyVisible ? (
              <LucideIcons.EyeOff className="h-4 w-4" strokeWidth={1.75} />
            ) : (
              <LucideIcons.Eye className="h-4 w-4" strokeWidth={1.75} />
            )}
          </Button>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <LucideIcons.Download
              className="h-3.5 w-3.5 shrink-0 text-fg-muted"
              strokeWidth={1.75}
            />
            <Label className="text-[12.5px] font-medium text-fg">
              保存并拉取模型
            </Label>
          </div>
          <Tooltip delay={600}>
            <Tooltip.Trigger>
              <div className="inline-flex">
                <Button
                  size="sm"
                  isDisabled={disabled || Boolean(saveButtonReason)}
                  onPress={handleSaveAndFetch}
                  className={cn(
                    Boolean(saveButtonReason) && "cursor-not-allowed",
                  )}
                >
                  {!savingCustomConfig && (
                    <LucideIcons.Save className="h-4 w-4" />
                  )}
                  {savingCustomConfig ? "保存中…" : "保存"}
                </Button>
              </div>
            </Tooltip.Trigger>
            {saveButtonReason ? (
              <Tooltip.Content placement="left">
                {saveButtonReason}
              </Tooltip.Content>
            ) : null}
          </Tooltip>
        </div>

        {showProviderEnabledSwitch && onProviderEnabledChange ? (
          <div className="flex min-w-0 items-center justify-between gap-2 pt-1">
            <Label className="text-[12.5px] font-medium text-fg">
              在模型列表中显示
            </Label>
            <Switch
              aria-label="在模型列表中显示"
              isSelected={providerEnabled}
              onChange={onProviderEnabledChange}
              isDisabled={disabled}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function localAuthSourceLabel(source: string): string {
  if (source === "grok_cli") return "Grok CLI";
  if (source === "opencodex") return "OpenCodex";
  if (source === "codex_cli") return "Codex CLI";
  if (source === "claude_cli") return "Claude Code";
  if (source === "pi_cli") return "Pi";
  if (source === "opencode") return "OpenCode";
  return source;
}

export interface LocalCliAuthListProps {
  hints: LocalAuthHint[];
  /** 当前 oauthSession 是否已连接 */
  oauthStatus: ProviderOAuthStatus;
  oauthAccountLabel?: string | null;
  oauthProviderId?: string | null;
  /** oauthSession.source：多 source 时仅匹配行显示已连接 */
  oauthSource?: string | null;
  importingSource?: string | null;
  savingModels?: boolean;
  disabled?: boolean;
  onImport: (source: string) => void;
  /** xai 是否在 Composer 模型列表中显示（已连接时展示） */
  xaiProviderEnabled?: boolean;
  onXaiProviderEnabledChange?: (enabled: boolean) => void;
}

/** 行内短状态：已连接 | 已过期 | 可导入；不展示长 statusNote */
function hintStatusLabel(
  hint: LocalAuthHint,
  opts: { connected: boolean; expired: boolean },
): string {
  if (opts.connected) return "已连接";
  if (opts.expired) return "已过期";
  if (hint.importAllowed && hint.hasAuthMaterial) return "可导入";
  return "";
}

function providerMatchesHint(
  hint: LocalAuthHint,
  oauthProviderId: string | null,
): boolean {
  return (
    hint.providerId == null ||
    !oauthProviderId ||
    hint.providerId === oauthProviderId
  );
}

/**
 * 多 source 时仅一行算「活动」已连接/已过期：
 * - 有 oauthSource 且与 hint.source 匹配 → 该行
 * - 有 oauthSource 但无任何 hint 匹配 → 仅首个 provider 匹配行
 * - 无 oauthSource → 仅首个 provider 匹配行
 */
function isActiveOAuthHint(
  hint: LocalAuthHint,
  hints: LocalAuthHint[],
  oauthProviderId: string | null,
  oauthSource: string | null,
): boolean {
  if (!hint.importAllowed || !providerMatchesHint(hint, oauthProviderId)) {
    return false;
  }
  const matching = hints.filter(
    (h) => h.importAllowed && providerMatchesHint(h, oauthProviderId),
  );
  if (matching.length === 0) return false;

  const source = oauthSource?.trim() || "";
  if (source) {
    const sourceMatch = matching.find((h) => String(h.source) === source);
    if (sourceMatch) {
      return String(hint.source) === source;
    }
  }
  // 无 source 或 source 无匹配：仅第一行
  return matching[0] === hint;
}

/** 本机账号 Tab：检测到的 CLI 列表（单行紧凑） */
export function LocalCliAuthList({
  hints,
  oauthStatus,
  oauthAccountLabel = null,
  oauthProviderId = null,
  oauthSource = null,
  importingSource = null,
  savingModels = false,
  disabled = false,
  onImport,
  xaiProviderEnabled = true,
  onXaiProviderEnabledChange,
}: LocalCliAuthListProps) {
  const showXaiEnabledSwitch =
    (oauthStatus === "connected" || oauthStatus === "expired") &&
    (oauthProviderId === "xai" || !oauthProviderId) &&
    Boolean(onXaiProviderEnabledChange);

  // CLI 文件已删但 session 仍在：展示合成管理行
  if (hints.length === 0) {
    if (oauthStatus === "connected" || oauthStatus === "expired") {
      const connected = oauthStatus === "connected";
      const label =
        oauthAccountLabel?.trim() ||
        (oauthSource ? localAuthSourceLabel(oauthSource) : null) ||
        "本机账号";

      return (
        <div className="min-w-0 space-y-1.5">
          <div
            className={cn(
              "flex min-w-0 flex-nowrap items-center gap-x-2 px-2.5 py-1.5",
              SETTINGS_OPTION_ROW_CLASS,
              connected && PANEL_SELECTED_CLASS,
            )}
          >
            <LucideIcons.HardDrive
              className="h-4 w-4 shrink-0 text-fg-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            <div className="min-w-0 flex-1 truncate text-[12.5px] leading-tight">
              <span className="font-medium text-fg">{label}</span>
            </div>
            <span className="shrink-0 text-[11.5px] text-fg-muted">
              {connected ? "已连接" : "已过期"}
            </span>
          </div>
          {showXaiEnabledSwitch ? (
            <div
              className={cn(
                "flex min-w-0 items-center justify-between gap-2 px-2.5 py-1.5",
                SETTINGS_OPTION_ROW_CLASS,
              )}
            >
              <Label className="text-[12.5px] font-medium text-fg">
                在模型列表中显示
              </Label>
              <Switch
                aria-label="在模型列表中显示 xAI"
                isSelected={xaiProviderEnabled}
                onChange={onXaiProviderEnabledChange}
                isDisabled={disabled}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className={cn("min-w-0 px-2.5 py-1.5", SETTINGS_OPTION_ROW_CLASS)}>
        <p className="text-[12.5px] text-fg-muted">
          未检测到可导入的本机账号（Grok CLI / OpenCodex xAI）
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-1.5">
      {hints.map((hint) => {
        const sourceKey = String(hint.source);
        const active = isActiveOAuthHint(
          hint,
          hints,
          oauthProviderId,
          oauthSource,
        );
        // 仅活动 source 行显示已连接/已过期 + 管理操作
        const connected = oauthStatus === "connected" && active;
        const expired = oauthStatus === "expired" && active;

        const status = hintStatusLabel(hint, { connected, expired });
        // 优先账号摘要；无则回落路径（单行更干净）
        const accountOrPath =
          hint.accountHint?.trim() ||
          (connected || expired ? oauthAccountLabel?.trim() : "") ||
          hint.displayPath ||
          "";
        const importing = importingSource === sourceKey;
        const importable =
          Boolean(hint.importAllowed) && Boolean(hint.hasAuthMaterial);
        // 导入：idle/connecting；或已有会话但本行非活动 source（可切换来源）
        const showImport =
          importable &&
          (oauthStatus === "idle" ||
            oauthStatus === "connecting" ||
            ((oauthStatus === "connected" ||
              oauthStatus === "expired" ||
              oauthStatus === "error") &&
              !active));

        return (
          <div
            key={`${sourceKey}-${hint.displayPath}`}
            className={cn(
              "flex min-w-0 flex-nowrap items-center gap-x-2 px-2.5 py-1.5",
              SETTINGS_OPTION_ROW_CLASS,
              connected && PANEL_SELECTED_CLASS,
            )}
          >
            <LucideIcons.HardDrive
              className="h-4 w-4 shrink-0 text-fg-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            <div className="min-w-0 flex-1 truncate text-[12.5px] leading-tight">
              <span className="font-medium text-fg">
                {localAuthSourceLabel(sourceKey)}
              </span>
              {accountOrPath ? (
                <span className="text-fg-faint"> · {accountOrPath}</span>
              ) : null}
            </div>
            {status ? (
              <span className="shrink-0 text-[11.5px] text-fg-muted">
                {status}
              </span>
            ) : null}
            {showImport ? (
              <Button
                size="sm"
                className="shrink-0"
                isDisabled={disabled || importing || savingModels}
                onPress={() => onImport(sourceKey)}
              >
                {importing ? (
                  <Spinner size="sm" />
                ) : (
                  <LucideIcons.HardDriveDownload
                    className="h-3.5 w-3.5"
                    strokeWidth={1.75}
                  />
                )}
                {importing ? "导入中…" : "导入"}
              </Button>
            ) : null}
          </div>
        );
      })}
      {showXaiEnabledSwitch ? (
        <div
          className={cn(
            "flex min-w-0 items-center justify-between gap-2 px-2.5 py-1.5",
            SETTINGS_OPTION_ROW_CLASS,
          )}
        >
          <Label className="text-[12.5px] font-medium text-fg">
            在模型列表中显示
          </Label>
          <Switch
            aria-label="在模型列表中显示 xAI"
            isSelected={xaiProviderEnabled}
            onChange={onXaiProviderEnabledChange}
            isDisabled={disabled}
          >
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated 顶层 Tabs 后不再使用双栏；保留 ApiKeyPanel / LocalCliAuthList */
export type ProviderAuthTabsProps = ApiKeyPanelProps;
export type ProviderAuthPanelsProps = ApiKeyPanelProps;

/** @deprecated 使用 ApiKeyPanel */
export function ProviderAuthPanels(props: ApiKeyPanelProps) {
  return <ApiKeyPanel {...props} />;
}

/** @deprecated 使用 ApiKeyPanel */
export const ProviderAuthTabs = ProviderAuthPanels;
