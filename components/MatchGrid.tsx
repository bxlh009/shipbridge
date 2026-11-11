"use client";

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellClassParams,
  type ColDef,
  type ICellRendererParams,
  type RowSelectionOptions,
} from "ag-grid-community";
import type { Copy } from "@/lib/i18n";
import { countryMismatch, postcodeMismatch } from "@/lib/matcher";
import type { GridRow, Order } from "@/lib/types";

ModuleRegistry.registerModules([AllCommunityModule]);

const FONT = 'Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif';

const theme = themeQuartz.withParams({
  spacing: 4,
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  dataFontSize: 13,
  fontFamily: FONT,
  headerBackgroundColor: "#F9FAFB",
  headerTextColor: "#4B5563",
  foregroundColor: "#111827",
  backgroundColor: "#FFFFFF",
  oddRowBackgroundColor: "#FFFFFF",
  accentColor: "#0070E0",
  borderColor: "#E5E7EB",
  rowHoverColor: "#F9FAFB",
  selectedRowBackgroundColor: "#F3F8FE",
  browserColorScheme: "light",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  borderRadius: 0,
  rowHeight: 36,
  headerHeight: 34,
  iconSize: 14,
  cellHorizontalPaddingScale: 0.55,
  rowVerticalPaddingScale: 0.65,
});

const RISK_BG = { backgroundColor: "#FEF2F2" };

type GridContext = {
  orders: Order[];
  copy: Copy;
  matched: boolean;
  onOverride: (rowId: string, orderId: string) => void;
  onReply: (row: GridRow) => void;
};

function orderFor(row: GridRow | undefined, orders: Order[]): Order | undefined {
  if (!row?.matchedOrderId) return undefined;
  return orders.find((item) => item.id === row.matchedOrderId);
}

function mismatchTitle(row: GridRow, order: Order | undefined, copy: Copy): string {
  if (!order) return row.addressWarning || "";
  if (postcodeMismatch(row.postcode, order.postalCode)) {
    return copy.mismatchPost.replace("{a}", row.postcode || "—").replace("{b}", order.postalCode || "—");
  }
  if (countryMismatch(row.country, order.country)) {
    return copy.mismatchCountry.replace("{a}", row.country || "—").replace("{b}", order.country || "—");
  }
  return row.addressWarning || "";
}

function riskCellStyle(params: CellClassParams<GridRow, unknown>) {
  const ctx = params.context as GridContext;
  const row = params.data;
  const order = orderFor(row, ctx?.orders || []);
  if (!row || !order || !row.addressRisk) return undefined;
  const field = params.colDef.field;
  if (field === "postcode" && postcodeMismatch(row.postcode, order.postalCode)) return RISK_BG;
  if (field === "country" && countryMismatch(row.country, order.country)) return RISK_BG;
  if (!field && row.addressRisk) return RISK_BG;
  return undefined;
}

function Pill({ tone, title, children }: { tone: "green" | "gray" | "red" | "amber" | "outline"; title?: string; children: string }) {
  const tones = {
    green: "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]",
    gray: "border-[#E5E7EB] bg-[#F3F4F6] text-[#374151]",
    red: "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]",
    amber: "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]",
    outline: "border-[#D1D5DB] bg-white text-[#6B7280]",
  };
  return (
    <span title={title} className={`inline-flex max-w-full items-center truncate rounded-[4px] border px-1.5 py-px text-[11px] font-medium leading-[18px] ${tones[tone]}`}>
      {children}
    </span>
  );
}

function ConfidenceCell(props: ICellRendererParams<GridRow, number, GridContext>) {
  const value = Number(props.value) || 0;
  const tone = value >= 80 ? "#067647" : value >= 50 ? "#B45309" : "#9CA3AF";
  return (
    <span title={(props.data?.reasons || []).join("\n")} className="flex w-full items-center gap-1.5">
      <span className="w-7 shrink-0 text-right text-[13px] tabular-nums text-[#111827]">{value}</span>
      <span className="h-[3px] min-w-0 flex-1 bg-[#E5E7EB]">
        <span className="block h-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }} />
      </span>
    </span>
  );
}

