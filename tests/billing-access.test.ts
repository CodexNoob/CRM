import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";
import { navForRole } from "@/components/staff/nav-config";
import { requirePermission } from "@/services/access";
import { getBillingOverview } from "@/services/firm-billing";
import { createTestDb, createUser } from "./helpers";

const roles: Actor["role"][] = [
  "administrator", "operations_manager", "project_manager", "team_member", "sales_manager",
  "sales_representative", "finance_manager", "accountant", "marketing_manager", "account_manager",
  "support_agent", "developer", "read_only", "super_admin", "client",
];
const billingActions = ["view", "create", "edit", "delete", "export", "approve", "manage", "download"] as const;

function actor(role: Actor["role"]): Actor {
  return { userId: "user", firmId: "firm", role, clientId: role === "client" ? "client" : null, name: "Test", email: "test@example.test" };
}

describe("Owner-only billing access", () => {
  it("grants billing permissions only to the firm Owner", () => {
    for (const action of billingActions) {
      expect(can(actor("admin"), "billing", action)).toBe(true);
      for (const role of roles) expect(can(actor(role), "billing", action), `${role}:${action}`).toBe(false);
    }
  });

  it("rejects non-Owner service access before a database query", async () => {
    const nonOwners = ["administrator", "finance_manager", "accountant", "operations_manager", "super_admin"] as const;
    for (const role of nonOwners) {
      expect(() => requirePermission(actor(role), "billing", "view")).toThrow(ForbiddenError);
      await expect(getBillingOverview({} as never, actor(role))).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("allows the authenticated Owner to read their workspace billing overview only", async () => {
    const handle = await createTestDb();
    try {
      const owner = await createUser(handle.db, { role: "admin" });
      const overview = await getBillingOverview(handle.db, owner);
      expect(overview.firm.id).toBe(owner.firmId);
      expect(overview.canManage).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it("hides billing navigation and subscription actions from every non-Owner", () => {
    for (const role of roles) {
      const labels = navForRole(actor(role)).flatMap((section) => section.items.map((item) => item.label));
      expect(labels).not.toContain("Invoices & Billing");
      expect(labels).not.toContain("Payments");
    }
    expect(navForRole(actor("admin")).flatMap((section) => section.items.map((item) => item.label))).toContain("Invoices & Billing");
  });
});
