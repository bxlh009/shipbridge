"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { countryMismatch, postcodeMismatch } from "@/lib/matcher";
import { mapCarrier } from "@/lib/carriers";
import { dictionaries, type Locale } from "@/lib/i18n";
import { sampleBuyerEmail } from "@/lib/buyer";
import { SELLER_PROTECTION_WARNING, type GridRow, type HoldStats, type ManifestRow, type Order } from "@/lib/types";

const MatchGrid = dynamic(() => import("@/components/MatchGrid"), { ssr: false });

type Health = { paypal: string; ai: string | null; model: string | null };
type Reply = {
  source: "template" | "llm";
  detectedOrderId: string | null;
  chinese: { summary: string; mood: string; ask: string; disputeRisk: string };
  englishReply: string;
  timeline: { date: string; label: string; state: string }[];
  timelineNote: string;
  trackingNumber: string | null;
  carrier: string | null;
};

type Impact = {
  onHoldFrom: number;
  onHoldTo: number;
  releasingFrom: number;
  releasingTo: number;
  currency: string;
};

const MOCK_KEY = "shipbridge-mock-orders";

const emptyStats: HoldStats = {
  totalOrders: 0,
  onHoldCount: 0,
  onHoldAmount: 0,
  releasingAmount: 0,
  releasePendingCount: 0,
  currency: "USD",
  syncedCount: 0,
  estimatedDaysReleasedEarlier: 0,
  simulated: true,
};

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function readMockOrders(): Order[] | null {
  try {
    const raw = window.localStorage.getItem(MOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { orders?: Order[] } | Order[];
    const orders = Array.isArray(parsed) ? parsed : parsed.orders;
    if (!Array.isArray(orders) || !orders.length) return null;
    return orders;
  } catch {
    return null;
  }
}

function writeMockOrders(orders: Order[]) {
  window.localStorage.setItem(MOCK_KEY, JSON.stringify({ orders }));
}

function clearMockOrders() {
  window.localStorage.removeItem(MOCK_KEY);
}

function useCount(value: number, animate: boolean) {
  const [shown, setShown] = useState(value);
  const [settled, setSettled] = useState(true);
  const fromRef = useRef(value);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce || fromRef.current === value) {
      fromRef.current = value;
      setShown(value);
      setSettled(true);
      return;
    }
    setSettled(false);
    const from = fromRef.current;
    const start = performance.now();
    const duration = 900;
    let frame = 0;
    let cancelled = false;
    const step = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / duration);
      if (t < 1) {
        const eased = 1 - (1 - t) ** 3;
        setShown(from + (value - from) * eased);
        frame = requestAnimationFrame(step);
        return;
      }
      fromRef.current = value;
      setShown(value);
      setSettled(true);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [value, animate]);
  return { shown, settled };
}