function AddressCell(props: ICellRendererParams<GridRow, unknown, GridContext>) {
  const row = props.data;
  const copy = props.context.copy;
  if (!row?.matchedOrderId) return <span className="text-[12px] text-[#9CA3AF]">—</span>;
  const order = orderFor(row, props.context.orders);
  if (row.addressRisk) {
    const title = mismatchTitle(row, order, copy);
    return (
      <span title={title} data-mismatch="address" className="text-[12px] font-medium text-[#B91C1C]">
        {copy.addressBad}
      </span>
    );
  }
  return <span className="text-[12px] text-[#4B5563]">{copy.addressOk}</span>;
}

function PostcodeCell(props: ICellRendererParams<GridRow, string, GridContext>) {
  const row = props.data;
  const order = orderFor(row, props.context.orders);
  const mismatch = Boolean(row && order && postcodeMismatch(row.postcode, order.postalCode));
  const title = row && mismatch ? mismatchTitle(row, order, props.context.copy) : undefined;
  return (
    <span title={title} data-mismatch={mismatch ? "postcode" : undefined} className="tabular-nums">
      {props.value || "—"}
    </span>
  );
}

function orderLabel(order: Order) {
  if (order.id.length <= 12) return order.id;
  return order.invoiceId || order.id;
}

function OrderCell(props: ICellRendererParams<GridRow, string, GridContext>) {
  const id = props.value || "";
  if (!id) return <span className="text-[#9CA3AF]">—</span>;
  const order = (props.context.orders || []).find((item) => item.id === id);
  const label = order ? orderLabel(order) : id;
  const title = order && label !== order.id ? `${order.invoiceId} · ${order.id}` : id;
  return (
    <span title={title} className="tabular-nums">
      {label}
    </span>
  );
}

function CountryCell(props: ICellRendererParams<GridRow, string, GridContext>) {
  const row = props.data;
  const order = orderFor(row, props.context.orders);
  const mismatch = Boolean(row && order && countryMismatch(row.country, order.country));
  const title = row && mismatch ? props.context.copy.mismatchCountry.replace("{a}", row.country || "—").replace("{b}", order?.country || "—") : undefined;
  return (
    <span title={title} data-mismatch={mismatch ? "country" : undefined}>
      {props.value || "—"}
    </span>
  );
}

function StatusCell(props: ICellRendererParams<GridRow, unknown, GridContext>) {
  const row = props.data;
  const copy = props.context.copy;
  if (!row) return null;
  if (row.syncStatus === "verified") return <Pill tone="green">{copy.statusVerified}</Pill>;
  if (row.syncStatus === "failed") return <Pill tone="red" title={row.syncMessage}>{copy.statusFailed}</Pill>;
  if (row.syncStatus === "unverified") return <Pill tone="amber" title={row.syncMessage}>{copy.statusUnverified}</Pill>;
  if (row.syncStatus === "skipped" && !row.matchedOrderId) return <Pill tone="outline" title={row.syncMessage}>{copy.statusNoMatch}</Pill>;
  if (row.syncStatus === "skipped" && row.addressRisk) return <Pill tone="red" title={row.syncMessage || row.addressWarning}>{copy.statusSkippedRisk}</Pill>;
  if (row.syncStatus === "skipped") return <Pill tone="amber" title={row.syncMessage}>{copy.statusSkipped}</Pill>;
  if (row.matchedOrderId && row.addressRisk) return <Pill tone="red" title={row.addressWarning}>{copy.statusRisk}</Pill>;
  if (row.matchedOrderId) return <Pill tone="gray">{copy.statusReady}</Pill>;
  if (props.context.matched) return <Pill tone="outline">{copy.statusNoMatch}</Pill>;
  return <span className="text-[12px] text-[#9CA3AF]">—</span>;
}

