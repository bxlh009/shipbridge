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
import Waybill from "@/components/Waybill";

ModuleRegistry.registerModules([AllCommunityModule]);

const FONT = 'Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif';

const theme = themeQuartz.withParams({
  spacing: 4,
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 600,
  dataFontSize: 13,
  fontFamily: FONT,
  headerBackgroundColor: "#F4F7FA",
  headerTextColor: "#3A4D63",
  foregroundColor: "#122033",
  backgroundColor: "#FFFFFF",
  oddRowBackgroundColor: "#FFFFFF",
  accentColor: "#0070E0",
  borderColor: "#E3EAF1",
  rowHoverColor: "#E8F1FA",
  selectedRowBackgroundColor: "#E7F1FB",
  checkboxCheckedBackgroundColor: "#0070E0",
  checkboxCheckedBorderColor: "#0070E0",
  checkboxCheckedShapeColor: "#FFFFFF",
  checkboxUncheckedBackgroundColor: "#FFFFFF",
  checkboxUncheckedBorderColor: "#C3CFDB",
  checkboxBorderRadius: 4,
  checkboxBorderWidth: 1,
  columnBorder: false,
  browserColorScheme: "light",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  borderRadius: 0,
  rowHeight: 40,
  headerHeight: 32,
  iconSize: 16,
  cellHorizontalPaddingScale: 0.6,
  rowVerticalPaddingScale: 0.7,
});

const RISK_BG = { backgroundColor: "#FEF2F2" };
const EMPTY = "–";

type GridContext = {
  orders: Order[];
  copy: Copy;
  matched: boolean;
  flashIds: string[];
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
    return copy.mismatchPost.replace("{a}", row.postcode || EMPTY).replace("{b}", order.postalCode || EMPTY);
  }
  if (countryMismatch(row.country, order.country)) {
    return copy.mismatchCountry.replace("{a}", row.country || EMPTY).replace("{b}", order.country || EMPTY);
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
    gray: "border-[#D5DEE8] bg-[#F4F7FA] text-[#3A4D63]",
    red: "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]",
    amber: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
    outline: "border-[#C3CFDB] bg-white text-[#4A5D73]",
  };
  return (
    <span title={title} className={`sb-chip truncate ${tones[tone]}`}>
      {children}
    </span>
  );
}

function ConfidenceCell(props: ICellRendererParams<GridRow, number, GridContext>) {
  const value = Number(props.value) || 0;
  const tone = value >= 80 ? "#067647" : value >= 50 ? "#92400E" : "#5C6E84";
  return (
    <span title={(props.data?.reasons || []).join("\n")} className="flex w-full items-center justify-end gap-2">
      <span className="h-[3px] min-w-0 flex-1 bg-[#E4EBF2]">
        <span className="ml-auto block h-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }} />
      </span>
      <span className="w-7 shrink-0 text-right text-[13px] tabular-nums text-[#122033]">{value}</span>
    </span>
  );
}

function TrackingCell(props: ICellRendererParams<GridRow, string, GridContext>) {
  const value = props.value || "";
  if (!value) return <span className="text-[#5C6E84]">{EMPTY}</span>;
  return <Waybill value={value} copiedLabel={props.context.copy.copied} />;
}

function AddressCell(props: ICellRendererParams<GridRow, unknown, GridContext>) {
  const row = props.data;
  const copy = props.context.copy;
  if (!row?.matchedOrderId) return <span className="text-[12px] text-[#5C6E84]">{EMPTY}</span>;
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
    <span title={title} data-mismatch={mismatch ? "postcode" : undefined} className="block text-right tabular-nums">
      {props.value || EMPTY}
    </span>
  );
}

function orderLabel(order: Order) {
  if (order.id.length <= 12) return order.id;
  return order.invoiceId || order.id;
}

function OrderCell(props: ICellRendererParams<GridRow, string, GridContext>) {
  const id = props.value || "";
  if (!id) return <span className="text-[#5C6E84]">{EMPTY}</span>;
  const order = (props.context.orders || []).find((item) => item.id === id);
  const label = order ? orderLabel(order) : id;
  const title = order && label !== order.id ? `${order.invoiceId} · ${order.id}` : id;
  return <Waybill value={label} copyValue={id} title={title} copiedLabel={props.context.copy.copied} />;
}

