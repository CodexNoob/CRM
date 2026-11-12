import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/db";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createEngagement } from "@/services/engagements";
import { uploadDocument } from "@/services/documents";
import {
  approveTaxReturn,
  createTaxDocumentTemplate,
  createTaxPreparationCase,
  createTaxReturnFromPreparation,
  getTaxPreparationCase,
  getTaxReturn,
  recordTaxAuthorityResponse,
  recordTaxAuthorization,
  recordTaxFiling,
  requestTaxReturnChanges,
  setTaxPreparationStatus,
  startTaxReturnReview,
  submitTaxReturnForReview,
  updateTaxChecklistItem,
  updateTaxReturnPreparationData,
} from "@/services/tax";
import { createClientWithPortalUser, createTestDb, createTestFirm, createUser } from "./helpers";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

let h: DbHandle;
let admin: Actor;
let preparer: Actor;
let reviewer: Actor;
let outsider: Actor;
let readOnly: Actor;
let clientId: string;

async function createCase(taxYear: number, assignee = preparer) {
  const engagement = await createEngagement(h.db, admin, clientId, {
    title: `Tax ${taxYear}`,
    serviceType: "individual_tax",
    ownerId: assignee.userId,
    taxYear,
  });
  return createTaxPreparationCase(h.db, admin, {
    clientId,
    engagementId: engagement.id,
    taxYear,
    taxPeriod: "annual",
    jurisdiction: "US-CA",
    taxFormType: "1040",
    filingType: "original",
    returnSequence: 1,
    serviceType: "individual_tax",
    preparerId: assignee.userId,
    reviewerId: reviewer.userId,
  });
}

beforeAll(async () => {
  h = await createTestDb();
  admin = await createUser(h.db, { role: "admin", name: "Tax Admin" });
  preparer = await createUser(h.db, { role: "employee", name: "Tax Preparer" });
  reviewer = await createUser(h.db, { role: "employee", name: "Tax Reviewer" });
  outsider = await createUser(h.db, { role: "employee", name: "Unassigned Staff" });
  readOnly = await createUser(h.db, { role: "read_only", name: "Read Only" });
  const client = await createClientWithPortalUser(h.db, admin, "Tax Client");
  clientId = client.client.id;
  await createTaxDocumentTemplate(h.db, admin, {
    name: "Income statements",
    taxpayerType: "individual",
    serviceType: "individual_tax",
    jurisdiction: "US-CA",
    required: true,
  });
});

afterAll(async () => {
  await h.close();
});

