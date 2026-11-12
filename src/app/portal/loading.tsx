import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
