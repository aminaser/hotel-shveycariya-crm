interface AuthorshipProps {
  createdByName?: string | null;
  createdAt?: string | null;
  updatedByName?: string | null;
  updatedAt?: string | null;
  className?: string;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuthorshipMeta({
  createdByName,
  createdAt,
  updatedByName,
  updatedAt,
  className = "",
}: AuthorshipProps) {
  if (!createdByName && !updatedByName) return null;

  const createdChanged =
    updatedByName &&
    updatedAt &&
    createdAt &&
    (updatedByName !== createdByName ||
      Math.abs(new Date(updatedAt).getTime() - new Date(createdAt).getTime()) > 60_000);

  return (
    <div className={`space-y-0.5 text-xs text-muted-foreground ${className}`}>
      {createdByName && (
        <div>
          Создал: {createdByName}
          {createdAt ? <span className="block">{formatDateTime(createdAt)}</span> : null}
        </div>
      )}
      {createdChanged && (
        <div className="pt-1">
          Последнее изменение:
          <span className="block">{updatedByName}</span>
          <span className="block">{formatDateTime(updatedAt)}</span>
        </div>
      )}
    </div>
  );
}
