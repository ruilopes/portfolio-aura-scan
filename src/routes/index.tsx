import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { analyzeStock, type AnalysisResult } from "@/server/analyze.functions";
import { ScoreBreakdown } from "@/components/dashboard/ScoreBreakdown";
import { SourceBadge } from "@/components/dashboard/SourceBadge";
import { FundamentalCard } from "@/components/dashboard/FundamentalCard";
import { PriceChart } from "@/components/dashboard/PriceChart";
import { RiskRadar } from "@/components/dashboard/RiskRadar";
import { RiskFactors } from "@/components/dashboard/RiskFactors";
import { MacroBar } from "@/components/dashboard/MacroBar";
import { AnalystIntelligence } from "@/components/dashboard/AnalystIntelligence";
import { LoadingSkeleton } from "@/components/dashboard/LoadingSkeleton";
import { SettingsModal } from "@/components/dashboard/SettingsModal";
import { PriceTargetFairValue } from "@/components/dashboard/PriceTargetFairValue";

import { OwnershipPanel } from "@/components/dashboard/OwnershipPanel";
import { UpgradesPanel } from "@/components/dashboard/UpgradesPanel";
import { AIRiskPanel } from "@/components/dashboard/AIRiskPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtPrice, fmtPctRaw, fmtDate } from "@/lib/format";
import { fmtPriceCcy } from "@/lib/format";
import { CURRENCY_SYMBOL, convertCurrency, SUPPORTED_SUFFIXES, type Currency } from "@/lib/markets";
import { useSettings } from "@/lib/settings";
import { cacheGet, cacheSet } from "@/lib/cache";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stock Analysis Dashboard — Multi-Source Risk Intelligence" },
      { name: "description", content: "Free, keyless US-stock analysis: Yahoo Finance, SEC EDGAR, FRED and Claude-powered risk intelligence." },
      { property: "og:title", content: "Stock Analysis Dashboard" },
      { property: "og:description", content: "Multi-source fundamental, technical and risk analysis for US stocks." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const [title, setTitle] = useState("Stock Analysis Dashboard");
  const [editingTitle, setEditingTitle] = useState(false);
  const [ticker, setTicker] = useState("AAPL");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<"local" | "USD">("local");
  const dashRef = useRef<HTMLDivElement>(null);
  const [settings] = useSettings();

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  const mutation = useMutation({
    mutationFn: async (opts: { ticker: string; forceYahooRetry?: boolean }): Promise<AnalysisResult> => {
      const ttl = settings.cacheMinutes * 60_000;
      // Bypass cache when manually retrying Yahoo.
      if (!opts.forceYahooRetry) {
        const cached = cacheGet<AnalysisResult>(`analysis:${opts.ticker}`, ttl);
        if (cached) return cached;
      }
      const fresh = await analyzeStock({
        data: { ticker: opts.ticker, forceYahooRetry: opts.forceYahooRetry },
      });
      cacheSet(`analysis:${opts.ticker}`, fresh);
      return fresh;
    },
  });

  const onAnalyze = () => {
    const t = ticker.trim().toUpperCase();
    if (t) mutation.mutate({ ticker: t });
  };

  const onRetryYahoo = () => {
    const t = (mutation.data?.ticker || ticker).trim().toUpperCase();
    if (t) mutation.mutate({ ticker: t, forceYahooRetry: true });
  };

  const result = mutation.data;

  const exportPDF = async () => {
    if (!dashRef.current) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const canvas = await html2canvas(dashRef.current, {
      backgroundColor: theme === "dark" ? "#1a1d2e" : "#ffffff",
      scale: 1.5,
      useCORS: true,
    });
    const img = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height * w) / canvas.width;
    const pageH = pdf.internal.pageSize.getHeight();
    if (h <= pageH) {
      pdf.addImage(img, "PNG", 0, 0, w, h);
    } else {
      let remaining = h;
      let y = 0;
      while (remaining > 0) {
        pdf.addImage(img, "PNG", 0, y, w, h);
        remaining -= pageH;
        y -= pageH;
        if (remaining > 0) pdf.addPage();
      }
    }
    pdf.save(`${result?.ticker || "stock"}-analysis.pdf`);
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
        {/* HEADER */}
        <header className="flex items-center justify-between gap-4 mb-8">
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(e) => e.key === "Enter" && setEditingTitle(false)}
                className="text-3xl lg:text-4xl font-bold bg-transparent border-b-2 border-primary outline-none w-full"
              />
            ) : (
              <h1
                onClick={() => setEditingTitle(true)}
                className="group text-3xl lg:text-4xl font-bold cursor-text inline-flex items-center gap-2"
                title="Click to edit"
              >
                {title}
                <svg className="w-4 h-4 opacity-40 group-hover:opacity-100 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </h1>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              Keyless multi-source risk intelligence · Yahoo Finance · SEC EDGAR · FRED
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
              {theme === "dark" ? "☀️" : "🌙"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙️
            </Button>
            {result && (
              <Button variant="outline" size="sm" onClick={exportPDF}>
                Export PDF
              </Button>
            )}
          </div>
        </header>

        {/* SEARCH */}
        <section className="glass-card p-5 mb-8">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <Input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && onAnalyze()}
              placeholder="Enter ticker (e.g. AAPL, EDP.LS, ASML.AS, SAP.DE, SHEL.L)"
              className="flex-1 text-lg font-semibold tracking-wider uppercase"
              maxLength={12}
              title={"Supported markets:\n" + SUPPORTED_SUFFIXES.map(s => `${s.flag}  ${s.suffix.padEnd(8)} ${s.exchange}`).join("\n")}
            />
            <Button onClick={onAnalyze} disabled={mutation.isPending} size="lg" className="font-semibold">
              {mutation.isPending ? "Analysing…" : "Analyse"}
            </Button>
            {result && result.market !== "US" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisplayCurrency(displayCurrency === "local" ? "USD" : "local")}
                title="Toggle currency display"
              >
                {displayCurrency === "local" ? `Show in USD` : `Show in ${result.currency}`}
              </Button>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">
            🌍 Supports US + European markets · suffix examples: .LS Lisboa · .AS Amsterdam · .PA Paris · .DE Frankfurt · .L London · .MI Milan · .MC Madrid
          </div>
          {mutation.isError && (
            <p className="text-sm text-danger mt-3">
              {(mutation.error as Error)?.message || "Failed to analyse. Please try again."}
            </p>
          )}
        </section>

        {/* Yahoo rate-limit banner */}
        {result?.sourceStatus?.yahooRateLimited && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            <span>
              ⚠️ Yahoo Finance is currently rate-limited — data is being served from
              Polygon.io &amp; Tiingo.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetryYahoo}
              disabled={mutation.isPending}
              className="border-warning/40 text-warning hover:bg-warning/20"
            >
              {mutation.isPending ? "Retrying…" : "Retry Yahoo"}
            </Button>
          </div>
        )}

        <div ref={dashRef} className="space-y-8">
          {mutation.isPending && <LoadingSkeleton />}
          {result && <DashboardContent result={result} onOpenSettings={() => setSettingsOpen(true)} displayCurrency={displayCurrency} />}
          {!mutation.isPending && !result && (
            <div className="glass-card p-12 text-center">
              <div className="text-6xl mb-4">📊</div>
              <h2 className="text-xl font-semibold">Enter a ticker to begin</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Try <button onClick={() => setTicker("AAPL")} className="text-primary underline">AAPL</button>,{" "}
                <button onClick={() => setTicker("MSFT")} className="text-primary underline">MSFT</button>, or{" "}
                <button onClick={() => setTicker("TSLA")} className="text-primary underline">TSLA</button>.
              </p>
              <p className="text-xs text-muted-foreground mt-4">
                All data sources are free and keyless. Add an Anthropic API key in{" "}
                <button onClick={() => setSettingsOpen(true)} className="text-primary underline">⚙️ Settings</button>{" "}
                to enable Claude-powered risk analysis.
              </p>
            </div>
          )}
        </div>

        {/* FOOTER — Data sources */}
        <footer className="mt-12 pt-8 border-t border-border">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Data Sources</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            {[
              {
                name: "Polygon.io",
                desc: "Primary: fundamentals, technicals, price, news",
                ok: result?.sourceStatus?.polygon,
                badge: result?.sourceStatus?.polygon
                  ? "✅ Active"
                  : result?.sourceStatus?.polygonRateLimited
                  ? "⚠️ Rate-limited"
                  : result?.sourceStatus?.polygonUnauthorized
                  ? "✗ free-tier blocked"
                  : result?.sourceStatus?.polygonHasKey ? "✗ failed" : "— no key",
              },
              {
                name: "Tiingo",
                desc: "Active fallback: ratios, margins, earnings, news NLP",
                ok: result?.sourceStatus?.tiingo,
                badge: result?.sourceStatus?.tiingo
                  ? "✅ Active"
                  : result?.sourceStatus?.tiingoRateLimited
                  ? "⚠️ Rate-limited"
                  : result?.sourceStatus?.tiingoUnauthorized
                  ? "✗ paid-only"
                  : result?.sourceStatus?.tiingoHasKey ? "✗ failed" : "— no key",
              },
              {
                name: "SEC EDGAR",
                desc: "Active: historical financials, filings",
                ok: result?.sourceStatus?.sec,
                badge: result?.sourceStatus?.sec ? "✅ Active" : "✗ failed",
              },
              {
                name: "FRED",
                desc: "Active: Fed Funds, 10Y, CPI, VIX, DXY",
                ok: result?.sourceStatus?.fred,
                badge: result?.sourceStatus?.fred ? "✅ Active" : "✗ failed",
              },
              {
                name: "Yahoo Finance",
                desc: "Last resort: rate-limited from Cloudflare Workers",
                ok: result?.sourceStatus?.yahoo,
                badge: result?.sourceStatus?.yahooRateLimited
                  ? "⚠️ Rate-limited"
                  : result?.sourceStatus?.yahoo ? "✅ OK" : "✗ failed",
              },
              {
                name: "Yahoo Chart API",
                desc: "Last resort: 1y OHLCV for SMA/RSI/MACD/BB",
                ok: result?.sourceStatus?.yahooChart,
                badge: result?.sourceStatus?.yahooRateLimited
                  ? "⚠️ Rate-limited"
                  : result?.sourceStatus?.yahooChart ? "✅ OK" : "✗ failed",
              },
            ].map((s) => (
              <div key={s.name} className="glass-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-foreground">{s.name}</span>
                  <span className={s.ok ? "text-success text-[10px]" : "text-muted-foreground text-[10px]"}>
                    {s.badge}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1">{s.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-6 text-center">
            Educational use only · Not investment advice · Verify all data independently
          </p>
        </footer>
      </div>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function DashboardContent({ result, onOpenSettings, displayCurrency }: { result: AnalysisResult; onOpenSettings: () => void; displayCurrency: "local" | "USD" }) {

  const riskTone = result.composite >= 65 ? "success" : result.composite >= 35 ? "warning" : "danger";
  const riskLabel = result.composite >= 65 ? "🟢 Low Risk" : result.composite >= 35 ? "🟡 Medium Risk" : "🔴 High Risk";

  // Resolve display currency + symbol + conversion factor.
  const localCcy = result.currency as Currency;
  const showCcy: Currency = displayCurrency === "USD" ? "USD" : localCcy;
  const ccySymbol = CURRENCY_SYMBOL[showCcy];
  const conv = (v: number | null | undefined): number | null =>
    v == null ? null : convertCurrency(v, localCcy, showCcy, result.fxRates as any);

  // Trim payload sent to Claude — keep semantically rich fields only
  const aiPayload = useMemo(() => ({
    company: result.company,
    price: result.price,
    composite: result.composite,
    cards: result.cards.map((c: any) => ({ id: c.id, title: c.title, score: c.score, indicators: c.indicators, extras: c.extras })),
    radar: result.radar,
    risks: result.risks,
    macro: result.macro,
    analyst: { ...result.analyst, upgrades: result.analyst.upgrades?.slice(0, 5) },
    ownership: { heldPctInst: result.ownership.heldPctInst, heldPctInsiders: result.ownership.heldPctInsiders },
  }), [result]);

  return (
    <>
      {/* Company header + score */}
      <section className="glass-card p-6 space-y-6">
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="flex-1 min-w-0 w-full">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-3xl font-bold">{result.ticker}</h2>
              <span className="text-lg text-muted-foreground truncate">{result.company.name}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-sm text-muted-foreground">
              {result.company.sector && <span>{result.company.sector}</span>}
              {result.company.industry && <span>· {result.company.industry}</span>}
              {result.company.country && <span>· {result.company.country}</span>}
              {result.company.exchange && <span>· {result.company.exchange}</span>}
              {result.company.stateOfIncorporation && <span>· Inc. {result.company.stateOfIncorporation}</span>}
            </div>

            <div className="flex items-baseline gap-3 mt-4 flex-wrap">
              <span className="text-4xl font-bold tabular-nums">{fmtPriceCcy(conv(result.price.current), ccySymbol)}</span>
              {result.price.changePct != null && (
                <span className={`text-lg font-medium ${result.price.changePct >= 0 ? "text-success" : "text-danger"}`}>
                  {result.price.changePct >= 0 ? "▲" : "▼"} {fmtPctRaw(Math.abs(result.price.changePct))}
                </span>
              )}
              {result.market !== "US" && (
                <span className="text-xs text-muted-foreground ml-2">
                  {showCcy === localCcy
                    ? `Local currency (${localCcy})`
                    : `Converted from ${localCcy} @ ${result.fxRate?.toFixed(4) ?? "—"}`}
                </span>
              )}
            </div>

            {/* Market flag + exchange name */}
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="text-lg">{result.marketFlag}</span>
              <span className="font-medium">{result.exchangeName}</span>
              {result.benchmark && (
                <span className="text-xs text-muted-foreground">· Benchmark: {result.benchmark.name}</span>
              )}
            </div>

            {/* Liquidity warning for small EU markets */}
            {result.liquidityWarning && (
              <div className="mt-3 text-xs rounded-md border border-warning/40 bg-warning/10 text-warning px-3 py-2">
                ⚠️ Low liquidity — avg daily volume ~{ccySymbol}
                {(result.liquidityWarning.avgDailyValue / 1e6).toFixed(2)}M (below {ccySymbol}1M threshold).
                Wider bid-ask spreads expected. Exercise caution with large positions.
              </div>
            )}

            {/* EU regulatory filing freshness */}
            {result.euFilingTimeliness && (
              <div className={`mt-2 text-xs rounded-md border px-3 py-2 ${
                result.euFilingTimeliness.status === "ok"
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}>
                {result.euFilingTimeliness.status === "ok" ? "✅" : "⚠️"} {result.euFilingTimeliness.detail}
              </div>
            )}

            {result.company.description && (
              <p className="text-sm text-muted-foreground mt-4 leading-relaxed line-clamp-3">
                {result.company.description}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <SourceBadge name="Polygon" ok={result.sourceStatus.polygon} />
              <SourceBadge name="Tiingo" ok={result.sourceStatus.tiingo} />
              <SourceBadge name="SEC EDGAR" ok={result.sourceStatus.sec} />
              <SourceBadge name="FRED" ok={result.sourceStatus.fred} />
              <SourceBadge name="Yahoo" ok={result.sourceStatus.yahoo} />
              <SourceBadge name="Yahoo Chart" ok={result.sourceStatus.yahooChart} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Last updated: {fmtDate(result.lastUpdated)} {new Date(result.lastUpdated).toLocaleTimeString()}
            </p>
          </div>
        </div>

        <ScoreBreakdown
          cards={result.cards.map((c: any) => ({
            id: c.id, title: c.title, weight: c.weight, score: c.score, indicators: c.indicators,
          }))}
          composite={result.composite}
          riskLabel={riskLabel}
          riskTone={riskTone}
          summary={result.summary}
        />
      </section>

      {/* Price chart */}
      <PriceChart
        data={result.priceChart}
        currentPrice={result.price.current}
        high52={result.price.high52}
        low52={result.price.low52}
        crossEvent={(result as any).crossEvent}
        currencySymbol={CURRENCY_SYMBOL[localCcy]}
      />

      {/* Price Target & Fair Value */}
      <PriceTargetFairValue
        current={result.price.current}
        priceTarget={(result as any).priceTarget}
        fairValue={(result as any).fairValue}
        currencySymbol={CURRENCY_SYMBOL[localCcy]}
      />

      {/* Section 1 — Fundamentals */}
      <section>
        <h2 className="text-xl font-bold mb-4">Section 1 · Fundamental Analysis</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {result.cards.map((c: any) => {
            // For non-US markets, relabel "Beta (1y)" → "Beta vs {benchmark} (N/A)"
            const indicators = c.indicators.map((ind: any) => {
              if (ind.k === "Beta (1y)" && result.market !== "US") {
                return { ...ind, k: `Beta vs ${result.benchmark.name}`, v: null };
              }
              return ind;
            });
            return (
              <div key={c.id} id={`card-${c.id}`} className="scroll-mt-24">
                <FundamentalCard
                  title={c.title}
                  weight={c.weight}
                  score={c.score}
                  indicators={indicators}
                  source={c.source}
                  extras={c.extras}
                  currencySymbol={CURRENCY_SYMBOL[localCcy]}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 2 — Risk panel */}
      <section className="glass-card p-6">
        <h2 className="text-xl font-bold mb-2">Section 2 · Risk Exposure Analysis</h2>
        <p className="text-sm text-muted-foreground mb-6">Composite view across market, financial, valuation, regulatory, liquidity and sentiment axes.</p>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2">
            <h3 className="font-semibold mb-2">Risk Radar</h3>
            <RiskRadar data={result.radar} />
            <div className="flex justify-around text-xs mt-2">
              <span className="text-success">● 0–4 Low</span>
              <span className="text-warning">● 4–7 Medium</span>
              <span className="text-danger">● 7–10 High</span>
            </div>
          </div>
          <div className="lg:col-span-3">
            <h3 className="font-semibold mb-3">Triggered Risk Factors (rules-based)</h3>
            <RiskFactors risks={result.risks as any} />
          </div>
        </div>

        <MacroBar
          fedFunds={result.macro.fedFunds}
          treas10y={result.macro.treas10y}
          treas2y={result.macro.treas2y}
          yieldCurve={result.macro.yieldCurve}
          cpi={result.macro.cpi}
          unemployment={result.macro.unemployment}
          vix={result.macro.vix}
          dxy={result.macro.dxy}
          sp500={result.macro.sp500}
          policyRate={result.macro.policyRate}
          policyRateLabel={result.macro.policyRateLabel}
          tenYearLabel={result.macro.tenYearLabel}
          eurUsd={result.macro.eurUsd}
          gbpUsd={result.macro.gbpUsd}
          region={localCcy === "EUR" ? "EUR" : localCcy === "GBP" ? "GBP" : "US"}
        />
      </section>

      {/* Section 2B — AI risk intelligence */}
      <AIRiskPanel ticker={result.ticker} payload={aiPayload} onOpenSettings={onOpenSettings} />

      {/* Section 3 — Analyst intelligence */}
      <section>
        <h2 className="text-xl font-bold mb-4">Section 3 · Analyst Intelligence</h2>
        <AnalystIntelligence
          ratings={result.analyst.ratings}
          targetPrice={result.analyst.targetPrice}
          upside={result.analyst.upside}
          consensusLabel={result.analyst.consensusLabel}
          totalAnalysts={result.analyst.totalAnalysts}
          nextEarnings={result.analyst.nextEarnings}
          nextEPSEst={result.analyst.nextEPSEst}
          filings={result.filings}
          cik={result.company.cik || null}
          currencySymbol={CURRENCY_SYMBOL[localCcy]}
          filingsLabel={result.market === "US" ? "SEC Filings" : "Regulatory Filings"}
        />
        <div className="mt-5">
          <UpgradesPanel upgrades={result.analyst.upgrades || []} />
        </div>
      </section>

      {/* Section 4 — Ownership */}
      <section>
        <h2 className="text-xl font-bold mb-4">Section 4 · Ownership & Insiders</h2>
        <OwnershipPanel
          topHolders={result.ownership.topHolders}
          heldPctInst={result.ownership.heldPctInst}
          heldPctInsiders={result.ownership.heldPctInsiders}
          recentInsiderTx={result.ownership.recentInsiderTx}
        />
      </section>

    
    </>
  );
}
