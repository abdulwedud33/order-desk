interface SkeletonProps {
  className?: string;
  height?: string | number;
  width?: string | number;
}

export function Skeleton({ className = '', height, width }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        width: typeof width === 'number' ? `${width}px` : width,
      }}
      aria-hidden="true"
    />
  );
}

export function SkeletonTicket() {
  return (
    <div className="bg-surface border border-line rounded-ticket p-4 mb-3 border-l-4 border-l-line space-y-3">
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-12" />
      </div>
      <div className="space-y-2 pt-2 border-t border-dashed border-line">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="h-12 w-full rounded-control" />
    </div>
  );
}

export const SkeletonCard = SkeletonTicket;

export function SkeletonRow() {
  return (
    <div className="flex items-center justify-between p-3 border-b border-line bg-surface">
      <div className="space-y-1.5 flex-1 mr-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}

export function SkeletonDeliveryCard() {
  return (
    <div className="bg-surface border border-line rounded-card p-4 mb-3 space-y-3.5 shadow-sm">
      <div className="flex justify-between items-center">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <div className="space-y-2 p-3 bg-paper rounded-control border border-line/60">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-8 w-24 rounded-control" />
          <Skeleton className="h-8 w-24 rounded-control" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <div className="flex justify-between items-center pt-2 border-t border-line/60">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-6 w-24 rounded-control" />
      </div>
      <Skeleton className="h-14 w-full rounded-control" />
    </div>
  );
}
