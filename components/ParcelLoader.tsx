export default function ParcelLoader({ label }: { label: string }) {
  return (
    <div className="sb-loader" role="status" aria-label={label}>
      <span />
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
