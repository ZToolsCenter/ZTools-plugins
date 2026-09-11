import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getSearchProviderTemplateError,
  type SearchProvider,
} from "@/stores/settings/types";

interface SearchProviderSortableGridProps {
  providers: SearchProvider[];
  toggleSearchProvider: (id: string) => void;
  reorderSearchProviders: (nextIds: string[]) => void;
  addCustomSearchProvider: (
    provider: Pick<SearchProvider, "name" | "urlTemplate">,
  ) => void;
  updateCustomSearchProvider: (
    id: string,
    provider: Pick<SearchProvider, "name" | "urlTemplate">,
  ) => void;
  removeCustomSearchProvider: (id: string) => void;
}

interface ProviderCardProps {
  provider: SearchProvider;
  onToggle: (id: string) => void;
  onEdit: (provider: SearchProvider) => void;
  onRemove: (provider: SearchProvider) => void;
}

const PROVIDER_ITEM_CLASS =
  "border-transparent bg-[hsl(var(--goose-selected-bg)/0.58)] dark:bg-[hsl(var(--foreground)/0.08)]";

const PROVIDER_SWITCH_CLASS =
  "data-[state=unchecked]:bg-[hsl(var(--foreground)/0.12)]";

function ProviderCard({
  provider,
  onToggle,
  onEdit,
  onRemove,
}: ProviderCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: provider.id,
    transition: {
      duration: 140,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 transition-all duration-200",
        provider.isEnabled
          ? "border-transparent bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
          : PROVIDER_ITEM_CLASS,
        isDragging && "shadow-md",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          className="h-7 w-7 shrink-0 cursor-grab rounded-md bg-[hsl(var(--goose-selected-bg)/0.78)] text-muted-foreground transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] active:cursor-grabbing dark:bg-[hsl(var(--foreground)/0.1)] dark:hover:bg-[var(--goose-interactive-hover)]"
          {...attributes}
          {...listeners}
          aria-label={`拖拽调整 ${provider.name} 排序`}
        >
          <GripVertical className="h-4 w-4 mx-auto" />
        </button>
        <TooltipProvider delayDuration={600}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Label
                htmlFor={`provider-${provider.id}`}
                className="truncate cursor-pointer"
              >
                {provider.name}
              </Label>
            </TooltipTrigger>
            <TooltipContent side="top">{provider.name}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {provider.isCustom && (
          <>
            <button
              type="button"
              onClick={() => onEdit(provider)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground dark:hover:bg-[var(--goose-interactive-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`编辑 ${provider.name}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onRemove(provider)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--goose-color-danger-subtle-bg)] hover:text-[var(--goose-color-danger-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-[hsl(var(--destructive)/0.18)]"
              aria-label={`删除 ${provider.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <Switch
          id={`provider-${provider.id}`}
          checked={provider.isEnabled ?? false}
          onCheckedChange={() => onToggle(provider.id)}
          className={PROVIDER_SWITCH_CLASS}
        />
      </div>
    </div>
  );
}

function ProviderOverlay({ provider }: { provider: SearchProvider | null }) {
  if (!provider) return null;
  return (
    <div className="flex w-[220px] items-center gap-2 rounded-lg bg-[hsl(var(--goose-selected-bg))] px-3 py-2.5 shadow-lg">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="truncate text-sm font-medium">{provider.name}</span>
    </div>
  );
}

export function SearchProviderSortableGrid({
  providers,
  toggleSearchProvider,
  reorderSearchProviders,
  addCustomSearchProvider,
  updateCustomSearchProvider,
  removeCustomSearchProvider,
}: SearchProviderSortableGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [urlTemplate, setUrlTemplate] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === activeId) ?? null,
    [providers, activeId],
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const oldIndex = providers.findIndex(
      (provider) => provider.id === active.id,
    );
    const newIndex = providers.findIndex((provider) => provider.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(providers, oldIndex, newIndex);
    reorderSearchProviders(next.map((provider) => provider.id));
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setName("");
    setUrlTemplate("");
    setNameError(null);
    setUrlError(null);
  };

  const startAdding = () => {
    setEditingId(null);
    setName("");
    setUrlTemplate("");
    setNameError(null);
    setUrlError(null);
    setFormOpen(true);
  };

  const startEditing = (provider: SearchProvider) => {
    setEditingId(provider.id);
    setName(provider.name);
    setUrlTemplate(provider.urlTemplate);
    setNameError(null);
    setUrlError(null);
    setFormOpen(true);
  };

  const handleRemove = (provider: SearchProvider) => {
    removeCustomSearchProvider(provider.id);
    if (editingId === provider.id) closeForm();
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedTemplate = urlTemplate.trim();
    const duplicateName = providers.some(
      (provider) =>
        provider.id !== editingId &&
        provider.name.trim().toLocaleLowerCase() ===
          normalizedName.toLocaleLowerCase(),
    );
    const nextNameError = !normalizedName
      ? "请输入名称"
      : duplicateName
        ? "已有同名搜索引擎"
        : null;
    const nextUrlError = getSearchProviderTemplateError(normalizedTemplate);

    setNameError(nextNameError);
    setUrlError(nextUrlError);
    if (nextNameError || nextUrlError) return;

    if (editingId) {
      updateCustomSearchProvider(editingId, {
        name: normalizedName,
        urlTemplate: normalizedTemplate,
      });
    } else {
      addCustomSearchProvider({
        name: normalizedName,
        urlTemplate: normalizedTemplate,
      });
    }
    closeForm();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext
        items={providers.map((provider) => provider.id)}
        strategy={rectSortingStrategy}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onToggle={toggleSearchProvider}
              onEdit={startEditing}
              onRemove={handleRemove}
            />
          ))}
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={null}>
        <ProviderOverlay provider={activeProvider} />
      </DragOverlay>

      {formOpen ? (
        <form
          onSubmit={handleSubmit}
          className="mt-3 rounded-[12px] bg-[hsl(var(--goose-selected-bg)/0.58)] p-4 dark:bg-[hsl(var(--foreground)/0.08)]"
        >
          <div className="mb-3">
            <p className="text-sm font-medium text-foreground">
              {editingId ? "编辑自定义搜索" : "添加自定义搜索"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              在搜索网址中用 %s 表示右键菜单里的搜索内容。
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="custom-search-name">名称</Label>
              <Input
                id="custom-search-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(null);
                }}
                placeholder="例如：知乎"
                maxLength={30}
                autoFocus
                aria-invalid={Boolean(nameError)}
                aria-describedby={
                  nameError ? "custom-search-name-error" : undefined
                }
              />
              {nameError && (
                <p
                  id="custom-search-name-error"
                  className="text-xs text-destructive"
                  role="alert"
                >
                  {nameError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="custom-search-url">搜索网址</Label>
              <Input
                id="custom-search-url"
                value={urlTemplate}
                onChange={(event) => {
                  setUrlTemplate(event.target.value);
                  setUrlError(null);
                }}
                placeholder="https://example.com/search?q=%s"
                inputMode="url"
                spellCheck={false}
                aria-invalid={Boolean(urlError)}
                aria-describedby={
                  urlError
                    ? "custom-search-url-error"
                    : "custom-search-url-help"
                }
              />
              {urlError ? (
                <p
                  id="custom-search-url-error"
                  className="text-xs text-destructive"
                  role="alert"
                >
                  {urlError}
                </p>
              ) : (
                <p
                  id="custom-search-url-help"
                  className="text-xs text-muted-foreground"
                >
                  仅支持 http 或 https，且需要包含一个 %s。
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={closeForm}>
              取消
            </Button>
            <Button type="submit" size="sm">
              {editingId ? "保存" : "添加"}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={startAdding}
          className="mt-3 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          添加自定义搜索
        </Button>
      )}
    </DndContext>
  );
}
