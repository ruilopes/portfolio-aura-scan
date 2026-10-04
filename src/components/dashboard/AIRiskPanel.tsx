import { useMutation } from "@tanstack/react-query";
import { generateAIRisk, type AIRiskResult } from "@/lib/api/ai-risk.functions";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const SEV: Record<string, string> = {
  High: "border-danger/40 bg-danger/10 text-danger",
  Medium: "border-warning/40 bg-warning/10 text-warning",
  Low: "border-success/40 bg-success/10 text-success",
};

const ACTION: Record<string, string> = {
  Buy: "bg-success/20 text-success border-success/50",
  Hold: "bg-warning/20 text-warning border-warning/50",
  Watch: "bg-primary/20 text-primary border-primary/50",
  Avoid: "bg-danger/20 text-danger border-danger/50",
};

export function AIRiskPanel({
  ticker,
  payload,
  onOpenSettings,
}: {
  ticker: string;
  payload: any;
  onOpenSettings: () => void;
}) {
  const [settings] = useSettings();
  const mutation = useMutation({
    mutationFn: () =>
      generateAIRisk({ data: { apiKey: settings.anthropicKey, ticker, payload } }),
  });
  const data = mutation.data as AIRiskResult | undefined;

  return (
    <section className="glass-card p-6">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            🧠 AI Risk Intelligence
            <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
              powered by Claude
            </span>
          </h2>
          <p className="text-xs text-muted-foreground mt-1 italic">
            For informational purposes only. Not financial advice.
          </p>
        </div>
        <div className="flex gap-2">
          {!settings.anthropicKey ? (
            <Button onClick={onOpenSettings} size="sm" variant="outline">
              ⚙️ Add Anthropic API key
            </Button>
          ) : (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} size="sm">
              {mutation.isPending ? "Analysing…" : data ? "Re-analyse" : "Run AI analysis"}
            </Button>
          )}
        </div>
      </div>

      {!settings.anthropicKey && (
        <div className="text-sm text-muted-foreground italic p-6 text-center border border-dashed border-border rounded-lg">
          Add your Anthropic API key in Settings to enable Claude-powered risk analysis,
          bull/bear thesis generation and a suggested action.
        </div>
      )}

      {mutation.isError && (
        <div className="text-sm text-danger p-3 rounded border border-danger/40 bg-danger/10">
          {(mutation.error as Error).message}
        </div>
      )}

      {mutation.isPending && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-lg" />
          ))}
        </div>
      )}

      {data && (
        <div className="space-y-5">
          {/* Suggested action */}
          <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-border bg-muted/30">
            <div className="text-sm">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Suggested action</div>
              <div className={cn("inline-block mt-1 px-3 py-1 rounded-full font-bold border", ACTION[data.suggested_action] || "")}>
                {data.suggested_action}
              </div>
            </div>
            <p className="text-sm flex-1 max-w-2xl">{data.thesis_summary}</p>
          </div>

          {/* Bull / Bear */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-success/30 bg-success/5 p-4">
              <h4 className="font-semibold text-success text-sm mb-2">🐂 Bull case</h4>
              <p className="text-sm text-foreground/90 leading-relaxed">{data.bull_case}</p>
            </div>
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
              <h4 className="font-semibold text-danger text-sm mb-2">🐻 Bear case</h4>
              <p className="text-sm text-foreground/90 leading-relaxed">{data.bear_case}</p>
            </div>
          </div>

          {/* Risks */}
          <div>
            <h3 className="font-semibold text-sm mb-3 text-muted-foreground uppercase tracking-wider">
              Top risks identified
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.risks.map((r, i) => (
                <div key={i} className={cn("rounded-lg border p-4", SEV[r.severity] || "")}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="font-semibold text-sm text-foreground">{r.title}</h4>
                    <span className="text-[10px] font-bold whitespace-nowrap">{r.severity}</span>
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{r.description}</p>
                  <p className="text-[10px] text-muted-foreground mt-2 uppercase tracking-wider">{r.category}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
