import Papa from "papaparse";
import * as XLSX from "xlsx";
import { canonicalCarrierName } from "../carriers";
import { normalizeCountry } from "../text";
import type { ManifestRow } from "../types";

type Field =
  | "trackingNumber"
  | "recipientName"
  | "postcode"
  | "country"
  | "city"
  | "item"
  | "qty"
  | "refNo"
  | "carrier";

const HEADER_FIELDS: Record<string, Field> = {
  运单号: "trackingNumber",
  物流单号: "trackingNumber",
  追踪号: "trackingNumber",
  "tracking number": "trackingNumber",
  "tracking no": "trackingNumber",
  "tracking no.": "trackingNumber",
  tracking: "trackingNumber",
  "waybill number": "trackingNumber",
  "waybill no": "trackingNumber",
  waybill: "trackingNumber",
  收件人: "recipientName",
  收件人姓名: "recipientName",
  收件人名称: "recipientName",
  recipient: "recipientName",
  "recipient name": "recipientName",
  consignee: "recipientName",
  "consignee name": "recipientName",
  receiver: "recipientName",
  "buyer name": "recipientName",
  邮编: "postcode",
  邮政编码: "postcode",
  postcode: "postcode",
  "postal code": "postcode",
  zip: "postcode",
  "zip code": "postcode",
  "consignee zip": "postcode",
  国家: "country",
  目的国家: "country",
  目的地国家: "country",
  country: "country",
  "country code": "country",
  "destination country": "country",
  "dest. country": "country",
  "dest country": "country",
  城市: "city",
  city: "city",
  "consignee city": "city",
  品名: "item",
  申报品名: "item",
  商品名称: "item",
  item: "item",
  description: "item",
  "product name": "item",
  product: "item",
  goods: "item",
  "goods name": "item",
  数量: "qty",
  qty: "qty",
  quantity: "qty",
  客户单号: "refNo",
  订单号: "refNo",
  参考号: "refNo",
  "customer ref no": "refNo",
  "customer ref": "refNo",
  "ref no": "refNo",
  reference: "refNo",
  "reference no": "refNo",
  "order no": "refNo",
  "order number": "refNo",
  invoice: "refNo",
  "invoice id": "refNo",
  物流商: "carrier",
  承运商: "carrier",
  carrier: "carrier",
  logistics: "carrier",
};

function normHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_./]+/g, " ")
    .replace(/\s+/g, " ");
}

export function providerFromFilename(filename: string): string | undefined {
  const name = filename.toLowerCase();
  if (name.includes("yun") || filename.includes("云途")) return "YunExpress";
  if (name.includes("4px") || filename.includes("递四方")) return "4PX";
  if (name.includes("yanwen") || filename.includes("燕文")) return "Yanwen";
  return undefined;
}

export function parseMatrix(matrix: unknown[][], filename = "manifest"): ManifestRow[] {
  const rows = matrix
    .map((row) => (Array.isArray(row) ? row : []))
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  if (rows.length < 2) return [];

  const header = rows[0].map((cell) => String(cell ?? ""));
  const fields = header.map((cell) => HEADER_FIELDS[cell.trim()] || HEADER_FIELDS[normHeader(cell)] || null);
  const hint = providerFromFilename(filename);
  const parsed: ManifestRow[] = [];

  for (const raw of rows.slice(1)) {
    const record: Partial<Record<Field, string>> = {};
    fields.forEach((field, index) => {
      if (!field) return;
      record[field] = String(raw[index] ?? "").trim();
    });
    const trackingNumber = record.trackingNumber?.trim() || "";
    if (!trackingNumber || /^tracking|运单号|waybill$/i.test(trackingNumber)) continue;
    const qty = Number.parseInt(record.qty || "1", 10);
    parsed.push({
      trackingNumber,
      carrier: canonicalCarrierName(record.carrier, hint),
      recipientName: record.recipientName || "",
      postcode: record.postcode || "",
      country: normalizeCountry(record.country || ""),
      city: record.city || "",
      item: record.item || "",
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      refNo: record.refNo || "",
      source: filename,
    });
  }
  return parsed;
}

export function parseCsv(text: string, filename = "manifest.csv"): ManifestRow[] {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  return parseMatrix(result.data, filename);
}

export function parseXlsx(data: Buffer | Uint8Array, filename = "manifest.xlsx"): ManifestRow[] {
  const book = XLSX.read(data, { type: "buffer" });
  const sheetName = book.SheetNames[0];
  if (!sheetName) return [];
  const sheet = book.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  return parseMatrix(matrix, filename);
}

export function parseBuffer(data: Buffer, filename: string): ManifestRow[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(data.toString("utf8"), filename);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return parseXlsx(data, filename);
  throw new Error("Upload a CSV or XLSX manifest. Screenshots need an LLM key.");
}
