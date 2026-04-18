import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/lib/settings";
import { cacheClearAll } from "@/lib/cache";

export function SettingsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [settings, update] = useSettings();
  const [anthropicDraft, setAnthropicDraft] = useState("");
  const [fmpDraft, setFmpDraft] = useState("");
  const [avDraft, setAvDraft] = useState("");

  useEffect(() => {
    if (open) {
      setAnthropicDraft(settings.anthropicKey);
      setFmpDraft(settings.fmpKey);
      setAvDraft(settings.avKey);
    }
  }, [open, settings.anthropicKey, settings.fmpKey, settings.avKey]);

  const KeyField = ({
    label, value, setValue, placeholder, link, linkLabel, hint,
  }: {
    label: string; value: string; setValue: (v: string) => void; placeholder: string;
    link: string; linkLabel: string; hint: string;
  }) => (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <Input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
      <p className="text-[11px] text-muted-foreground">
        {hint} —{" "}
        <a href={link} target="_blank" rel="noreferrer" className="text-primary underline">
          {linkLabel}
        </a>
      </p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>API keys, data display, and caching.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <KeyField
            label="Anthropic API Key (AI risk panel)"
            value={anthropicDraft} setValue={setAnthropicDraft}
            placeholder="sk-ant-…"
            link="https://console.anthropic.com/settings/keys" linkLabel="console.anthropic.com"
            hint="Powers the Claude risk analysis panel. Stored locally."
          />
          <KeyField
            label="Financial Modeling Prep Key (free, 250 req/day)"
            value={fmpDraft} setValue={setFmpDraft}
            placeholder="FMP key"
            link="https://site.financialmodelingprep.com/developer/docs" linkLabel="financialmodelingprep.com"
            hint="Fallback for fundamentals, ratios, analyst data, insiders."
          />
          <KeyField
            label="Alpha Vantage Key (free, 25 req/day)"
            value={avDraft} setValue={setAvDraft}
            placeholder="AV key"
            link="https://www.alphavantage.co/support/#api-key" linkLabel="alphavantage.co"
            hint="Fallback for technicals (RSI/MACD/BBANDS) and fundamentals."
          />

          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            <strong>Note:</strong> Keys are stored in your browser's localStorage and forwarded
            through this app's server to each provider on every request.
          </div>

          <div className="border-t border-border pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Show source attribution per indicator</Label>
              <Switch
                checked={settings.showSourceAttribution}
                onCheckedChange={(v) => update({ showSourceAttribution: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Show data confidence badges</Label>
              <Switch
                checked={settings.showConfidence}
                onCheckedChange={(v) => update({ showConfidence: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Show SEC cross-validation panel</Label>
              <Switch
                checked={settings.showSecCrossCheck}
                onCheckedChange={(v) => update({ showSecCrossCheck: v })}
              />
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <Label className="text-sm">Cache duration</Label>
            <div className="flex flex-wrap gap-2">
              {([5, 15, 60, 1440] as const).map((m) => (
                <Button
                  key={m}
                  variant={settings.cacheMinutes === m ? "default" : "outline"}
                  size="sm"
                  onClick={() => update({ cacheMinutes: m })}
                >
                  {m === 1440 ? "24 h" : m === 60 ? "1 h" : `${m} min`}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={cacheClearAll} className="ml-auto text-xs">
                Clear cache
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => {
              update({
                anthropicKey: anthropicDraft.trim(),
                fmpKey: fmpDraft.trim(),
                avKey: avDraft.trim(),
              });
              onOpenChange(false);
            }}
          >
            Save & reload data
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
