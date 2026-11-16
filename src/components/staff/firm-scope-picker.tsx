import { buttonClass } from "@/components/ui";

export function FirmScopePicker({
  action,
  currentFirmId,
  firms,
}: {
  action: string;
  currentFirmId: string;
  firms: { id: string; name: string }[];
}) {
  return (
    <form action={action} method="get" className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3">
      <label className="min-w-52 space-y-1 text-[12px] font-medium text-muted">
        <span>Firm context</span>
        <select name="firmId" defaultValue={currentFirmId} className="block h-9 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink">
          {firms.map((firm) => <option key={firm.id} value={firm.id}>{firm.name}</option>)}
        </select>
      </label>
      <button type="submit" className={buttonClass("secondary")}>Switch firm</button>
    </form>
  );
}
