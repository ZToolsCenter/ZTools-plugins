interface LocalFolderLoadingSkeletonProps {
  rows?: number;
}

export function LocalFolderLoadingSkeleton({
  rows = 8,
}: LocalFolderLoadingSkeletonProps) {
  return (
    <div
      className="px-1 py-1.5"
      aria-label="本地文件夹加载中"
      aria-busy="true"
    >
      <div className="space-y-1.5">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="flex h-8 items-center gap-2 rounded-[8px] px-2"
          >
            <div className="h-4 w-4 shrink-0 rounded bg-muted/70 animate-pulse" />
            <div
              className="h-4 rounded bg-muted/70 animate-pulse"
              style={{
                width: `${48 + ((index * 11) % 32)}%`,
                maxWidth: "220px",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
