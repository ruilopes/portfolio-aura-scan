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

  useEffect(() => {
    if (open) setAnthropicDraft(settings.anthropicKey);
  }, [open, settings.anthropicKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>API keys, data display, and caching.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Anthropic API Key (AI risk panel)</Label>
            <Input
              type="password"
              value={anthropicDraft}
              onChange={(e) => setAnthropicDraft(e.target.value)}
              placeholder="sk-ant-…"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Powers the Claude risk analysis panel. Stored locally —{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-primary underline">
                console.anthropic.com
              </a>
            </p>
          </div>

          <div className="rounded-md border border-success/40 bg-success/10 p-3 text-xs text-success-foreground">
            <strong>Polygon.io</strong> and <strong>Tiingo</strong> API keys are securely stored
            server-side as Lovable Cloud secrets. No browser key handling required.
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
              update({ anthropicKey: anthropicDraft.trim() });
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
