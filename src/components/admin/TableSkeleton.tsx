import { Skeleton } from '@/components/ui/skeleton';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

/**
 * Generic loading state for admin tables. Matches the dense
 * 12.5px row height used across AdminOverview etc.
 */
export function TableSkeleton({ rows = 6, columns = 5 }: TableSkeletonProps) {
  return (
    <div className="w-full">
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center gap-3 px-3 py-2 border-t border-border/50 first:border-t-0"
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className="h-3.5"
              style={{ width: `${18 + ((c * 13 + r * 7) % 30)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
