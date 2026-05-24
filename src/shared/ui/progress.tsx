type Props = {
  value: number;
};

export function Progress({ value }: Props) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-ink/10">
      <div
        className="h-full rounded-full bg-gradient-to-r from-ember via-apricot to-teal transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
