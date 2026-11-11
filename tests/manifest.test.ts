import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseBuffer, parseCsv } from "@/lib/manifest/parse";

const samples = path.join(process.cwd(), "public", "samples");

describe("manifest parsing", () => {
  it("reads YunExpress Chinese headers and normalizes countries", () => {
    const text = fs.readFileSync(path.join(samples, "yunexpress-sample.csv"), "utf8");
    const rows = parseCsv(text, "yunexpress-sample.csv");
    expect(rows).toHaveLength(5);
    const emily = rows.find((row) => row.trackingNumber === "YT202611110001");
    expect(emily).toMatchObject({
      carrier: "YunExpress",
      recipientName: "Emily Carter",
      postcode: "10001",
      country: "US",
      city: "New York",
      item: "Silicone Phone Case",
      qty: 2,
      refNo: "INV-1001",
    });
    expect(rows.find((row) => row.recipientName === "Anna Schmidt")?.postcode).toBe("10117");
    expect(rows.find((row) => row.trackingNumber === "YT202611119999")?.country).toBe("AU");
  });

  it("reads the 4PX workbook and the Yanwen CSV", () => {
    const four = parseBuffer(fs.readFileSync(path.join(samples, "4px-sample.xlsx")), "4px-sample.xlsx");
    expect(four.map((row) => row.trackingNumber)).toEqual(["4PX202611110005", "4PX202611110007", "4PX202611110008"]);
    expect(four[0].country).toBe("CA");
    expect(four[0].carrier).toBe("4PX");
    expect(four[2].recipientName).toBe("Chloe Davis");

    const yanwen = parseCsv(fs.readFileSync(path.join(samples, "yanwen-sample.csv"), "utf8"), "yanwen-sample.csv");
    expect(yanwen).toHaveLength(2);
    expect(yanwen[0]).toMatchObject({ trackingNumber: "YW202611110006", country: "AU", carrier: "Yanwen", refNo: "INV-1006" });
    expect(yanwen[1].country).toBe("DE");
  });
});