function OverrideCell(props: ICellRendererParams<GridRow, unknown, GridContext>) {
  const orders = props.context.orders;
  return (
    <select
      aria-label="Override match"
      className="h-7 w-full max-w-full rounded-[4px] border border-[#E5E7EB] bg-white px-1 text-[12px]"
      value={props.data?.matchedOrderId || ""}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => props.context.onOverride(props.data?.id || "", event.target.value)}
    >
      <option value="">{props.context.copy.noMatch}</option>
      {orders.map((order) => (
        <option key={order.id} value={order.id} title={`${order.invoiceId || order.id} · ${order.id} · ${order.buyerName}`}>
          {orderLabel(order)}
        </option>
      ))}
    </select>
  );
}

function ReplyCell(props: ICellRendererParams<GridRow, unknown, GridContext>) {
  if (!props.data) return null;
  return (
    <button
      type="button"
      title={props.context.copy.reply}
      className="whitespace-nowrap text-[12px] font-medium text-[#0070E0] hover:underline"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (props.data) props.context.onReply(props.data);
      }}
    >
      {props.context.copy.reply}
    </button>
  );
}

const rowSelection: RowSelectionOptions = {
  mode: "multiRow",
  checkboxes: true,
  headerCheckbox: true,
  enableClickSelection: false,
};

export default function MatchGrid({
  rows,
  orders,
  copy,
  matched,
  onOverride,
  onReply,
  onSelection,
}: {
  rows: GridRow[];
  orders: Order[];
  copy: Copy;
  matched: boolean;
  onOverride: (rowId: string, orderId: string) => void;
  onReply: (row: GridRow) => void;
  onSelection: (ids: string[]) => void;
}) {
  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      { field: "trackingNumber", headerName: copy.colTracking, width: 140, minWidth: 140, maxWidth: 150, suppressSizeToFit: true, suppressAutoSize: true },
      { field: "carrier", headerName: copy.colCarrier, width: 88, minWidth: 88 },
      { field: "recipientName", headerName: copy.colRecipient, minWidth: 112, flex: 1 },
      {
        field: "postcode",
        headerName: copy.colPostcode,
        width: 82,
        minWidth: 82,
        suppressSizeToFit: true,
        cellRenderer: PostcodeCell,
        cellStyle: riskCellStyle,
      },
      { field: "buyerName", headerName: copy.colBuyer, minWidth: 112, flex: 1 },
      { field: "matchedOrderId", headerName: copy.colOrder, width: 84, minWidth: 84, cellRenderer: OrderCell },
      { field: "confidence", headerName: copy.colConfidence, width: 88, minWidth: 88, cellRenderer: ConfidenceCell },
      { headerName: copy.colSync, width: 140, minWidth: 140, suppressSizeToFit: true, cellRenderer: StatusCell },
      { headerName: copy.colAddress, width: 78, minWidth: 78, cellRenderer: AddressCell, cellStyle: riskCellStyle },
      { field: "country", headerName: copy.colCountry, width: 68, minWidth: 68, cellRenderer: CountryCell, cellStyle: riskCellStyle },
      { headerName: copy.colOverride, width: 104, minWidth: 104, suppressSizeToFit: true, cellRenderer: OverrideCell, sortable: false },
      {
        headerName: "",
        width: 104,
        minWidth: 104,
        maxWidth: 104,
        pinned: "right",
        suppressSizeToFit: true,
        cellRenderer: ReplyCell,
        sortable: false,
        resizable: false,
      },
    ],
    [copy],
  );

  const context = useMemo<GridContext>(() => ({ orders, copy, matched, onOverride, onReply }), [orders, copy, matched, onOverride, onReply]);

  return (
    <div className="h-full w-full" data-testid="match-grid">
      <AgGridReact<GridRow>
        theme={theme}
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(params) => params.data.id}
        rowSelection={rowSelection}
        selectionColumnDef={{ width: 36, minWidth: 36, maxWidth: 36, pinned: "left", suppressSizeToFit: true }}
        context={context}
        rowClassRules={{ "sb-risk": (params) => Boolean(params.data?.addressRisk && params.data?.matchedOrderId) }}
        onSelectionChanged={(event) => onSelection(event.api.getSelectedRows().map((row) => row.id))}
        defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true }}
        animateRows={false}
        tooltipShowDelay={200}
      />
    </div>
  );
}
