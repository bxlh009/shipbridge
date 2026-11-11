"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, GitCompare, Package, Receipt, Search, Send, Settings, ShieldAlert, Upload, X } from "lucide-react";
import { countryMismatch, postcodeMismatch } from "@/lib/matcher";
import { mapCarrier } from "@/lib/carriers";
import { dictionaries, type Locale } from "@/lib/i18n";
import { sampleBuyerEmail } from "@/lib/buyer";
import { SELLER_PROTECTION_WARNING, type GridRow, type HoldStats, type ManifestRow, type Order } from "@/lib/types";
import Logo from "@/components/Logo";
import ParcelLoader from "@/components/ParcelLoader";
import Waybill from "@/components/Waybill";

const MatchGrid = dynamic(() => import("@/components/MatchGrid"), { ssr: false });

type Health = { paypal: string; ai: string | null; model: string | null };
type Reply = {
  source: "template" | "llm";
  detectedOrderId: string | null;
  buyerName?: string | null;
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
  disputesFrom: number;
  disputesTo: number;
  currency: string;
};
type Toast = { id: number; kind: "ok" | "err"; text: string };
type View = "shipments" | "orders" | "disputes" | "settings";

const MOCK_KEY = "shipbridge-mock-orders";
const AUTO_CONFIDENCE = 70;

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
    const duration = 700;
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

