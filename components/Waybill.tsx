"use client";

import { useState } from "react";

export default function Waybill({ value, copyValue, title, copiedLabel }: { value: string; copyValue?: string; title?: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick(event: React.MouseEvent) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(copyValue || value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className={`sb-waybill${copied ? " is-copied" : ""}`} title={title || value} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => void onClick(event)}>
      <span>{copied ? copiedLabel : value}</span>
    </button>
  );
}
