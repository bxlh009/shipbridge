import fs from "fs";
import path from "path";
import XLSX from "xlsx";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "public", "samples", "4px-sample.xlsx");
const rows = [
  ["Waybill Number", "Consignee Name", "Consignee Zip", "Destination Country", "City", "Product Name", "Quantity", "Customer Ref No", "Carrier"],
  ["4PX202611110005", "Sophie Martin", "M5V 2T6", "Canada", "Toronto", "Wireless Earbuds", 1, "INV-1005", "4PX"],
  ["4PX202611110007", "Olivia Brooks", "94105", "United States", "San Francisco", "Bluetooth Speaker", 1, "INV-1007", "4PX"],
  ["4PX202611110008", "Chloe Davis", "M1 1AE", "United Kingdom", "Manchester", "Linen Scarf", 1, "INV-1008", "4PX"],
];
const sheet = XLSX.utils.aoa_to_sheet(rows);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sheet, "4PX SAMPLE");
fs.mkdirSync(path.dirname(target), { recursive: true });
XLSX.writeFile(book, target);
console.log("wrote", target);
