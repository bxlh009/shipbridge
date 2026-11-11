import { NextResponse } from "next/server";
import { parseBuffer, parseCsv } from "@/lib/manifest/parse";
import { loadSample, type SampleName } from "@/lib/samples";
import { parseManifestImage } from "@/lib/vision";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAMPLES = new Set(["yunexpress", "4px", "yanwen", "all"]);

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        sample?: string;
        csv?: string;
        filename?: string;
        imageDataUrl?: string;
      };
      if (body.sample) {
        if (!SAMPLES.has(body.sample)) {
          return NextResponse.json({ ok: false, message: "Unknown sample" }, { status: 400 });
        }
        const rows = loadSample(body.sample as SampleName);
        return NextResponse.json({ ok: true, source: body.sample, rows });
      }
      if (body.imageDataUrl) {
        if (!body.imageDataUrl.startsWith("data:image/")) {
          return NextResponse.json({ ok: false, message: "Image must be a data URL" }, { status: 400 });
        }
        try {
          const rows = await parseManifestImage(body.imageDataUrl);
          return NextResponse.json({ ok: true, source: "screenshot", rows });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Vision parse failed";
          if (message === "LLM_UNAVAILABLE") {
            return NextResponse.json(
              {
                ok: false,
                code: "LLM_UNAVAILABLE",
                message:
                  "No LLM API key is configured, so the screenshot cannot be read. Use a sample manifest instead (the files are clearly fake SAMPLE data).",
                samples: ["yunexpress", "4px", "yanwen"],
              },
              { status: 200 },
            );
          }
          return NextResponse.json(
            {
              ok: false,
              code: "VISION_FAILED",
              message: `The vision model failed (${message}). Use a sample manifest instead.`,
              samples: ["yunexpress", "4px", "yanwen"],
            },
            { status: 200 },
          );
        }
      }
      if (typeof body.csv === "string") {
        const rows = parseCsv(body.csv, body.filename || "upload.csv");
        return NextResponse.json({ ok: true, source: "csv", rows });
      }
      return NextResponse.json({ ok: false, message: "Send sample, csv, or imageDataUrl" }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "Attach a file" }, { status: 400 });
    }
    if (file.type.startsWith("image/")) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;
      try {
        const rows = await parseManifestImage(dataUrl);
        return NextResponse.json({ ok: true, source: file.name, rows });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Vision parse failed";
        if (message === "LLM_UNAVAILABLE") {
          return NextResponse.json({
            ok: false,
            code: "LLM_UNAVAILABLE",
            message:
              "No LLM API key is configured, so the screenshot cannot be read. Use a sample manifest instead (the files are clearly fake SAMPLE data).",
            samples: ["yunexpress", "4px", "yanwen"],
          });
        }
        return NextResponse.json({
          ok: false,
          code: "VISION_FAILED",
          message: `The vision model failed (${message}). Use a sample manifest instead.`,
          samples: ["yunexpress", "4px", "yanwen"],
        });
      }
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseBuffer(buffer, file.name);
    return NextResponse.json({ ok: true, source: file.name, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse the manifest";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