describe("tax preparation and return workflows", () => {
  it("snapshots required documents and enforces assigned access and permissions", async () => {
    const preparationCase = await createCase(2025);
    const details = await getTaxPreparationCase(h.db, preparer, preparationCase.id);
    expect(details.checklist).toHaveLength(1);
    expect(details.checklist[0]?.required).toBe(true);

    await expect(getTaxPreparationCase(h.db, outsider, preparationCase.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setTaxPreparationStatus(h.db, readOnly, preparationCase.id, { status: "documents_requested" }))
      .rejects.toBeInstanceOf(ForbiddenError);
    const otherFirmId = await createTestFirm(h.db, "Other Tax Firm");
    const otherFirmAdmin = await createUser(h.db, { role: "admin", firmId: otherFirmId, name: "Other Firm Admin" });
    await expect(getTaxPreparationCase(h.db, otherFirmAdmin, preparationCase.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createCase(2025)).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires verified checklist items, supports correction, and records the reviewed filing lifecycle", async () => {
    const preparationCase = await createCase(2026);
    const details = await getTaxPreparationCase(h.db, preparer, preparationCase.id);
    const [item] = details.checklist;
    expect(item).toBeDefined();

    await setTaxPreparationStatus(h.db, preparer, preparationCase.id, { status: "documents_requested" });
    await setTaxPreparationStatus(h.db, preparer, preparationCase.id, { status: "documents_received" });
    await expect(setTaxPreparationStatus(h.db, preparer, preparationCase.id, { status: "ready_for_preparation" }))
      .rejects.toBeInstanceOf(ValidationError);

    const engagement = await createEngagement(h.db, admin, clientId, {
      title: "Supporting docs 2026",
      serviceType: "individual_tax",
      ownerId: preparer.userId,
      taxYear: 2026,
    });
    const document = await uploadDocument(h.db, preparer, {
      clientId,
      engagementId: engagement.id,
      fileName: "income.pdf",
      data: PDF,
    });
    await updateTaxChecklistItem(h.db, preparer, item!.id, { status: "verified", documentId: document.id });
    await setTaxPreparationStatus(h.db, preparer, preparationCase.id, { status: "ready_for_preparation" });
    await setTaxPreparationStatus(h.db, preparer, preparationCase.id, { status: "in_preparation" });

    const taxReturn = await createTaxReturnFromPreparation(h.db, preparer, preparationCase.id);
    expect((await createTaxReturnFromPreparation(h.db, preparer, preparationCase.id)).id).toBe(taxReturn.id);
    await expect(updateTaxReturnPreparationData(h.db, preparer, taxReturn.id, {
      refundAmount: "100",
      amountOwed: "25",
    })).rejects.toBeInstanceOf(ValidationError);
    const preparedReturn = await updateTaxReturnPreparationData(h.db, preparer, taxReturn.id, {
      refundAmount: "1,234.56",
      amountOwed: "",
      internalNotes: "Prepared from approved software.",
    });
    expect(preparedReturn.refundAmountCents).toBe(123456);
    expect(preparedReturn.internalNotes).toBe("Prepared from approved software.");
    const clearedNotes = await updateTaxReturnPreparationData(h.db, preparer, taxReturn.id, {
      refundAmount: "1,234.56",
      amountOwed: "",
      internalNotes: "",
    });
    expect(clearedNotes.internalNotes).toBeNull();
    await expect(recordTaxFiling(h.db, admin, taxReturn.id, {
      filingDate: "2026-03-01",
      submissionReference: "SUB-1",
    })).rejects.toBeInstanceOf(ValidationError);

    await submitTaxReturnForReview(h.db, preparer, taxReturn.id);
    await startTaxReturnReview(h.db, reviewer, taxReturn.id);
    await requestTaxReturnChanges(h.db, reviewer, taxReturn.id, { note: "Clarify the reported income." });
    await submitTaxReturnForReview(h.db, preparer, taxReturn.id);
    await startTaxReturnReview(h.db, reviewer, taxReturn.id);
    await approveTaxReturn(h.db, reviewer, taxReturn.id);
    await expect(setTaxPreparationStatus(h.db, preparer, preparationCase.id, { status: "in_preparation" }))
      .rejects.toBeInstanceOf(ValidationError);
    expect((await getTaxReturn(h.db, admin, taxReturn.id)).taxReturn.status).toBe("awaiting_client_approval");
    await recordTaxAuthorization(h.db, admin, taxReturn.id, { outcome: "authorized" });
    await recordTaxFiling(h.db, admin, taxReturn.id, {
      filingDate: "2026-03-01",
      submissionReference: "SUB-1",
    });
    await expect(recordTaxAuthorityResponse(h.db, admin, taxReturn.id, { outcome: "accepted" }))
      .resolves.toMatchObject({ status: "accepted", filingStatus: "accepted" });

    const finalReturn = await getTaxReturn(h.db, admin, taxReturn.id);
    expect(finalReturn.history.some((entry) => entry.eventType === "changes_requested")).toBe(true);
    expect(finalReturn.history.some((entry) => entry.eventType === "authority_accepted")).toBe(true);
    await expect(updateTaxReturnPreparationData(h.db, preparer, taxReturn.id, { refundAmount: "", amountOwed: "" }))
      .rejects.toBeInstanceOf(ValidationError);
  });
});
