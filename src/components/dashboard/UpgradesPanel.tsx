import { fmtDate } from "@/lib/format";

interface Upgrade {
  date: string | null;
  firm: string | null;
  action: string | null;
  toGrade: string | null;
  fromGrade: string | null;
}

const ACTION_TONE: Record<string, string> = {
  up: "text-success",
  down: "text-danger",
  init: "text-primary",
  main: "text-muted-foreground",
  reit: "text-muted-foreground",
};

export function UpgradesPanel({ upgrades }: { upgrades: Upgrade[] }) {
  if (!upgrades.length) {
    return (
      <div className="glass-card p-5">
        <h3 className="font-semibold mb-3">Recent analyst actions</h3>
        <p className="text-sm text-muted-foreground italic">No recent upgrade/downgrade history.</p>
      </div>
    );
  }
  return (
    <div className="glass-card p-5">
      <h3 className="font-semibold mb-3">Recent analyst actions</h3>
      <ul className="space-y-2 text-sm">
        {upgrades.slice(0, 8).map((u, i) => (
          <li key={i} className="flex items-start justify-between gap-3 border-b border-border/40 pb-2">
            <div className="min-w-0">
              <div className="font-medium truncate">{u.firm || "—"}</div>
              <div className="text-xs text-muted-foreground">
                <span className={ACTION_TONE[u.action || ""] || ""}>{u.action || "—"}</span>
                {u.fromGrade && u.toGrade && u.fromGrade !== u.toGrade && (
                  <> · {u.fromGrade} → <span className="text-foreground">{u.toGrade}</span></>
                )}
                {(!u.fromGrade || u.fromGrade === u.toGrade) && u.toGrade && (
                  <> · <span className="text-foreground">{u.toGrade}</span></>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground shrink-0">{fmtDate(u.date)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
