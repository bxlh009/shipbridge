"use client";

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowSelectionOptions,
} from "ag-grid-community";
import type { Copy } from "@/lib/i18n";
import { SELLER_PROTECTION_WARNING, type GridRow, type Order } from "@/lib/types";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  headerBackgroundColor: "#003087",
  headerTextColor: "#ffffff",
  accentColor: "#0070ba",
  borderColor: "#d7e2f0",
  browserColorScheme: "light",
  fontFamily: "Segoe UI, PingFang SC, Noto Sans SC, sans-serif",
});

function ConfidenceCell(props: ICellRendererParams<GridRow>) {
  const value = props.value as number;
  const risk = props.data?.addressRisk;
  const tone = risk ? "bg-red-100 text-red-800" : value >= 80 ? "bg-emerald-100 text-emerald-800" : value >= 50 ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600";
  return (
    <span title={(props.data?.reasons || []).join("\n")} className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {value || 0}
    </span>
  );
}

function AddressCell(props: ICellRendererParams<GridRow>) {
  if (props.data?.addressRisk && props.data.matchedOrderId) {
    return (
      <span title={SELLER_PROTECTION_WARNING} className="text-xs font-semibold text-red-700">
        PayPal address mismatch
      </span>
    );
  }
  if (props.data?.matchedOrderId) return <span className="text-xs text-emerald-700">{props.context.okLabel}</span>;
  return <span className="text-xs text-slate-400">—</span>;
}

function SyncCell(props: ICellRendererParams<GridRow>) {
  const status = props.data?.syncStatus;
  if (status === "verified") return <span className="text-xs font-semibold text-emerald-700">✓ verified in PayPal</span>;
  if (status === "failed") return <span className="text-xs text-red-700">{props.data?.syncMessage || "Failed"}</span>;
  if (status === "skipped") return <span className="text-xs text-amber-800">{props.data?.syncMessage || "Skipped"}</span>;
  if (status === "unverified") return <span className="text-xs text-amber-800">{props.data?.syncMessage}</span>;
  return <span className="text-xs text-slate-400">—</span>;
}

function OverrideCell(props: ICellRendererParams<GridRow>) {
  const orders = (props.context.orders || []) as Order[];
  return (
    <select
      aria-label="Override match"
      className="h-8 max-w-full rounded border border-slate-200 bg-white px-1 text-xs"
      value={props.data?.matchedOrderId || ""}
      onMouseDown={(event) => event.stopPropagation()}
      onChange={(event) => props.context.onOverride(props.data?.id, event.target.value)}
    >
      <option value="">{props.context.noMatch}</option>
      {orders.map((order) => (
        <option key={order.id} value={order.id}>
          {order.id} · {order.buyerName}
        </option>
      ))}
    </select>
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
  onOverride,
  onSelection,
}: {
  rows: GridRow[];
  orders: Order[];
  copy: Copy;
  onOverride: (rowId: string, orderId: string) => void;
  onSelection: (ids: string[]) => void;
}) {
  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      { field: "trackingNumber", headerName: copy.colTracking, width: 172, minWidth: 172, suppressSizeToFit: true },
      { field: "carrier", headerName: copy.colCarrier, minWidth: 108, flex: 0.8 },
      { field: "recipientName", headerName: copy.colRecipient, minWidth: 126, flex: 1 },
      { field: "matchedOrderId", headerName: copy.colOrder, minWidth: 118, flex: 0.85 },
      { field: "buyerName", headerName: copy.colBuyer, minWidth: 124, flex: 1 },
      { field: "confidence", headerName: copy.colConfidence, minWidth: 112, maxWidth: 130, cellRenderer: ConfidenceCell },
      { headerName: copy.colAddress, minWidth: 168, flex: 1.2, cellRenderer: AddressCell },
      { headerName: copy.colSync, minWidth: 168, flex: 1.15, cellRenderer: SyncCell },
      { field: "postcode", headerName: copy.colPostcode, minWidth: 96, maxWidth: 120 },
      { field: "country", headerName: copy.colCountry, minWidth: 88, maxWidth: 100 },
      { headerName: copy.colOverride, minWidth: 168, flex: 1.1, cellRenderer: OverrideCell },
    ],
    [copy],
  );

  return (
    <div className="h-[460px] w-full" data-testid="match-grid">
      <AgGridReact<GridRow>
        theme={theme}
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(params) => params.data.id}
        rowSelection={rowSelection}
        context={{ orders, onOverride, okLabel: copy.addressOk, noMatch: copy.noMatch }}
        getRowStyle={(params) => {
          if (params.data?.addressRisk && params.data.matchedOrderId) return { backgroundColor: "#fee2e2" };
          if (params.data?.syncStatus === "verified") return { backgroundColor: "#dcfce7" };
          return undefined;
        }}
        onSelectionChanged={(event) => onSelection(event.api.getSelectedRows().map((row) => row.id))}
        onFirstDataRendered={(event) => event.api.sizeColumnsToFit()}
        onGridSizeChanged={(event) => event.api.sizeColumnsToFit()}
        defaultColDef={{ sortable: true, resizable: true }}
        animateRows
      />
    </div>
  );
}
