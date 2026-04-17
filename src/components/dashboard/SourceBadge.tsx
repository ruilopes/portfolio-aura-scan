import { cn } from "@/lib/utils";

export function SourceBadge({ name, ok }: { name: string; ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium border",
        ok
          ? "bg-success/10 text-success border-success/30"
          : "bg-danger/10 text-danger border-danger/30"
      )}
      title={ok ? `${name} responded` : `${name} unavailable`}
    >
      {name} {ok ? "✓" : "✗"}
    </span>
  );
}
