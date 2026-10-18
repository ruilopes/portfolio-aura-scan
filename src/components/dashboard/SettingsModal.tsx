import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSettings, maskKey, clearAnthropicKey } from "@/lib/settings";
import { cacheClearAll } from "@/lib/cache";
import { testAnthropicKey } from "@/lib/api/ai-risk.functions";

export function SettingsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [settings, update] = useSettings();
  const [anthropicDraft, setAnthropicDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [changing, setChanging] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<"valid" | "invalid" | "unreachable" | "no_credits" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasSavedKey = !!settings.anthropicKey.trim();
  const draftChanged = anthropicDraft.trim() !== settings.anthropicKey.trim();

  useEffect(() => {
    if (open) {
      setAnthropicDraft(settings.anthropicKey);
      setReveal(false);
      setChanging(false);
      setTestStatus(null);
    }
  }, [open, settings.anthropicKey]);

  const startChange = () => {
    setAnthropicDraft("");
    setChanging(true);
    setTestStatus(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const cancelChange = () => {
    setAnthropicDraft(settings.anthropicKey);
    setChanging(false);
    setReveal(false);
    setTestStatus(null);
  };

  const saveKey = () => {
    update({ anthropicKey: anthropicDraft.trim() });
    setChanging(false);
    setReveal(false);
    setTestStatus(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>API keys, data display, and caching.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">API Keys</Label>
            <Label className="text-sm block pt-1">Anthropic API Key</Label>
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Input
                  ref={inputRef}
                  type="text"
                  readOnly={hasSavedKey && !changing}
                  value={reveal && !changing ? anthropicDraft : changing || !hasSavedKey ? anthropicDraft : maskKey(anthropicDraft)}
                  onChange={(e) => {
                    setAnthropicDraft(e.target.value);
                    setTestStatus(null);
                  }}
                  placeholder="sk-ant-…"
                  className="font-mono text-xs pr-9"
                  autoComplete="off"
                  spellCheck={false}
                />
                {!changing && anthropicDraft && (
                  <button
                    type="button"
                    onClick={() => setReveal((r) => !r)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-sm opacity-70 hover:opacity-100"
                    aria-label={reveal ? "Hide key" : "Show key"}
                  >
                    👁
                  </button>
                )}
              </div>
              {hasSavedKey && !changing && (
                <Button size="sm" variant="outline" onClick={startChange}>
                  Change
                </Button>
              )}
              {changing && (
                <Button size="sm" variant="outline" onClick={cancelChange}>
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={!anthropicDraft.trim() || testing}
                onClick={async () => {
                  setTesting(true);
                  try {
                    const r = await testAnthropicKey({ data: { apiKey: anthropicDraft.trim() } });
                    setTestStatus(r.status);
                  } catch {
                    setTestStatus("unreachable");
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                {testing ? "…" : "Test"}
              </Button>
              {changing && testStatus === "valid" && (
                <Button size="sm" onClick={saveKey}>
                  Save
                </Button>
              )}
              {!changing && !hasSavedKey && anthropicDraft && testStatus === "valid" && (
                <Button size="sm" onClick={saveKey}>
                  Save
                </Button>
              )}
              {anthropicDraft && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    clearAnthropicKey();
                    setAnthropicDraft("");
                    setChanging(false);
                    setTestStatus(null);
                    update({ anthropicKey: "" });
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            {testStatus === "valid" && <p className="text-xs text-success">✅ Key valid — Claude is ready</p>}
            {testStatus === "invalid" && <p className="text-xs text-danger">❌ Invalid key — check and try again</p>}
            {testStatus === "no_credits" && <p className="text-xs text-warning">⚠️ Key works, but your Anthropic account has no credits</p>}
            {testStatus === "unreachable" && (
              <p className="text-xs text-warning">⚠️ Could not reach Anthropic — check your connection</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Used for: AI Risk Analysis · Investment Memo
              <br />
              Get your key at{" "}
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