function CountryCell(props: ICellRendererParams<GridRow, string, GridContext>) {
  const row = props.data;
  const order = orderFor(row, props.context.orders);
  const mismatch = Boolean(row && order && countryMismatch(row.country, order.country));
  const title = row && mismatch ? props.context.copy.mismatchCountry.replace("{a}", row.country || EMPTY).replace("{b}", order?.country || EMPTY) : undefined;
  return (
    <span title={title} data-mismatch={mismatch ? "country" : undefined}>
      {props.value || EMPTY}
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
  return <span className="text-[12px] text-[#5C6E84]">{EMPTY}</span>;
}

function OverrideCell(props: ICellRendererParams<GridRow, unknown, GridContext>) {
  const orders = props.context.orders;
  return (
    <select
      aria-label="Override match"
      className="sb-select-sm w-full max-w-full"
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
      className="sb-btn-text sb-btn-sm sb-link whitespace-nowrap"
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
  flashIds,
  onOverride,
  onReply,
  onSelection,
}: {
  rows: GridRow[];
  orders: Order[];
  copy: Copy;
  matched: boolean;
  flashIds: string[];
  onOverride: (rowId: string, orderId: string) => void;
  onReply: (row: GridRow) => void;
  onSelection: (ids: string[]) => void;
}) {
  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      {
        field: "trackingNumber",
        headerName: copy.colTracking,
        width: 136,
        minWidth: 132,
        maxWidth: 148,
        pinned: "left",
        suppressSizeToFit: true,
        suppressAutoSize: true,
        cellRenderer: TrackingCell,
      },
      { field: "carrier", headerName: copy.colCarrier, width: 88, minWidth: 84 },
      { field: "recipientName", headerName: copy.colRecipient, minWidth: 122, flex: 1, tooltipField: "recipientName" },
      {
        field: "postcode",
        headerName: copy.colPostcode,
        width: 72,
        minWidth: 68,
        type: "rightAligned",
        suppressSizeToFit: true,
        cellRenderer: PostcodeCell,
        cellStyle: riskCellStyle,
        tooltipValueGetter: (params) => {
          const row = params.data;
          const order = orderFor(row, (params.context as GridContext)?.orders || []);
          if (row && order && postcodeMismatch(row.postcode, order.postalCode)) return mismatchTitle(row, order, (params.context as GridContext).copy);
          return row?.postcode || undefined;
        },
      },
      { field: "buyerName", headerName: copy.colBuyer, minWidth: 132, flex: 1.15, tooltipField: "buyerName" },
      { field: "matchedOrderId", headerName: copy.colOrder, width: 88, minWidth: 84, cellRenderer: OrderCell },
      { field: "confidence", headerName: copy.colConfidence, width: 84, minWidth: 80, type: "rightAligned", cellRenderer: ConfidenceCell },
      { headerName: copy.colSync, width: 132, minWidth: 124, suppressSizeToFit: true, cellRenderer: StatusCell },
      { headerName: copy.colAddress, width: 72, minWidth: 68, cellRenderer: AddressCell, cellStyle: riskCellStyle },
      {
        field: "country",
        headerName: copy.colCountry,
        width: 76,
        minWidth: 76,
        suppressSizeToFit: true,
        cellRenderer: CountryCell,
        cellStyle: riskCellStyle,
        tooltipValueGetter: (params) => {
          const row = params.data;
          const ctx = params.context as GridContext;
          const order = orderFor(row, ctx?.orders || []);
          if (row && order && countryMismatch(row.country, order.country)) return ctx.copy.mismatchCountry.replace("{a}", row.country || EMPTY).replace("{b}", order.country || EMPTY);
          return row?.country || undefined;
        },
      },
      { headerName: copy.colOverride, width: 96, minWidth: 92, suppressSizeToFit: true, cellRenderer: OverrideCell, sortable: false },
      {
        headerName: "",
        width: 104,
        minWidth: 100,
        maxWidth: 112,
        pinned: "right",
        suppressSizeToFit: true,
        cellRenderer: ReplyCell,
        sortable: false,
        resizable: false,
      },
    ],
    [copy],
  );

  const context = useMemo<GridContext>(() => ({ orders, copy, matched, flashIds, onOverride, onReply }), [orders, copy, matched, flashIds, onOverride, onReply]);

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
        rowClassRules={{
          "sb-risk": (params) => Boolean(params.data?.addressRisk && params.data?.matchedOrderId),
          "sb-flash": (params) => flashIds.includes(params.data?.id || ""),
        }}
        onSelectionChanged={(event) => onSelection(event.api.getSelectedRows().map((row) => row.id))}
        defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true }}
        animateRows={false}
        tooltipShowDelay={200}
      />
    </div>
  );
}
