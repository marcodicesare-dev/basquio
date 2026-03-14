type StatusCardProps = {
  title: string;
  value: string;
  detail: string;
};

export function StatusCard({ title, value, detail }: StatusCardProps) {
  return (
    <article className="panel">
      <p className="eyebrow">{title}</p>
      <h3>{value}</h3>
      <p className="muted">{detail}</p>
    </article>
  );
}
