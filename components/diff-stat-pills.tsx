export function DiffStatPills({
  diff,
}: {
  diff: { additions: number; deletions: number };
}) {
  return (
    <span
      aria-label={`+${diff.additions} -${diff.deletions}`}
      className="flex shrink-0 items-center font-mono text-[9px] leading-none tabular-nums"
    >
      <span
        className="rounded-l bg-emerald-500/10 px-0.5 py-0.5 font-medium"
        style={{ color: "var(--color-emerald-500)" }}
      >
        +{diff.additions}
      </span>
      <span
        className="rounded-r bg-destructive/10 px-0.5 py-0.5 font-medium"
        style={{ color: "var(--destructive)" }}
      >
        -{diff.deletions}
      </span>
    </span>
  );
}
