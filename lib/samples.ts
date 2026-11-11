import fs from "fs";
import path from "path";
import { parseBuffer } from "./manifest/parse";
import type { ManifestRow } from "./types";

const FILES = {
  yunexpress: "yunexpress-sample.csv",
  "4px": "4px-sample.xlsx",
  yanwen: "yanwen-sample.csv",
} as const;

export type SampleName = keyof typeof FILES | "all";

export function loadSample(name: SampleName): ManifestRow[] {
  if (name === "all") return [...loadSample("yunexpress"), ...loadSample("4px"), ...loadSample("yanwen")];
  const filename = FILES[name];
  if (!filename) throw new Error(`Unknown sample "${name}"`);
  const full = path.join(process.cwd(), "public", "samples", filename);
  const data = fs.readFileSync(full);
  return parseBuffer(data, filename);
}
