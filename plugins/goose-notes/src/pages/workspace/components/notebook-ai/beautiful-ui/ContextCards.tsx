import { cn } from "@/lib/utils";

export type ContextCardItem = {
  id: string;
  title: string;
  body?: string;
  source?: string;
  badge?: string;
};

export function ContextCards({
  cards,
  onSelect,
  className,
}: {
  cards: ContextCardItem[];
  onSelect?: (id: string) => void;
  className?: string;
}) {
  if (cards.length === 0) return null;
  return (
    <div className={cn("bui-context flex flex-col gap-2", className)}>
      {cards.map((card, index) => {
        const clickable = typeof onSelect === "function";
        const inner = (
          <>
            <div className="bui-context-bar">
              <span className="min-w-0 truncate">{card.title}</span>
              {card.badge ? (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {card.badge}
                </span>
              ) : null}
            </div>
            {card.body ? <p className="bui-context-body">{card.body}</p> : null}
            {card.source ? (
              <div className="px-3 pb-3 text-[12px] text-muted-foreground">
                {card.source}
              </div>
            ) : null}
          </>
        );
        if (clickable) {
          return (
            <button
              key={`${card.id}-${index}`}
              type="button"
              className="bui-context-card w-full text-left"
              onClick={() => onSelect(card.id)}
            >
              {inner}
            </button>
          );
        }
        return (
          <article key={`${card.id}-${index}`} className="bui-context-card">
            {inner}
          </article>
        );
      })}
    </div>
  );
}
