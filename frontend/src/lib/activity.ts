import { apiFetch } from "@/api/client";

export async function logClientActivity(payload: {
  action: string;
  entity_type?: string;
  entity_id?: string | number;
  entity_label?: string;
  old_value?: string;
  new_value?: string;
}) {
  try {
    await apiFetch("/activity", {
      method: "POST",
      body: JSON.stringify({
        action: payload.action,
        entity_type: payload.entity_type ?? null,
        entity_id: payload.entity_id != null ? String(payload.entity_id) : null,
        entity_label: payload.entity_label ?? null,
        old_value: payload.old_value ?? null,
        new_value: payload.new_value ?? null,
      }),
    });
  } catch {
    // Never block the main action if the audit write fails.
  }
}