export default function AppShell() {
  const [locale, setLocale] = useState<Locale>("en");
  const copy = dictionaries[locale];
  const [health, setHealth] = useState<Health>({ paypal: "mock", ai: "off", model: null });
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<HoldStats>(emptyStats);
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const [rows, setRows] = useState<GridRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [matched, setMatched] = useState(false);
  const [synced, setSynced] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState("");
  const [orderId, setOrderId] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [copied, setCopied] = useState(false);
  const [agentText, setAgentText] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [motion, setMotion] = useState(false);
  const [flash, setFlash] = useState(false);

  const riskCount = rows.filter((row) => row.addressRisk && row.matchedOrderId).length;
  const loaded = rows.length > 0;
  const currentStep = !loaded ? 1 : !matched ? 2 : !synced ? 3 : 0;
  const idle = busy === "";

  function rememberOrders(next: Order[], paypalMode: string) {
    setOrders(next);
    if (paypalMode === "mock") writeMockOrders(next);
  }

  function revealStats(next: HoldStats) {
    const prev = statsRef.current;
    if (prev.totalOrders > 0 && (prev.onHoldCount !== next.onHoldCount || prev.releasingAmount !== next.releasingAmount || prev.syncedCount !== next.syncedCount)) {
      setImpact({
        onHoldFrom: prev.onHoldCount,
        onHoldTo: next.onHoldCount,
        releasingFrom: prev.releasingAmount,
        releasingTo: next.releasingAmount,
        currency: next.currency || prev.currency,
      });
      setMotion(true);
      setFlash(true);
    }
    setStats(next);
  }

  async function applyClientOrders(stored: Order[]) {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders: stored }),
    });
    const body = await response.json();
    if (!body.ok) throw new Error(body.message || "Could not load PayPal orders");
    rememberOrders(body.orders, body.paypal);
    setStats(body.stats);
  }

  async function loadServerOrders() {
    const response = await fetch("/api/orders", { cache: "no-store" });
    const body = await response.json();
    if (!body.ok) throw new Error(body.message || "Could not load PayPal orders");
    rememberOrders(body.orders, body.paypal);
    setStats(body.stats);
    return body;
  }

  useEffect(() => {
    const stored = window.localStorage.getItem("shipbridge-locale");
    if (stored === "zh" || stored === "en") setLocale(stored);
    void (async () => {
      try {
        const healthBody = await fetch("/api/health", { cache: "no-store" }).then((response) => response.json());
        setHealth(healthBody);
        if (healthBody.paypal === "mock") {
          const storedOrders = readMockOrders();
          if (storedOrders) {
            await applyClientOrders(storedOrders);
            return;
          }
        }
        await loadServerOrders();
      } catch {
        setError("Could not load PayPal orders");
      }
    })();
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(false), 1400);
    return () => window.clearTimeout(timer);
  }, [flash]);

  function chooseLocale(next: Locale) {
    setLocale(next);
    window.localStorage.setItem("shipbridge-locale", next);
  }

  function toGrid(manifest: ManifestRow[]): GridRow[] {
    return manifest.map((row) => {
      const mapping = mapCarrier(row.carrier);
      return {
        ...row,
        id: row.trackingNumber,
        paypalCarrier: mapping.carrier,
        carrierNameOther: mapping.carrierNameOther,
        matchedOrderId: null,
        buyerName: null,
        confidence: 0,
        reasons: [],
        addressRisk: false,
        addressWarning: "",
        syncStatus: "idle",
      };
    });
  }

  function takeManifest(manifest: ManifestRow[]) {
    setRows(toGrid(manifest));
    setSelected([]);
    setMatched(false);
    setSynced(false);
    setNotice(`${manifest.length} ${copy.loaded}`);
  }

  async function loadSample(sample: string) {
    setBusy("parse");
    setError("");
    setReply(null);
    try {
      const response = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.message || "Parse failed");
      takeManifest(body.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setBusy("");
    }
  }

  async function onFile(file: File) {
    setBusy("parse");
    setError("");
    try {
      let response: Response;
      if (file.type.startsWith("image/")) {
        const dataUrl = await fileToDataUrl(file);
        response = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageDataUrl: dataUrl, filename: file.name }),
        });
      } else {
        const form = new FormData();
        form.set("file", file);
        response = await fetch("/api/parse", { method: "POST", body: form });
      }
      const body = await response.json();
      if (!body.ok) {
        setError(body.message || "Parse failed");
        return;
      }
      takeManifest(body.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setBusy("");
    }
  }

  async function match() {
    setBusy("match");
    setError("");
    try {
      const response = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, orders }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.message || "Match failed");
      setRows(body.rows);
      setMatched(true);
      setSynced(false);
      setNotice(`${body.rows.filter((row: GridRow) => row.matchedOrderId).length} matched`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Match failed");
    } finally {
      setBusy("");
    }
  }

  function override(rowId: string, nextOrderId: string) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        const order = orders.find((item) => item.id === nextOrderId);
        if (!order) {
          return { ...row, matchedOrderId: null, buyerName: null, confidence: 0, addressRisk: false, addressWarning: "", reasons: ["Cleared by seller"] };
        }
        const risk = postcodeMismatch(row.postcode, order.postalCode) || countryMismatch(row.country, order.country);
        return {
          ...row,
          matchedOrderId: order.id,
          buyerName: order.buyerName,
          confidence: 100,
          reasons: ["Seller override"],
          addressRisk: risk,
          addressWarning: risk ? SELLER_PROTECTION_WARNING : "",
        };
      }),
    );
  }

  function acceptSync(body: { rows?: GridRow[]; orders?: Order[]; stats?: HoldStats; paypal?: string; verified?: number }) {
    if (Array.isArray(body.rows)) setRows(body.rows);
    if (Array.isArray(body.orders)) rememberOrders(body.orders, body.paypal || health.paypal);
    if (body.stats) revealStats(body.stats);
    setSynced(true);
  }

  async function sync() {
    setBusy("sync");
    setError("");
    try {
      const payload = rows.map((row) => ({ ...row, selected: selected.includes(row.id) }));
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload, orders }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.message || "Sync failed");
      acceptSync(body);
      setNotice(`${body.verified} verified in PayPal`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy("");
    }
  }

  async function agent() {
    setBusy("agent");
    setError("");
    try {
      const payload = rows.map((row) => ({ ...row, selected: selected.includes(row.id) }));
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: "Sync tracking for these manifest rows. Skip Seller Protection risks unless the row is selected. Read each tracking number back.",
          rows: payload,
          orders,
        }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.message || "Agent failed");
      setAgentText(body.text || "");
      if (Array.isArray(body.rows) && body.rows.length && body.rows[0].syncStatus) acceptSync(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent failed");
    } finally {
      setBusy("");
    }
  }

  async function reset() {
    setBusy("reset");
    clearMockOrders();
    setRows([]);
    setSelected([]);
    setMatched(false);
    setSynced(false);
    setReply(null);
    setAgentText("");
    setNotice("");
    setImpact(null);
    setMotion(false);
    setFlash(false);
    try {
      const response = await fetch("/api/seed", { method: "POST" });
      const body = await response.json();
      if (body.mode === "mock" && Array.isArray(body.orders)) {
        rememberOrders(body.orders, "mock");
        setStats(body.stats);
      } else if (body.ok) {
        await loadServerOrders();
      }
    } finally {
      setBusy("");
    }
  }

  async function draft() {
    setBusy("reply");
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/buyer-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, orderId: orderId || undefined, orders }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.message || "Draft failed");
      setReply(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setBusy("");
    }
  }

  async function copyReply() {
    if (!reply) return;
    await navigator.clipboard.writeText(reply.englishReply);
    setCopied(true);
  }

  const aiLabel = useMemo(() => (health.ai && health.ai !== "off" ? `AI: ${health.model}` : copy.aiOff), [health, copy.aiOff]);
  const onHoldDelta = impact ? `${impact.onHoldFrom} → ${impact.onHoldTo} ${copy.onHoldTrail}` : undefined;
  const releasingDelta = impact ? `${money(impact.releasingFrom, impact.currency)} → ${money(impact.releasingTo, impact.currency)} ${copy.releasingTrail}` : undefined;
  const releasingHint = stats.releasePendingCount > 0 ? `${copy.releasingHint} · ${copy.simulated}` : stats.syncedCount > 0 ? `${copy.releasedHint} · ${copy.simulated}` : copy.simulated;

  return (
    <div className="min-h-screen">
      <header data-testid="hero" className="bg-gradient-to-r from-[#001a4d] via-[#003087] to-[#0070ba] text-white shadow-md">
        <div className="mx-auto max-w-7xl px-4 pb-8 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15 text-lg font-bold">SB</div>
              <h1 className="text-2xl font-semibold tracking-tight">ShipBridge</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium" data-testid="paypal-chip">
                PayPal: {health.paypal}
              </span>
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium" data-testid="ai-chip">
                {aiLabel}
              </span>
              <div className="ml-1 flex overflow-hidden rounded-full bg-white/15 text-xs">
                <button type="button" data-testid="lang-en" className={`px-3 py-1 ${locale === "en" ? "bg-white text-[#003087]" : ""}`} onClick={() => chooseLocale("en")}>
                  EN
                </button>
                <button type="button" data-testid="lang-zh" className={`px-3 py-1 ${locale === "zh" ? "bg-white text-[#003087]" : ""}`} onClick={() => chooseLocale("zh")}>
                  中文
                </button>
              </div>
            </div>
          </div>
          <p data-testid="hero-pitch" className="mt-6 max-w-4xl text-xl font-medium leading-snug sm:text-2xl">
            {copy.heroPitch}
          </p>
          <p className="mt-2 max-w-3xl text-sm text-blue-100 sm:text-base">{copy.heroSub}</p>
          <div className="mt-6" data-testid="demo-steps">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-100">{copy.stepGuide}</p>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <DemoStep index={1} label={copy.stepLoad} active={currentStep === 1} done={loaded} disabled={!idle} onClick={() => void loadSample("all")} testId="step-load" />
              <span className="hidden px-1 text-lg text-white/70 md:inline" aria-hidden>
                →
              </span>
              <DemoStep index={2} label={copy.stepMatch} active={currentStep === 2} done={matched} disabled={!loaded || !idle} onClick={() => void match()} testId="step-match" />
              <span className="hidden px-1 text-lg text-white/70 md:inline" aria-hidden>
                →
              </span>
              <DemoStep index={3} label={copy.stepSync} active={currentStep === 3} done={synced} disabled={!matched || !idle} onClick={() => void sync()} testId="step-sync" />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" title={copy.simulatedTip}>
          <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-amber-950">{copy.simulated}</span>
          <p>{copy.banner}</p>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" data-testid="impact-stats">
          <Stat label={copy.orders} numeric={stats.totalOrders} decimals={0} format={(value) => String(Math.round(value))} testId="stat-orders" />
          <Stat
            label={copy.onHold}
            numeric={stats.onHoldCount}
            decimals={0}
            format={(value) => String(Math.round(value))}
            hint={copy.simulated}
            testId="stat-on-hold"
            delta={onHoldDelta}
            deltaTestId="delta-on-hold"
            animate={motion}
            flash={flash}
          />
          <Stat
            label={copy.amount}
            numeric={stats.onHoldAmount}
            decimals={2}
            format={(value) => money(value, stats.currency)}
            hint={copy.simulated}
            testId="stat-amount"
            animate={motion}
            flash={flash}
          />
          <Stat
            label={copy.releasing}
            numeric={stats.releasingAmount}
            decimals={2}
            format={(value) => money(value, stats.currency)}
            hint={releasingHint}
            testId="stat-releasing"
            delta={releasingDelta}
            deltaTestId="delta-releasing"
            animate={motion}
            flash={flash}
          />
          <Stat label={copy.synced} numeric={stats.syncedCount} decimals={0} format={(value) => String(Math.round(value))} testId="stat-synced" animate={motion} flash={flash} />
          <Stat
            label={copy.days}
            numeric={stats.estimatedDaysReleasedEarlier}
            decimals={1}
            format={(value) => value.toFixed(1)}
            hint={copy.daysHint}
            testId="stat-days"
            animate={motion}
            flash={flash}
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#003087]">{copy.upload}</h2>
              <p className="text-sm text-slate-500">{copy.uploadHint}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="use-sample" className="rounded-lg bg-[#003087] px-3 py-2 text-sm font-medium text-white" onClick={() => void loadSample("all")}>
                {copy.useSample}
              </button>
              <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onClick={() => void loadSample("yunexpress")}>
                {copy.yun}
              </button>
              <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onClick={() => void loadSample("4px")}>
                {copy.fourpx}
              </button>
              <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onClick={() => void loadSample("yanwen")}>
                {copy.yanwen}
              </button>
              <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-sm">
                {copy.uploadFile}
                <input
                  className="hidden"
                  type="file"
                  accept=".csv,.xlsx,.xls,image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onFile(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          {notice ? <p className="text-sm text-slate-600">{notice}</p> : null}
          {error ? (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="error-banner">
              {error}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#003087]">{copy.grid}</h2>
              <p className="max-w-3xl text-sm text-slate-500">{copy.syncHint}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="match-orders" disabled={!rows.length || busy === "match"} className="rounded-lg bg-[#0070ba] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={() => void match()}>
                {busy === "match" ? copy.matching : copy.match}
              </button>
              <button type="button" data-testid="sync-tracking" disabled={!rows.length || busy === "sync"} className="rounded-lg bg-[#ffc439] px-3 py-2 text-sm font-semibold text-[#003087] disabled:opacity-50" onClick={() => void sync()}>
                {busy === "sync" ? copy.syncing : copy.sync}
              </button>
              <button type="button" disabled={!rows.length || busy === "agent"} className="rounded-lg border border-[#003087] px-3 py-2 text-sm text-[#003087] disabled:opacity-50" onClick={() => void agent()}>
                {copy.agent}
              </button>
              <button type="button" data-testid="reset-demo" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onClick={() => void reset()}>
                {copy.reset}
              </button>
            </div>
          </div>
          {riskCount > 0 ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{copy.riskBanner}</p> : null}
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">{copy.empty}</p>
          ) : (
            <MatchGrid rows={rows} orders={orders} copy={copy} onOverride={override} onSelection={setSelected} />
          )}
          {agentText ? <pre className="mt-3 overflow-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{agentText}</pre> : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#003087]">{copy.buyer}</h2>
              <p className="text-sm text-slate-500">{copy.buyerHint}</p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              onClick={() => {
                setEmail(sampleBuyerEmail());
                setOrderId("");
              }}
            >
              {copy.sampleEmail}
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <textarea
                data-testid="buyer-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Where is my order?"
                className="h-48 w-full rounded-xl border border-slate-200 p-3 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <select className="rounded-lg border border-slate-200 px-2 py-2 text-sm" value={orderId} onChange={(event) => setOrderId(event.target.value)} aria-label="Order">
                  <option value="">{copy.auto}</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.id} · {order.buyerName}
                    </option>
                  ))}
                </select>
                <button type="button" data-testid="draft-reply" className="rounded-lg bg-[#003087] px-3 py-2 text-sm font-medium text-white" onClick={() => void draft()}>
                  {busy === "reply" ? copy.drafting : copy.draft}
                </button>
              </div>
            </div>
            <div data-testid="reply-output" className="rounded-xl bg-slate-50 p-3 text-sm">
              {reply ? (
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{reply.source === "llm" ? "LLM" : "Template"}</p>
                  <Block title={copy.summary} body={reply.chinese.summary} />
                  <Block title={copy.mood} body={reply.chinese.mood} />
                  <Block title={copy.ask} body={reply.chinese.ask} />
                  <Block title={copy.dispute} body={reply.chinese.disputeRisk} />
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <h3 className="font-medium text-[#003087]">English reply</h3>
                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" onClick={() => void copyReply()}>
                        {copied ? copy.copied : copy.copy}
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap text-sm text-slate-800">{reply.englishReply}</pre>
                  </div>
                  {reply.timeline?.length ? (
                    <div>
                      <h3 className="font-medium text-[#003087]">{copy.timeline}</h3>
                      <p className="text-xs text-slate-500">{reply.timelineNote}</p>
                      <ul className="mt-1 space-y-1">
                        {reply.timeline.map((event) => (
                          <li key={`${event.date}-${event.label}`} className="text-xs text-slate-700">
                            {event.date} · {event.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-slate-400"> </p>
              )}
            </div>
          </div>
        </section>
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-400">{copy.footer}</footer>
    </div>
  );
}

function Stat({
  label,
  numeric,
  decimals,
  format,
  hint,
  testId,
  delta,
  deltaTestId,
  animate = false,
  flash = false,
}: {
  label: string;
  numeric: number;
  decimals: number;
  format: (value: number) => string;
  hint?: string;
  testId?: string;
  delta?: string;
  deltaTestId?: string;
  animate?: boolean;
  flash?: boolean;
}) {
  const count = useCount(numeric, animate);
  const settled = !animate || count.settled;
  return (
    <article className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${flash ? "stat-flash" : ""}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[#003087]" data-testid={testId} data-settled={settled ? "true" : "false"} data-target={String(numeric)}>
        {format(count.shown)}
      </p>
      {delta ? (
        <p className="mt-1 text-xs font-semibold text-[#0070ba]" data-testid={deltaTestId}>
          {delta}
        </p>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </article>
  );
}

function DemoStep({
  index,
  label,
  active,
  done,
  disabled,
  onClick,
  testId,
}: {
  index: number;
  label: string;
  active: boolean;
  done: boolean;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-current={active ? "true" : "false"}
      data-done={done ? "true" : "false"}
      disabled={disabled}
      onClick={onClick}
      aria-current={active ? "step" : undefined}
      className={`flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
        disabled ? "cursor-not-allowed opacity-40" : "hover:bg-white/20"
      } ${active ? "bg-white text-[#003087] shadow-lg" : "bg-white/10 text-white"}`}
    >
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm ${
          done ? "bg-emerald-400 text-emerald-950" : active ? "bg-[#003087] text-white" : "bg-white/20 text-white"
        }`}
        data-testid={`${testId}-mark`}
      >
        {done ? "✓" : index}
      </span>
      <span>
        {index}. {label}
      </span>
    </button>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-medium text-[#003087]">{title}</h3>
      <p className="text-slate-800">{body}</p>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
