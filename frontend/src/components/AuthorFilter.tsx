import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/api/client";
import type { AuthUser } from "@/stores/auth";
import { Label } from "@/components/ui/label";

interface AuthorFilterProps {
  value: number | null;
  onChange: (userId: number | null) => void;
}

export function AuthorFilter({ value, onChange }: AuthorFilterProps) {
  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<AuthUser[]>("/users"),
  });

  return (
    <div className="flex items-center gap-2">
      <Label className="whitespace-nowrap text-xs text-muted-foreground">Автор</Label>
      <select
        className="h-8 rounded-lg border border-border bg-card px-2 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Все записи</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            Только записи {u.full_name}
          </option>
        ))}
      </select>
    </div>
  );
}