function pushableCount(rows: GridRow[], selected: string[]) {
  if (selected.length) return selected.length;
  return rows.filter((row) => row.matchedOrderId && !row.addressRisk && row.confidence >= AUTO_CONFIDENCE).length;
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
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState("");
  const [orderId, setOrderId] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [copied, setCopied] = useState(false);
  const [agentText, setAgentText] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [motion, setMotion] = useState(false);
  const [flash, setFlash] = useState(false);
  const [view, setView] = useState<View>("shipments");
  const [drawer, setDrawer] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState("");
  const [shake, setShake] = useState(false);
  const [pushProgress, setPushProgress] = useState<{ done: number; total: number } | null>(null);
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const toastSeq = useRef(0);
  const flashTimer = useRef(0);

  const riskCount = rows.filter((row) => row.addressRisk && row.matchedOrderId).length;
  const loaded = rows.length > 0;
  const phase = !loaded ? 1 : !matched ? 2 : !synced ? 3 : 4;
  const idle = busy === "";
  const pushCount = pushableCount(rows, selected);

  function pushToast(kind: Toast["kind"], text: string) {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts([{ id, kind, text }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 12000);
  }

  function rememberOrders(next: Order[], paypalMode: string) {
    setOrders(next);
    if (paypalMode === "mock") writeMockOrders(next);
  }

  function revealStats(next: HoldStats) {
    const prev = statsRef.current;
    if (
      prev.totalOrders > 0 &&
      (prev.onHoldCount !== next.onHoldCount || prev.releasingAmount !== next.releasingAmount || prev.syncedCount !== next.syncedCount)
    ) {
      setImpact({
        onHoldFrom: prev.onHoldCount,
        onHoldTo: next.onHoldCount,
        releasingFrom: prev.releasingAmount,
        releasingTo: next.releasingAmount,
        disputesFrom: prev.syncedCount,
        disputesTo: next.syncedCount,
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
      } catch (err) {
        pushToast("err", err instanceof Error ? err.message : "Could not load PayPal orders");
      }
    })();
    // Mount only. pushToast is stable enough for the error path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.body.classList.toggle("locale-zh", locale === "zh");
  }, [locale]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(false), 1200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  function chooseLocale(next: Locale) {
    setLocale(next);
    window.localStorage.setItem("shipbridge-locale", next);
    setToasts([]);
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
    setQuery("");
    setMatched(false);
    setSynced(false);
    setReply(null);
    pushToast("ok", `${manifest.length} ${copy.loaded}`);
  }

  async function loadSample(sample: string) {
    setBusy("parse");
    setView("shipments");
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
      pushToast("err", err instanceof Error ? err.message : "Parse failed");
    } finally {
      setBusy("");
    }
  }

  async function onFile(file: File) {
    setBusy("parse");
    setView("shipments");
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
      if (!body.ok) throw new Error(body.message || "Parse failed");
      takeManifest(body.rows);
    } catch (err) {
      pushToast("err", err instanceof Error ? err.message : "Parse failed");
    } finally {
      setBusy("");
    }
  }

  async function match() {
    setBusy("match");
    try {
      const response = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, orders }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.message || "Match failed");
      const next = body.rows as GridRow[];
      setSelected([]);
      setRows(next);
      setMatched(true);
      setSynced(false);
      const matchedN = next.filter((row) => row.matchedOrderId).length;
      const riskN = next.filter((row) => row.addressRisk && row.matchedOrderId).length;
      const riskPart = riskN ? ` · ${riskN} ${copy.toastMatchedRisk}` : "";
      pushToast("ok", `${matchedN} ${copy.matchedToast}${riskPart}`);
    } catch (err) {
      pushToast("err", err instanceof Error ? err.message : "Match failed");
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

  function acceptSync(body: { rows?: GridRow[]; orders?: Order[]; stats?: HoldStats; paypal?: string }) {
    if (Array.isArray(body.rows)) {
      setRows(body.rows);
      const ids = body.rows.filter((row) => row.syncStatus === "verified").map((row) => row.id);
      setFlashIds(ids);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlashIds([]), 800);
    }
    if (Array.isArray(body.orders)) rememberOrders(body.orders, body.paypal || health.paypal);
    if (body.stats) revealStats(body.stats);
    setSynced(true);
  }

  function syncMessage(next: GridRow[]) {
    const verified = next.filter((row) => row.syncStatus === "verified").length;
    const skippedRisk = next.filter((row) => row.syncStatus === "skipped" && row.addressRisk).length;
    const failed = next.filter((row) => row.syncStatus === "failed").length;
    const verifiedPart = `${verified} ${verified === 1 ? copy.toastVerifiedOne : copy.toastVerifiedMany}`;
    const skipPart = skippedRisk ? ` · ${skippedRisk} ${copy.toastSkipped}` : "";
    const failPart = failed ? ` · ${failed} ${copy.statusFailed.toLowerCase()}` : "";
    return `${verifiedPart}${skipPart}${failPart}`;
  }

  async function sync() {
    const total = Math.max(pushableCount(rows, selected), 1);
    setBusy("sync");
    setPushProgress({ done: 1, total });
    const timer = window.setInterval(() => {
      setPushProgress((prev) => {
        if (!prev) return prev;
        const cap = Math.max(prev.total - 1, 1);
        if (prev.done >= cap) return prev;
        return { done: prev.done + 1, total: prev.total };
      });
    }, 200);
    try {
      const payload = rows.map((row) => ({ ...row, selected: selected.includes(row.id) }));
      setSelected([]);
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload, orders }),
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.message || "Sync failed");
      acceptSync(body);
      const next = (body.rows || []) as GridRow[];
      const failed = next.filter((row) => row.syncStatus === "failed").length;
      pushToast(failed && !next.some((row) => row.syncStatus === "verified") ? "err" : "ok", syncMessage(next));
    } catch (err) {
      pushToast("err", err instanceof Error ? err.message : "Sync failed");
    } finally {
      window.clearInterval(timer);
      setPushProgress(null);
      setBusy("");
    }
  }

  async function agent() {
    setBusy("agent");
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
      if (Array.isArray(body.rows) && body.rows.length && body.rows[0].syncStatus) {
        acceptSync(body);
        pushToast("ok", syncMessage(body.rows));
      } else {
        pushToast("ok", copy.agentDone);
      }
    } catch (err) {
      pushToast("err", err instanceof Error ? err.message : "Agent failed");
    } finally {
      setBusy("");
    }
  }

  async function reset() {
    setBusy("reset");
    clearMockOrders();
    setRows([]);
    setSelected([]);
    setQuery("");
    setMatched(false);
    setSynced(false);
    setReply(null);
    setAgentText("");
    setImpact(null);
    setMotion(false);
    setFlash(false);
    setFlashIds([]);
    setDrawer(false);
    setToasts([]);
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

  function openReply(row?: GridRow) {
    if (row?.matchedOrderId) setOrderId(row.matchedOrderId);
    setDrawer(true);
    setCopied(false);
  }

  async function draft() {
    setBusy("reply");
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
      if (body.detectedOrderId) setOrderId(body.detectedOrderId);
    } catch (err) {
      pushToast("err", err instanceof Error ? err.message : "Draft failed");
    } finally {
      setBusy("");
    }
  }

  async function copyReply() {
    if (!reply) return;
    await navigator.clipboard.writeText(reply.englishReply);
    setCopied(true);
  }

  function runPrimary() {
    if (!loaded) void loadSample("all");
    else if (!matched) void match();
    else void sync();
  }

  const aiLabel = useMemo(() => (health.ai && health.ai !== "off" ? `${copy.aiOn} · ${health.model}` : copy.aiOff), [health, copy.aiOff, copy.aiOn]);
  const env = health.paypal === "sandbox" ? "sandbox" : health.paypal === "live" ? "live" : "mock";
  const envLabel = env === "sandbox" ? copy.envSandbox : env === "live" ? copy.envLive : copy.envMock;
  const coverage = stats.totalOrders ? (stats.syncedCount / stats.totalOrders) * 100 : 0;
  const coverageFrom = impact && stats.totalOrders ? (impact.disputesFrom / stats.totalOrders) * 100 : 0;
  const coverageTo = impact && stats.totalOrders ? (impact.disputesTo / stats.totalOrders) * 100 : 0;
  const onHoldDelta = impact && impact.onHoldFrom !== impact.onHoldTo ? `${impact.onHoldFrom} → ${impact.onHoldTo}` : undefined;
  const releasingDelta = impact && impact.releasingFrom !== impact.releasingTo ? `${money(impact.releasingFrom, impact.currency)} → ${money(impact.releasingTo, impact.currency)}` : undefined;
  const disputesDelta = impact && impact.disputesFrom !== impact.disputesTo ? `${impact.disputesFrom} → ${impact.disputesTo}` : undefined;
  const coverageDelta = impact && impact.disputesFrom !== impact.disputesTo ? `${Math.round(coverageFrom)}% → ${Math.round(coverageTo)}%` : undefined;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const order = orders.find((item) => item.id === row.matchedOrderId);
      const hay = [row.trackingNumber, row.recipientName, row.buyerName, row.matchedOrderId, order?.invoiceId, order?.id].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [orders, query, rows]);

  useEffect(() => {
    if (!query.trim() || !rows.length || filtered.length > 0) return;
    setShake(true);
    const timer = window.setTimeout(() => setShake(false), 320);
    return () => window.clearTimeout(timer);
  }, [filtered.length, query, rows.length]);

  const pushingLabel = pushProgress ? copy.pushing.replace("{done}", String(pushProgress.done)).replace("{total}", String(pushProgress.total)) : copy.syncing;
  const primaryLabel = busy === "match" ? copy.matching : busy === "sync" ? pushingLabel : !loaded ? copy.primaryLoad : !matched ? copy.primaryMatch : `${copy.primarySync} (${pushCount})`;

  const headerOrder = orders.find((order) => order.id === (reply?.detectedOrderId || orderId)) || null;
  const headerRow = rows.find((row) => row.matchedOrderId && row.matchedOrderId === headerOrder?.id);
  const headerTracking = reply?.trackingNumber || headerOrder?.tracking?.[0]?.trackingNumber || headerRow?.trackingNumber || "–";
  const headerCarrier = reply?.carrier || headerOrder?.tracking?.[0]?.carrier || headerRow?.carrier || headerOrder?.plannedCarrier || "–";

  const primaryIcon = busy === "sync" ? null : !loaded ? null : !matched ? <GitCompare size={16} strokeWidth={1.75} className="sb-icon" /> : <Send size={16} strokeWidth={1.75} className="sb-icon" />;

  return (
    <div className="flex h-screen overflow-hidden bg-sb-bg text-sb-ink">
      <aside className="flex w-[172px] shrink-0 flex-col border-r border-sb-line bg-sb-surface">
        <div className="flex h-12 items-center px-3">
          <Logo size={22} />
        </div>
        <nav className="flex flex-col gap-1 p-2" aria-label="Primary">
          <NavItem icon={<Package size={16} strokeWidth={1.75} />} label={copy.navShipments} active={view === "shipments"} onClick={() => setView("shipments")} />
          <NavItem icon={<Receipt size={16} strokeWidth={1.75} />} label={copy.navOrders} soon={copy.soon} active={view === "orders"} onClick={() => setView("orders")} />
          <NavItem icon={<ShieldAlert size={16} strokeWidth={1.75} />} label={copy.navDisputes} aside={copy.navRisk} active={view === "disputes"} onClick={() => setView("disputes")} />
          <NavItem icon={<Settings size={16} strokeWidth={1.75} />} label={copy.navSettings} soon={copy.soon} active={view === "settings"} onClick={() => setView("settings")} />
        </nav>
        <p className="mt-auto px-3 py-4 text-[12px] text-sb-muted">{copy.sampleFoot}</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-sb-line bg-sb-surface px-4">
          <p className="truncate text-[13px] text-sb-secondary">{copy.merchant}</p>
          <div className="flex shrink-0 items-center gap-3">
            <span
              data-testid="paypal-chip"
              className={`sb-env ${
                env === "sandbox" ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#0070E0]" : env === "live" ? "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]" : "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]"
              }`}
            >
              {envLabel}
            </span>
            <span data-testid="ai-chip" className="text-[12px] text-sb-muted">
              {aiLabel}
            </span>
            <div className="sb-lang" data-locale={locale} role="group" aria-label="Language">
              <span className="sb-lang-thumb" aria-hidden />
              <button type="button" data-testid="lang-en" aria-pressed={locale === "en"} onClick={() => chooseLocale("en")}>
                EN
              </button>
              <button type="button" data-testid="lang-zh" aria-pressed={locale === "zh"} onClick={() => chooseLocale("zh")}>
                中文
              </button>
            </div>
          </div>
        </header>

        {view === "shipments" ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <div data-testid="hero">
              <div className={`flex items-start justify-between gap-4 ${toasts.length ? "pr-[336px]" : ""}`}>
                <div className="min-w-0">
                  <h1 className="text-[20px] font-semibold leading-7 tracking-tight">{copy.pageTitle}</h1>
                  <p data-testid="hero-pitch" className="mt-1 max-w-3xl text-[14px] leading-5 text-sb-muted">
                    {copy.subtitle}
                  </p>
                </div>
                <span title={copy.simulatedTip} className="sb-chip mt-1 shrink-0 cursor-help border-sb-line bg-sb-surface text-[12px] text-sb-muted">
                  {copy.simulated}
                </span>
              </div>

              <section className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="impact-stats">
                <Stat
                  label={copy.onHold}
                  numeric={stats.onHoldCount}
                  decimals={0}
                  format={(value) => String(Math.round(value))}
                  testId="stat-on-hold"
                  delta={onHoldDelta}
                  deltaTestId="delta-on-hold"
                  foot={stats.totalOrders ? `${money(stats.onHoldAmount, stats.currency)} ${copy.heldAmount}` : "–"}
                  footTestId="stat-amount"
                  animate={motion}
                  flash={flash && Boolean(onHoldDelta)}
                />
                <Stat
                  label={copy.releasing}
                  numeric={stats.releasingAmount}
                  decimals={2}
                  format={(value) => money(value, stats.currency)}
                  testId="stat-releasing"
                  delta={releasingDelta}
                  deltaTestId="delta-releasing"
                  foot={stats.syncedCount ? `${stats.estimatedDaysReleasedEarlier.toFixed(1)} ${copy.daysShort}` : copy.releasingHint}
                  footTestId="stat-days"
                  animate={motion}
                  flash={flash && Boolean(releasingDelta)}
                />
                <Stat
                  label={copy.disputes}
                  tag={copy.disputesTag}
                  numeric={stats.syncedCount}
                  decimals={0}
                  format={(value) => String(Math.round(value))}
                  testId="stat-disputes"
                  delta={disputesDelta}
                  foot={copy.disputesFoot}
                  animate={motion}
                  flash={flash && Boolean(disputesDelta)}
                />
                <Stat
                  label={copy.coverage}
                  numeric={coverage}
                  decimals={0}
                  format={(value) => `${Math.round(value)}%`}
                  testId="stat-coverage"
                  delta={coverageDelta}
                  foot={
                    <span>
                      <span data-testid="stat-synced" data-settled="true">
                        {stats.syncedCount}
                      </span>
                      {" / "}
                      <span data-testid="stat-orders" data-settled="true">
                        {stats.totalOrders}
                      </span>{" "}
                      {copy.coverageFoot}
                    </span>
                  }
                  animate={motion}
                  flash={flash && Boolean(coverageDelta)}
                  bar
                />
              </section>
            </div>

            <section
              className={`sb-panel mt-4 flex min-h-0 flex-1 flex-col ${dragOver ? "border-sb-accent" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                const file = event.dataTransfer.files?.[0];
                if (file) void onFile(file);
              }}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                <div data-testid="demo-steps" className="flex min-w-0 flex-wrap items-center gap-1">
                  <DemoStep index={1} label={copy.stepLoad} active={phase === 1} done={loaded} disabled={!idle} onClick={() => void loadSample("all")} testId="step-load" />
                  <DemoStep index={2} label={copy.stepMatch} active={phase === 2} done={matched} disabled={!loaded || !idle} onClick={() => void match()} testId="step-match" />
                  <DemoStep index={3} label={copy.stepSync} active={phase === 3} done={synced} disabled={!matched || !idle} onClick={() => void sync()} testId="step-sync" />
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <label className="sb-btn cursor-pointer">
                    <Upload size={16} strokeWidth={1.75} className="sb-icon" />
                    {copy.uploadFile}
                    <input
                      data-testid="upload-file"
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
                  <select
                    aria-label={copy.sample}
                    data-testid="sample-picker"
                    className="sb-select"
                    value=""
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value) void loadSample(value);
                    }}
                  >
                    <option value="">{copy.sample}</option>
                    <option value="yunexpress">{copy.yun}</option>
                    <option value="4px">{copy.fourpx}</option>
                    <option value="yanwen">{copy.yanwen}</option>
                  </select>
                  <button type="button" disabled={!rows.length || busy === "agent"} className="sb-btn disabled:opacity-40" onClick={() => void agent()}>
                    {copy.agent}
                  </button>
                  <button type="button" data-testid="reset-demo" className="sb-btn-text" onClick={() => void reset()}>
                    {copy.reset}
                  </button>
                  <button type="button" data-testid="buyer-message" className="sb-btn" onClick={() => openReply()}>
                    {copy.buyer}
                  </button>
                  <button
                    type="button"
                    data-testid="primary-action"
                    disabled={!idle}
                    aria-busy={busy === "sync"}
                    className={`${loaded ? "sb-btn-primary" : "sb-btn"} ${busy === "sync" ? "is-busy" : ""}`}
                    onClick={runPrimary}
                  >
                    {primaryIcon}
                    {primaryLabel}
                  </button>
                </div>
              </div>

              {rows.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3 px-3 pb-2">
                  <label className={`sb-search ${shake ? "is-shake" : ""}`}>
                    <Search size={16} strokeWidth={1.75} className="sb-icon" aria-hidden />
                    <input data-testid="grid-search" value={query} placeholder={copy.searchPlaceholder} aria-label={copy.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} />
                  </label>
                  {query.trim() && filtered.length === 0 ? <span className="sb-search-miss">{copy.searchEmpty}</span> : null}
                </div>
              ) : null}

              {riskCount > 0 ? (
                <p className="bg-[#FEF2F2] px-3 py-2 text-[12px] leading-5 text-[#991B1B]" data-testid="risk-note">
                  {riskCount} {copy.riskNote}
                </p>
              ) : null}

              {agentText ? (
                <details className="px-3 py-2 text-[12px] text-sb-secondary">
                  <summary className="cursor-pointer">{copy.agentResult}</summary>
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[12px] leading-5">{agentText}</pre>
                </details>
              ) : null}

              <div className="relative min-h-0 flex-1 border-t border-sb-line">
                {busy === "parse" || busy === "match" || busy === "sync" ? (
                  <div className="absolute inset-0">
                    <Skeleton label={busy === "match" ? copy.matching : copy.loading} />
                    {busy === "match" ? (
                      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2">
                        <ParcelLoader label={copy.matching} />
                      </div>
                    ) : null}
                  </div>
                ) : rows.length === 0 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center" data-testid="empty-state">
                    <WaybillArt />
                    <h2 className="mt-4 text-[16px] font-semibold">{copy.emptyTitle}</h2>
                    <p className="mt-2 max-w-md text-[14px] leading-6 text-sb-muted">{copy.emptyBody}</p>
                    <button type="button" data-testid="use-sample" className="sb-btn-primary mt-4" onClick={() => void loadSample("all")}>
                      {copy.primaryLoad}
                    </button>
                    <p className="mt-2 text-[12px] text-sb-muted">{copy.dropHint}</p>
                  </div>
                ) : query.trim() && filtered.length === 0 ? (
                  <div className="sb-filter-empty">{copy.searchEmpty}</div>
                ) : (
                  <div className="absolute inset-0">
                    <MatchGrid rows={filtered} orders={orders} copy={copy} matched={matched} flashIds={flashIds} onOverride={override} onReply={openReply} onSelection={setSelected} />
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <Placeholder
            title={view === "orders" ? copy.navOrders : view === "disputes" ? copy.navDisputes : copy.navSettings}
            body={view === "orders" ? copy.placeholderOrders : view === "disputes" ? copy.placeholderDisputes : copy.placeholderSettings}
            note={copy.placeholderBody}
          />
        )}
      </div>

      {drawer ? (
        <div className="fixed inset-0 z-40">
          <button type="button" className="absolute inset-0 bg-[#122033]/20" aria-label={copy.close} onClick={() => setDrawer(false)} />
          <aside data-testid="buyer-drawer" role="dialog" aria-modal="true" aria-label={copy.buyer} className="sb-drawer absolute top-0 right-0 flex h-full w-[480px] max-w-full flex-col border-l border-sb-line bg-sb-surface">
            <div className="flex h-12 shrink-0 items-center justify-between px-4">
              <h2 className="text-[16px] font-semibold">{copy.buyer}</h2>
              <button type="button" data-testid="drawer-close" className="sb-btn-text h-8 w-8 p-0 text-sb-secondary" onClick={() => setDrawer(false)} aria-label={copy.close}>
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 pb-4" data-testid="drawer-body">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                <Field label={copy.colBuyer} value={headerOrder?.buyerName || reply?.buyerName || copy.noOrder} />
                <Field label={copy.colOrder} value={headerOrder ? orderRef(headerOrder) : reply?.detectedOrderId || "–"} waybill={Boolean(headerOrder || reply?.detectedOrderId)} copyValue={headerOrder?.id || reply?.detectedOrderId || undefined} copiedLabel={copy.copied} />
                <Field label={copy.colTracking} value={headerTracking} waybill={headerTracking !== "–" && headerTracking !== "—"} copiedLabel={copy.copied} />
                <Field label={copy.colCarrier} value={headerCarrier} />
              </dl>

              <label className="mt-4 block text-[12px] font-medium text-sb-secondary" htmlFor="buyer-email">
                {copy.emailLabel}
              </label>
              <textarea
                id="buyer-email"
                data-testid="buyer-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Where is my order?"
                className="mt-1 h-[64px] w-full resize-y rounded-[4px] border border-sb-line p-2 text-[13px] leading-5"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select className="sb-select max-w-[220px]" value={orderId} onChange={(event) => setOrderId(event.target.value)} aria-label={copy.colOrder}>
                  <option value="">{copy.auto}</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {orderRef(order)} · {order.buyerName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => {
                    setEmail(sampleBuyerEmail());
                    setOrderId("");
                    setReply(null);
                  }}
                >
                  {copy.sampleEmail}
                </button>
                <button type="button" data-testid="draft-reply" className="sb-btn-primary" disabled={busy === "reply"} onClick={() => void draft()}>
                  {busy === "reply" ? copy.drafting : copy.draft}
                </button>
              </div>

              <div data-testid="reply-output" className="mt-4">
                {reply ? (
                  <div className="space-y-4">
                    <section>
                      <h3 className="text-[14px] font-semibold text-sb-ink">{copy.chineseSection}</h3>
                      <p className="mt-1 text-[12px] text-sb-muted">{reply.source === "llm" ? copy.draftSourceModel : copy.draftSourceRules}</p>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] leading-5">
                        <Block title={copy.summary} body={reply.chinese.summary} />
                        <Block title={copy.mood} body={reply.chinese.mood} />
                        <Block title={copy.ask} body={reply.chinese.ask} />
                        <Block title={copy.dispute} body={reply.chinese.disputeRisk} />
                      </div>
                    </section>
                    <section>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[14px] font-semibold text-sb-ink">{copy.englishSection}</h3>
                        <button type="button" className="sb-btn sb-btn-sm" onClick={() => void copyReply()}>
                          {copied ? copy.copied : copy.copy}
                        </button>
                      </div>
                      <pre className="mt-2 max-h-[112px] overflow-auto whitespace-pre-wrap text-[13px] leading-5 text-sb-ink">{reply.englishReply}</pre>
                    </section>
                    {reply.timeline?.length ? (
                      <section>
                        <h3 className="text-[14px] font-semibold text-sb-ink">{copy.timeline}</h3>
                        <p className="mt-1 text-[12px] text-sb-muted">{reply.timelineNote || copy.timelineNote}</p>
                        <ol className="sb-timeline">
                          {reply.timeline.map((event) => (
                            <li key={`${event.date}-${event.label}`}>
                              <p className="text-[12px] tabular-nums text-sb-muted">{event.date}</p>
                              <p className="text-[13px] leading-5 text-sb-ink">{event.label}</p>
                            </li>
                          ))}
                        </ol>
                      </section>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[13px] text-sb-muted">{copy.drawerEmpty}</p>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="pointer-events-none fixed top-14 right-4 z-30 flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            data-testid={toast.kind === "err" ? "error-banner" : "toast"}
            role={toast.kind === "err" ? "alert" : "status"}
            className={`sb-toast pointer-events-auto flex items-start gap-2 rounded-[6px] border border-sb-line border-l-2 bg-sb-surface px-3 py-2 text-left text-[13px] leading-5 text-sb-ink ${
              toast.kind === "err" ? "border-l-[#B91C1C]" : "border-l-[#067647]"
            }`}
            onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
          >
            {toast.kind === "err" ? <AlertCircle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#B91C1C]" /> : <Check size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#067647]" />}
            <span>
              {toast.text.split(" · ").map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  tag,
  numeric,
  format,
  testId,
  delta,
  deltaTestId,
  foot,
  footTestId,
  animate = false,
  flash = false,
  bar = false,
}: {
  label: string;
  tag?: string;
  numeric: number;
  decimals: number;
  format: (value: number) => string;
  testId?: string;
  delta?: string;
  deltaTestId?: string;
  foot?: React.ReactNode;
  footTestId?: string;
  animate?: boolean;
  flash?: boolean;
  bar?: boolean;
}) {
  const count = useCount(numeric, animate);
  const settled = !animate || count.settled;
  return (
    <article className={`sb-kpi ${flash ? "stat-flash" : ""}`}>
      <p className="k-label">
        {label}
        {tag ? <span className="ml-1 font-normal text-sb-faint">{tag}</span> : null}
      </p>
      <p className="sb-kpi-value" data-testid={testId} data-settled={settled ? "true" : "false"} data-target={String(numeric)}>
        {format(count.shown)}
      </p>
      <p className="mt-1 h-4 truncate text-[12px] leading-4 text-sb-secondary tabular-nums" data-testid={deltaTestId}>
        {delta || "\u00a0"}
      </p>
      <p className="h-4 truncate text-[12px] leading-4 text-sb-muted tabular-nums" data-testid={footTestId}>
        {foot || "\u00a0"}
      </p>
      {bar ? (
        <div className="sb-coverage" aria-hidden>
          <span style={{ width: `${Math.max(0, Math.min(100, count.shown))}%` }} />
        </div>
      ) : null}
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
      className={`flex items-center gap-2 rounded-[4px] px-1 py-1 text-left text-[13px] ${disabled ? "cursor-not-allowed opacity-40" : "hover:bg-sb-hover"} ${active ? "font-medium text-sb-ink" : "text-sb-secondary"}`}
    >
      <span
        data-testid={`${testId}-mark`}
        data-state={done ? "done" : active ? "current" : "todo"}
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular-nums ${
          done ? "border-[#067647] text-[#067647]" : active ? "border-[#0070E0] bg-[#0070E0] text-white" : "border-[#C3CFDB] text-sb-muted"
        }`}
      >
        {done ? <Check size={12} strokeWidth={2.25} /> : index}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function NavItem({ icon, label, aside, soon, active, onClick }: { icon: React.ReactNode; label: string; aside?: string; soon?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 items-center gap-2 rounded-[4px] px-2 text-left text-[13px] ${active ? "bg-sb-hover font-medium text-sb-brand" : "text-sb-secondary hover:bg-sb-hover"}`}
    >
      <span className="text-current">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {aside && !soon ? <span className="text-[12px] text-sb-muted">{aside}</span> : null}
      {soon ? <span className="text-[12px] text-sb-muted">{soon}</span> : null}
    </button>
  );
}

function Placeholder({ title, body, note }: { title: string; body: string; note: string }) {
  return (
    <div className="px-4 py-6">
      <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-[14px] text-sb-muted">{body}</p>
      <p className="mt-4 text-[13px] text-sb-faint">{note}</p>
    </div>
  );
}

function orderRef(order: Pick<Order, "id" | "invoiceId">) {
  if (order.id.length <= 12) return order.id;
  return order.invoiceId || order.id;
}

function Field({ label, value, waybill, copyValue, copiedLabel }: { label: string; value: string; waybill?: boolean; copyValue?: string; copiedLabel?: string }) {
  const showChip = Boolean(waybill && copiedLabel && value && value !== "–" && value !== "—");
  return (
    <div className="min-w-0">
      <dt className="sb-field-label">{label}</dt>
      <dd className="mt-1 truncate text-[13px] font-medium text-sb-ink">
        {showChip ? <Waybill value={value} copyValue={copyValue} copiedLabel={copiedLabel || ""} /> : value}
      </dd>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h4 className="text-[12px] font-medium text-sb-muted">{title}</h4>
      <p className="text-sb-ink">{body}</p>
    </div>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="h-full" data-testid="grid-skeleton" aria-busy="true" aria-label={label}>
      <div className="flex h-8 items-center gap-3 border-b border-sb-line bg-[#F4F7FA] px-3">
        <div className="sb-skeleton-bar w-24" />
        <div className="sb-skeleton-bar w-16" />
        <div className="sb-skeleton-bar w-28" />
        <div className="sb-skeleton-bar w-20" />
      </div>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex h-10 items-center gap-3 border-b border-[#E3EAF1] px-3">
          <div className="sb-skeleton-bar w-4" />
          <div className="sb-skeleton-bar w-28" />
          <div className="sb-skeleton-bar w-16" />
          <div className="sb-skeleton-bar w-24" />
          <div className="sb-skeleton-bar w-14" />
          <div className="sb-skeleton-bar w-20" />
          <div className="sb-skeleton-bar flex-1" />
        </div>
      ))}
    </div>
  );
}

function WaybillArt() {
  return (
    <svg width="88" height="56" viewBox="0 0 88 56" fill="none" aria-hidden="true">
      <path d="M8 8h46v40H8V8z" stroke="#003087" strokeWidth="1.5" />
      <path d="M14 16h28M14 22h34M14 28h22" stroke="#5C6E84" strokeWidth="1.5" />
      <rect x="14" y="34" width="28" height="8" stroke="#0070E0" strokeWidth="1.25" strokeDasharray="2 2" />
      <path d="M58 24h18M68 19l8 5-8 5" stroke="#003087" strokeWidth="1.5" />
    </svg>
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
