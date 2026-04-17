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
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (open) setKeyDraft(settings.anthropicKey);
  }, [open, settings.anthropicKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure AI analysis, cross-validation, and caching.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Anthropic key */}
          <div className="space-y-2">
            <Label htmlFor="anthropic">Anthropic API Key</Label>
            <div className="flex gap-2">
              <Input
                id="anthropic"
                type={showKey ? "text" : "password"}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="sk-ant-…"
                className="font-mono text-xs"
              />
              <Button variant="outline" size="sm" onClick={() => setShowKey((v) => !v)}>
                {showKey ? "Hide" : "Show"}
              </Button>
            </div>
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              <strong>Security warning:</strong> Your key is stored in this browser's
              localStorage and forwarded through this app's server to Anthropic on every
              AI request. Anyone with access to your browser can read it. Use a key with
              tight spend limits. Required only for the "AI Risk Intelligence" panel.
            </div>
            <p className="text-xs text-muted-foreground">
              Get a key at{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                console.anthropic.com
              </a>
              . Uses model <code className="text-foreground">claude-sonnet-4-20250514</code>.
            </p>
          </div>

          {/* Toggles */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Show Data Confidence indicators</Label>
              <p className="text-xs text-muted-foreground">Yahoo vs SEC EDGAR cross-check badges.</p>
            </div>
            <Switch
              checked={settings.showConfidence}
              onCheckedChange={(v) => update({ showConfidence: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Show SEC cross-validation panel</Label>
              <p className="text-xs text-muted-foreground">Side-by-side Yahoo vs SEC EDGAR financials.</p>
            </div>
            <Switch
              checked={settings.showSecCrossCheck}
              onCheckedChange={(v) => update({ showSecCrossCheck: v })}
            />
          </div>

          {/* Cache duration */}
          <div className="space-y-2">
            <Label className="text-sm">Cache duration</Label>
            <div className="flex gap-2">
              {([5, 15, 60] as const).map((m) => (
                <Button
                  key={m}
                  variant={settings.cacheMinutes === m ? "default" : "outline"}
                  size="sm"
                  onClick={() => update({ cacheMinutes: m })}
                >
                  {m === 60 ? "1 hour" : `${m} min`}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={cacheClearAll} className="ml-auto text-xs">
                Clear cache
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Analysis results are cached in your browser to avoid re-fetching.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => {
              update({ anthropicKey: keyDraft.trim() });
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
