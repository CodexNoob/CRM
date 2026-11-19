import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import {
  clients,
  documents,
  engagements,
  firmCounters,
  taxDocumentTemplates,
  taxPreparationCases,
  taxPreparationChecklistItems,
  taxReturnHistory,
  taxReturns,
  users,
  type TaxPreparationStatus,
  type TaxReturnStatus,
} from "@/db/schema";
import type { Actor } from "@/lib/auth/actor";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  isUuid,
  parseInput,
  taxAuthorizationRecordSchema,
  taxAuthorityResponseSchema,
  taxChecklistUpdateSchema,
  taxDocumentTemplateInputSchema,
  taxFilingRecordSchema,
  taxPreparationInputSchema,
  taxPreparationStatusSchema,
  taxReturnPreparationDataSchema,
  taxReturnReviewNoteSchema,
} from "@/lib/validation";
import { assertActiveStaffUser, assertClientAccess, ensureAssignment, inFirm, requirePermission, visibleClientsCondition } from "./access";
import { recordAudit } from "./audit";
import { logActivity, recordStatusChange } from "./timeline";

const casePreparer = alias(users, "tax_case_preparer");
const caseReviewer = alias(users, "tax_case_reviewer");
const returnPreparer = alias(users, "tax_return_preparer");
const returnReviewer = alias(users, "tax_return_reviewer");

function isWorkRole(role: string) {
  return ["admin", "administrator", "operations_manager", "project_manager", "team_member", "finance_manager", "accountant", "manager", "employee"].some((value) => value === role);
}

function isScopedTaxWorker(role: string) {
  return ["employee", "team_member", "accountant"].some((value) => value === role);
}

async function validateAssignee(db: Db, actor: Actor, userId: string, field: string) {
  const { role } = await assertActiveStaffUser(db, actor, userId, field);
  if (!isWorkRole(role)) throw new ValidationError({ [field]: ["Choose an active staff member who can work on cases."] });
}

function canAssignTo(actor: Actor, userId: string) {
  if (userId !== actor.userId) requirePermission(actor, "tax_preparation", "assign");
}

function likeContains(value: string) {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function loadPreparationCase(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "tax_preparation", "view");
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db
    .select({
      preparationCase: taxPreparationCases,
      clientName: clients.displayName,
      taxpayerType: clients.type,
      engagementTitle: engagements.title,
      preparerName: casePreparer.name,
      reviewerName: caseReviewer.name,
    })
    .from(taxPreparationCases)
    .innerJoin(clients, and(eq(clients.id, taxPreparationCases.clientId), eq(clients.firmId, taxPreparationCases.firmId)))
    .leftJoin(engagements, and(eq(engagements.id, taxPreparationCases.engagementId), eq(engagements.firmId, taxPreparationCases.firmId)))
    .leftJoin(casePreparer, and(eq(casePreparer.id, taxPreparationCases.preparerId), eq(casePreparer.firmId, taxPreparationCases.firmId)))
    .leftJoin(caseReviewer, and(eq(caseReviewer.id, taxPreparationCases.reviewerId), eq(caseReviewer.firmId, taxPreparationCases.firmId)))
    .where(and(eq(taxPreparationCases.id, id), inFirm(taxPreparationCases.firmId, actor), visibleClientsCondition(db, actor)))
    .limit(1);
  if (!row) throw new NotFoundError();
  await assertClientAccess(db, actor, row.preparationCase.clientId);
  if (isScopedTaxWorker(actor.role) && row.preparationCase.preparerId !== actor.userId && row.preparationCase.reviewerId !== actor.userId) {
    throw new NotFoundError();
  }
  return row;
}

async function loadTaxReturn(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "tax_returns", "view");
  if (!isUuid(id)) throw new NotFoundError();
  const [row] = await db
    .select({
      taxReturn: taxReturns,
      clientName: clients.displayName,
      engagementTitle: engagements.title,
      preparerName: returnPreparer.name,
      reviewerName: returnReviewer.name,
    })
    .from(taxReturns)
    .innerJoin(clients, and(eq(clients.id, taxReturns.clientId), eq(clients.firmId, taxReturns.firmId)))
    .leftJoin(engagements, and(eq(engagements.id, taxReturns.engagementId), eq(engagements.firmId, taxReturns.firmId)))
    .leftJoin(returnPreparer, and(eq(returnPreparer.id, taxReturns.preparerId), eq(returnPreparer.firmId, taxReturns.firmId)))
    .leftJoin(returnReviewer, and(eq(returnReviewer.id, taxReturns.reviewerId), eq(returnReviewer.firmId, taxReturns.firmId)))
    .where(and(eq(taxReturns.id, id), inFirm(taxReturns.firmId, actor), visibleClientsCondition(db, actor)))
    .limit(1);
  if (!row) throw new NotFoundError();
  await assertClientAccess(db, actor, row.taxReturn.clientId);
  if (isScopedTaxWorker(actor.role) && row.taxReturn.preparerId !== actor.userId && row.taxReturn.reviewerId !== actor.userId) {
    throw new NotFoundError();
  }
  return row;
}

function requireAssignedReviewer(actor: Actor, reviewerId: string | null) {
  requirePermission(actor, "tax_returns", "approve");
  if (isScopedTaxWorker(actor.role) && reviewerId !== actor.userId) throw new NotFoundError();
}

async function requiredDocumentsComplete(db: Db, firmId: string, caseId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taxPreparationChecklistItems)
    .where(and(
      eq(taxPreparationChecklistItems.firmId, firmId),
      eq(taxPreparationChecklistItems.preparationCaseId, caseId),
      eq(taxPreparationChecklistItems.required, true),
      sql`${taxPreparationChecklistItems.status} not in ('verified', 'not_applicable')`,
    ));
  return (row?.count ?? 0) === 0;
}

async function appendTaxReturnHistory(
  db: Db,
  actor: Actor,
  taxReturnId: string,
  eventType: string,
  previousStatus: string | null,
  nextStatus: string | null,
  details: { filingDate?: string | null; submissionReference?: string | null; authorityStatus?: "pending" | "accepted" | "rejected" | null; authorityResponse?: string | null } = {},
) {
  await db.insert(taxReturnHistory).values({
    firmId: actor.firmId,
    taxReturnId,
    actorId: actor.userId,
    eventType,
    previousStatus,
    nextStatus,
    filingDate: details.filingDate ?? null,
    submissionReference: details.submissionReference ?? null,
    authorityStatus: details.authorityStatus ?? null,
    authorityResponse: details.authorityResponse ?? null,
  });
  await recordAudit(db, {
    firmId: actor.firmId,
    actorUserId: actor.userId,
    action: `tax_return.${eventType}`,
    entityType: "tax_return",
    entityId: taxReturnId,
    metadata: previousStatus === nextStatus ? undefined : { from: previousStatus, to: nextStatus },
  });
}

export async function listTaxDocumentTemplates(db: Db, actor: Actor) {
  requirePermission(actor, "tax_preparation", "view");
  return db.select().from(taxDocumentTemplates)
    .where(and(inFirm(taxDocumentTemplates.firmId, actor), eq(taxDocumentTemplates.isActive, true)))
    .orderBy(asc(taxDocumentTemplates.serviceType), asc(taxDocumentTemplates.name))
    .limit(300);
}

export async function createTaxDocumentTemplate(db: Db, actor: Actor, input: unknown) {
  requirePermission(actor, "tax_preparation", "manage");
  const data = parseInput(taxDocumentTemplateInputSchema, input);
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [template] = await tx.insert(taxDocumentTemplates).values({
      firmId: actor.firmId,
      name: data.name,
      description: data.description ?? null,
      taxpayerType: data.taxpayerType ?? null,
      serviceType: data.serviceType,
      jurisdiction: data.jurisdiction ?? null,
      taxYear: data.taxYear ?? null,
      required: data.required,
      createdById: actor.userId,
    }).returning();
    if (!template) throw new Error("Insert returned no row");
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "tax_document_template.create", entityType: "tax_document_template", entityId: template.id });
    return template;
  });
}

export interface TaxPreparationListItem {
  id: string;
  clientId: string;
  clientName: string;
  engagementId: string | null;
  engagementTitle: string | null;
  taxYear: number;
  taxPeriod: string;
  jurisdiction: string;
  taxFormType: string;
  serviceType: "individual_tax" | "business_tax";
  status: TaxPreparationStatus;
  dueDate: string | null;
  preparerName: string | null;
  reviewerName: string | null;
  documentCompletion: number;
}

export async function listTaxPreparationCases(
  db: Db,
  actor: Actor,
  filters: { q?: string; status?: TaxPreparationStatus; clientId?: string; taxYear?: number; mine?: boolean } = {},
): Promise<TaxPreparationListItem[]> {
  requirePermission(actor, "tax_preparation", "view");
  const query = filters.q?.trim();
  const conditions = [
    inFirm(taxPreparationCases.firmId, actor),
    visibleClientsCondition(db, actor),
    isScopedTaxWorker(actor.role)
      ? or(eq(taxPreparationCases.preparerId, actor.userId), eq(taxPreparationCases.reviewerId, actor.userId))
      : undefined,
    filters.mine ? or(eq(taxPreparationCases.preparerId, actor.userId), eq(taxPreparationCases.reviewerId, actor.userId)) : undefined,
    filters.status ? eq(taxPreparationCases.status, filters.status) : undefined,
    filters.clientId ? eq(taxPreparationCases.clientId, filters.clientId) : undefined,
    filters.taxYear ? eq(taxPreparationCases.taxYear, filters.taxYear) : undefined,
    query ? or(ilike(clients.displayName, likeContains(query)), ilike(taxPreparationCases.taxFormType, likeContains(query)), ilike(taxPreparationCases.jurisdiction, likeContains(query))) : undefined,
  ];
  const rows = await db
    .select({
      preparationCase: taxPreparationCases,
      clientName: clients.displayName,
      engagementTitle: engagements.title,
      preparerName: casePreparer.name,
      reviewerName: caseReviewer.name,
      totalItems: sql<number>`count(${taxPreparationChecklistItems.id})::int`,
      completeItems: sql<number>`count(${taxPreparationChecklistItems.id}) filter (where ${taxPreparationChecklistItems.status} in ('verified', 'not_applicable'))::int`,
    })
    .from(taxPreparationCases)
    .innerJoin(clients, and(eq(clients.id, taxPreparationCases.clientId), eq(clients.firmId, taxPreparationCases.firmId)))
    .leftJoin(engagements, and(eq(engagements.id, taxPreparationCases.engagementId), eq(engagements.firmId, taxPreparationCases.firmId)))
    .leftJoin(casePreparer, and(eq(casePreparer.id, taxPreparationCases.preparerId), eq(casePreparer.firmId, taxPreparationCases.firmId)))
    .leftJoin(caseReviewer, and(eq(caseReviewer.id, taxPreparationCases.reviewerId), eq(caseReviewer.firmId, taxPreparationCases.firmId)))
    .leftJoin(taxPreparationChecklistItems, and(eq(taxPreparationChecklistItems.preparationCaseId, taxPreparationCases.id), eq(taxPreparationChecklistItems.firmId, taxPreparationCases.firmId)))
    .where(and(...conditions))
    .groupBy(taxPreparationCases.id, clients.displayName, engagements.title, casePreparer.name, caseReviewer.name)
    .orderBy(sql`${taxPreparationCases.dueDate} asc nulls last`, desc(taxPreparationCases.updatedAt))
    .limit(500);
  return rows.map(({ preparationCase: c, totalItems, completeItems, ...names }) => ({
    id: c.id,
    clientId: c.clientId,
    clientName: names.clientName,
    engagementId: c.engagementId,
    engagementTitle: names.engagementTitle,
    taxYear: c.taxYear,
    taxPeriod: c.taxPeriod,
    jurisdiction: c.jurisdiction,
    taxFormType: c.taxFormType,
    serviceType: c.serviceType as "individual_tax" | "business_tax",
    status: c.status,
    dueDate: c.dueDate,
    preparerName: names.preparerName,
    reviewerName: names.reviewerName,
    documentCompletion: totalItems ? Math.round((completeItems / totalItems) * 100) : 0,
  }));
}

export async function createTaxPreparationCase(db: Db, actor: Actor, input: unknown) {
  requirePermission(actor, "tax_preparation", "create");
  const data = parseInput(taxPreparationInputSchema, input);
  await assertClientAccess(db, actor, data.clientId);
  canAssignTo(actor, data.preparerId);
  await validateAssignee(db, actor, data.preparerId, "preparerId");
  if (data.reviewerId) {
    canAssignTo(actor, data.reviewerId);
    await validateAssignee(db, actor, data.reviewerId, "reviewerId");
  }

  const [client] = await db.select({ id: clients.id, type: clients.type })
    .from(clients)
    .where(and(eq(clients.id, data.clientId), inFirm(clients.firmId, actor), visibleClientsCondition(db, actor)))
    .limit(1);
  if (!client) throw new NotFoundError();

  if (data.engagementId) {
    const [engagement] = await db.select({ clientId: engagements.clientId, serviceType: engagements.serviceType })
      .from(engagements)
      .where(and(eq(engagements.id, data.engagementId), inFirm(engagements.firmId, actor)))
      .limit(1);
    if (!engagement || engagement.clientId !== data.clientId || engagement.serviceType !== data.serviceType) {
      throw new ValidationError({ engagementId: ["Choose a tax engagement for this client and service."] });
    }
  }

  const [duplicate] = await db.select({ id: taxPreparationCases.id })
    .from(taxPreparationCases)
    .where(and(
      inFirm(taxPreparationCases.firmId, actor),
      eq(taxPreparationCases.clientId, data.clientId),
      eq(taxPreparationCases.taxYear, data.taxYear),
      eq(taxPreparationCases.taxPeriod, data.taxPeriod),
      eq(taxPreparationCases.jurisdiction, data.jurisdiction),
      eq(taxPreparationCases.taxFormType, data.taxFormType),
      eq(taxPreparationCases.filingType, data.filingType),
      eq(taxPreparationCases.returnSequence, data.returnSequence),
    ))
    .limit(1);
  if (duplicate) throw new ValidationError({ _form: ["A preparation case already exists for this client and tax filing scope."] });

  const templates = await db.select().from(taxDocumentTemplates).where(and(
    inFirm(taxDocumentTemplates.firmId, actor),
    eq(taxDocumentTemplates.isActive, true),
    eq(taxDocumentTemplates.serviceType, data.serviceType),
    or(isNull(taxDocumentTemplates.taxpayerType), eq(taxDocumentTemplates.taxpayerType, client.type)),
    or(isNull(taxDocumentTemplates.jurisdiction), eq(taxDocumentTemplates.jurisdiction, data.jurisdiction)),
    or(isNull(taxDocumentTemplates.taxYear), eq(taxDocumentTemplates.taxYear, data.taxYear)),
  ));

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [preparationCase] = await tx.insert(taxPreparationCases).values({
      firmId: actor.firmId,
      clientId: data.clientId,
      engagementId: data.engagementId ?? null,
      taxYear: data.taxYear,
      taxPeriod: data.taxPeriod,
      jurisdiction: data.jurisdiction,
      taxFormType: data.taxFormType,
      filingType: data.filingType,
      returnSequence: data.returnSequence,
      serviceType: data.serviceType,
      preparerId: data.preparerId,
      reviewerId: data.reviewerId ?? null,
      dueDate: data.dueDate ?? null,
      internalNotes: data.internalNotes ?? null,
      createdById: actor.userId,
    }).returning();
    if (!preparationCase) throw new Error("Insert returned no row");
    if (templates.length) {
      await tx.insert(taxPreparationChecklistItems).values(templates.map((template) => ({
        firmId: actor.firmId,
        preparationCaseId: preparationCase.id,
        templateId: template.id,
        name: template.name,
        description: template.description,
        required: template.required,
      })));
    }
    await ensureAssignment(tx, actor.firmId, data.clientId, data.preparerId);
    if (data.reviewerId) await ensureAssignment(tx, actor.firmId, data.clientId, data.reviewerId);
    await recordAudit(tx, {
      firmId: actor.firmId,
      actorUserId: actor.userId,
      action: "tax_preparation.create",
      entityType: "tax_preparation",
      entityId: preparationCase.id,
      metadata: { clientId: data.clientId, checklistItemCount: templates.length },
    });
    await logActivity(tx, actor, { entityType: "tax_preparation", entityId: preparationCase.id, clientId: data.clientId, type: "system", body: "Tax preparation case created" });
    await recordStatusChange(tx, actor, { entityType: "tax_preparation", entityId: preparationCase.id, clientId: data.clientId, from: null, to: preparationCase.status });
    return preparationCase;
  });
}

export async function getTaxPreparationCase(db: Db, actor: Actor, id: string) {
  const row = await loadPreparationCase(db, actor, id);
  const [checklist, linkedReturn] = await Promise.all([
    db.select().from(taxPreparationChecklistItems)
      .where(and(inFirm(taxPreparationChecklistItems.firmId, actor), eq(taxPreparationChecklistItems.preparationCaseId, id)))
      .orderBy(asc(taxPreparationChecklistItems.createdAt)),
    db.select({ id: taxReturns.id, returnNumber: taxReturns.returnNumber, status: taxReturns.status })
      .from(taxReturns)
      .where(and(inFirm(taxReturns.firmId, actor), eq(taxReturns.preparationCaseId, id)))
      .limit(1),
  ]);
  return { ...row, checklist, linkedReturn: linkedReturn[0] ?? null };
}

export async function setTaxPreparationStatus(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "tax_preparation", "edit");
  const { status } = parseInput(taxPreparationStatusSchema, input);
  const { preparationCase: c } = await loadPreparationCase(db, actor, id);
  if (c.status === status) return c;
  const transitions: Record<TaxPreparationStatus, TaxPreparationStatus[]> = {
    not_started: ["documents_requested", "awaiting_documents"],
    documents_requested: ["awaiting_documents", "documents_received"],
    awaiting_documents: ["documents_received", "verification"],
    documents_received: ["verification", "ready_for_preparation"],
    verification: ["awaiting_documents", "ready_for_preparation"],
    ready_for_preparation: ["in_preparation"],
    in_preparation: ["internal_review", "changes_required"],
    internal_review: ["in_preparation", "changes_required", "completed"],
    changes_required: ["in_preparation", "internal_review"],
    completed: [],
  };
  if (!transitions[c.status].includes(status)) throw new ValidationError({ status: [`Cannot move from ${c.status.replaceAll("_", " ")} to ${status.replaceAll("_", " ")}.`] });

  if (status === "ready_for_preparation" && !(await requiredDocumentsComplete(db, actor.firmId, id))) {
    throw new ValidationError({ status: ["Verify or mark not applicable every required document before preparation starts."] });
  }
  const linked = await db.select({ id: taxReturns.id, status: taxReturns.status })
    .from(taxReturns).where(and(inFirm(taxReturns.firmId, actor), eq(taxReturns.preparationCaseId, id))).limit(1);
  if (status === "internal_review" && (!c.reviewerId || !linked[0])) {
    throw new ValidationError({ status: ["Assign a reviewer and create the linked return before internal review."] });
  }
  if (linked[0] && ["awaiting_client_approval", "approved", "filed", "accepted"].includes(linked[0].status)) {
    throw new ValidationError({ status: ["A return past review cannot be moved back through preparation."] });
  }
  if (linked[0] && status === "in_preparation" && !["in_preparation", "changes_required"].includes(linked[0].status)) {
    throw new ValidationError({ status: ["Request corrections before moving a return back into preparation."] });
  }
  if (status === "completed" && !["approved", "filed", "accepted"].includes(linked[0]?.status ?? "")) {
    throw new ValidationError({ status: ["Complete preparation after the linked return has been approved."] });
  }

  const now = new Date();
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxPreparationCases).set({
      status,
      preparationStartedAt: status === "in_preparation" ? (c.preparationStartedAt ?? now) : c.preparationStartedAt,
      submittedForReviewAt: status === "internal_review" ? now : c.submittedForReviewAt,
      completedAt: status === "completed" ? now : c.completedAt,
      updatedAt: now,
    }).where(and(eq(taxPreparationCases.id, id), inFirm(taxPreparationCases.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();

    if (linked[0] && (status === "internal_review" || status === "changes_required" || status === "in_preparation")) {
      const returnStatus: TaxReturnStatus =
        status === "internal_review" ? "ready_for_review" :
          status === "changes_required" ? "changes_required" : "in_preparation";
      await tx.update(taxReturns).set({
        status: returnStatus,
        reviewStatus: status === "internal_review" ? "pending" : status === "changes_required" ? "changes_required" : "not_started",
        updatedAt: now,
      }).where(and(eq(taxReturns.id, linked[0].id), inFirm(taxReturns.firmId, actor)));
    }
    await recordStatusChange(tx, actor, { entityType: "tax_preparation", entityId: id, clientId: c.clientId, from: c.status, to: status });
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "tax_preparation.status", entityType: "tax_preparation", entityId: id, metadata: { from: c.status, to: status } });
    return updated;
  });
}

export async function updateTaxChecklistItem(db: Db, actor: Actor, itemId: string, input: unknown) {
  requirePermission(actor, "tax_preparation", "edit");
  if (!isUuid(itemId)) throw new NotFoundError();
  const data = parseInput(taxChecklistUpdateSchema, input);
  const [item] = await db.select({ item: taxPreparationChecklistItems, case: taxPreparationCases })
    .from(taxPreparationChecklistItems)
    .innerJoin(taxPreparationCases, and(eq(taxPreparationCases.id, taxPreparationChecklistItems.preparationCaseId), eq(taxPreparationCases.firmId, taxPreparationChecklistItems.firmId)))
    .where(and(eq(taxPreparationChecklistItems.id, itemId), inFirm(taxPreparationChecklistItems.firmId, actor)))
    .limit(1);
  if (!item) throw new NotFoundError();
  await loadPreparationCase(db, actor, item.case.id);
  if (data.status === "not_applicable" || data.status === "rejected") {
    if (!data.notes?.trim()) throw new ValidationError({ notes: ["Explain why this requirement is not applicable or rejected."] });
    if (data.status === "not_applicable") requirePermission(actor, "tax_preparation", "approve");
  }
  const needsDocument = ["received", "under_review", "verified"].includes(data.status);
  if (needsDocument && !data.documentId) throw new ValidationError({ documentId: ["Link the supporting document before marking this item received, under review, or verified."] });

  if (data.documentId) {
    const [doc] = await db.select({ id: documents.id })
      .from(documents)
      .where(and(
        eq(documents.id, data.documentId),
        inFirm(documents.firmId, actor),
        eq(documents.clientId, item.case.clientId),
        isNull(documents.deletedAt),
      ))
      .limit(1);
    if (!doc) throw new ValidationError({ documentId: ["Choose an active document uploaded for this client."] });
  }

  const now = new Date();
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxPreparationChecklistItems).set({
      status: data.status,
      documentId: data.documentId ?? item.item.documentId,
      requestedAt: data.status === "requested" ? (item.item.requestedAt ?? now) : item.item.requestedAt,
      receivedAt: needsDocument ? (item.item.receivedAt ?? now) : item.item.receivedAt,
      verifiedAt: data.status === "verified" ? now : data.status === "rejected" ? null : item.item.verifiedAt,
      verifiedById: data.status === "verified" ? actor.userId : data.status === "rejected" ? null : item.item.verifiedById,
      notes: data.notes ?? item.item.notes,
      updatedAt: now,
    }).where(and(eq(taxPreparationChecklistItems.id, itemId), inFirm(taxPreparationChecklistItems.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();
    await recordAudit(tx, {
      firmId: actor.firmId,
      actorUserId: actor.userId,
      action: "tax_preparation.document_status",
      entityType: "tax_preparation_checklist_item",
      entityId: itemId,
      metadata: { from: item.item.status, to: updated.status },
    });
    await logActivity(tx, actor, {
      entityType: "tax_preparation",
      entityId: item.case.id,
      clientId: item.case.clientId,
      type: "system",
      body: `Document requirement status changed to ${updated.status.replaceAll("_", " ")}`,
    });
    return updated;
  });
}

export async function createTaxReturnFromPreparation(db: Db, actor: Actor, preparationCaseId: string) {
  requirePermission(actor, "tax_returns", "create");
  const { preparationCase: c, taxpayerType } = await loadPreparationCase(db, actor, preparationCaseId);
  const [existingReturn] = await db.select().from(taxReturns)
    .where(and(inFirm(taxReturns.firmId, actor), eq(taxReturns.preparationCaseId, c.id)))
    .limit(1);
  if (existingReturn) return existingReturn;
  if (c.status !== "in_preparation" && c.status !== "internal_review") {
    throw new ValidationError({ _form: ["Start preparation before creating its return record."] });
  }
  if (!(await requiredDocumentsComplete(db, actor.firmId, c.id))) {
    throw new ValidationError({ _form: ["Verify or mark not applicable every required document before creating the return."] });
  }
  canAssignTo(actor, c.preparerId ?? actor.userId);

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [counter] = await tx.insert(firmCounters).values({ firmId: actor.firmId, kind: "tax_return", value: 1 })
      .onConflictDoUpdate({ target: [firmCounters.firmId, firmCounters.kind], set: { value: sql`${firmCounters.value} + 1` } })
      .returning({ value: firmCounters.value });
    const initialStatus: TaxReturnStatus = c.status === "internal_review" ? "ready_for_review" : "in_preparation";
    const [created] = await tx.insert(taxReturns).values({
      firmId: actor.firmId,
      returnNumber: `TR-${String(counter!.value).padStart(6, "0")}`,
      clientId: c.clientId,
      engagementId: c.engagementId,
      preparationCaseId: c.id,
      taxpayerType,
      taxYear: c.taxYear,
      taxPeriod: c.taxPeriod,
      taxFormType: c.taxFormType,
      jurisdiction: c.jurisdiction,
      filingType: c.filingType,
      returnSequence: c.returnSequence,
      preparerId: c.preparerId,
      reviewerId: c.reviewerId,
      filingDeadline: c.dueDate,
      internalNotes: c.internalNotes,
      status: initialStatus,
      reviewStatus: initialStatus === "ready_for_review" ? "pending" : "not_started",
      createdById: actor.userId,
    }).onConflictDoNothing({ target: [taxReturns.firmId, taxReturns.preparationCaseId] }).returning();
    if (!created) {
      const [winner] = await tx.select().from(taxReturns)
        .where(and(inFirm(taxReturns.firmId, actor), eq(taxReturns.preparationCaseId, c.id)))
        .limit(1);
      if (winner) return winner;
      throw new ValidationError({ _form: ["A return already exists for this tax filing scope."] });
    }
    await tx.insert(taxReturnHistory).values({
      firmId: actor.firmId,
      taxReturnId: created.id,
      actorId: actor.userId,
      eventType: "created",
      previousStatus: null,
      nextStatus: initialStatus,
    });
    await recordAudit(tx, { firmId: actor.firmId, actorUserId: actor.userId, action: "tax_return.create", entityType: "tax_return", entityId: created.id, metadata: { preparationCaseId: c.id } });
    await logActivity(tx, actor, { entityType: "tax_return", entityId: created.id, clientId: c.clientId, type: "system", body: `Tax return ${created.returnNumber} created` });
    await recordStatusChange(tx, actor, { entityType: "tax_return", entityId: created.id, clientId: c.clientId, from: null, to: initialStatus });
    return created;
  });
}

export async function updateTaxReturnPreparationData(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "tax_preparation", "edit");
  const data = parseInput(taxReturnPreparationDataSchema, input);
  const { taxReturn: row } = await loadTaxReturn(db, actor, id);
  if (!["in_preparation", "changes_required"].includes(row.status)) {
    throw new ValidationError({ _form: ["Tax preparation details can only be updated while the return is in preparation or requires changes."] });
  }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxReturns).set({
      refundAmountCents: data.refundAmountCents ?? null,
      amountOwedCents: data.amountOwedCents ?? null,
      internalNotes: data.internalNotes ?? null,
      updatedAt: new Date(),
    }).where(and(eq(taxReturns.id, id), inFirm(taxReturns.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();
    await recordAudit(tx, {
      firmId: actor.firmId,
      actorUserId: actor.userId,
      action: "tax_return.preparation_data",
      entityType: "tax_return",
      entityId: id,
    });
    return updated;
  });
}

export async function listTaxReturns(
  db: Db,
  actor: Actor,
  filters: { q?: string; status?: TaxReturnStatus; clientId?: string; taxYear?: number; jurisdiction?: string; formType?: string; preparerId?: string; reviewerId?: string } = {},
) {
  requirePermission(actor, "tax_returns", "view");
  const query = filters.q?.trim();
  const conditions = [
    inFirm(taxReturns.firmId, actor),
    visibleClientsCondition(db, actor),
    isScopedTaxWorker(actor.role) ? or(eq(taxReturns.preparerId, actor.userId), eq(taxReturns.reviewerId, actor.userId)) : undefined,
    filters.status ? eq(taxReturns.status, filters.status) : undefined,
    filters.clientId ? eq(taxReturns.clientId, filters.clientId) : undefined,
    filters.taxYear ? eq(taxReturns.taxYear, filters.taxYear) : undefined,
    filters.jurisdiction ? eq(taxReturns.jurisdiction, filters.jurisdiction) : undefined,
    filters.formType ? eq(taxReturns.taxFormType, filters.formType) : undefined,
    filters.preparerId ? eq(taxReturns.preparerId, filters.preparerId) : undefined,
    filters.reviewerId ? eq(taxReturns.reviewerId, filters.reviewerId) : undefined,
    query ? or(ilike(clients.displayName, likeContains(query)), ilike(taxReturns.returnNumber, likeContains(query)), ilike(taxReturns.taxFormType, likeContains(query))) : undefined,
  ];
  return db.select({
    id: taxReturns.id,
    returnNumber: taxReturns.returnNumber,
    clientId: taxReturns.clientId,
    clientName: clients.displayName,
    engagementId: taxReturns.engagementId,
    engagementTitle: engagements.title,
    taxYear: taxReturns.taxYear,
    taxPeriod: taxReturns.taxPeriod,
    jurisdiction: taxReturns.jurisdiction,
    taxFormType: taxReturns.taxFormType,
    filingType: taxReturns.filingType,
    status: taxReturns.status,
    reviewStatus: taxReturns.reviewStatus,
    authorizationStatus: taxReturns.authorizationStatus,
    filingStatus: taxReturns.filingStatus,
    filingDeadline: taxReturns.filingDeadline,
    preparerId: taxReturns.preparerId,
    reviewerId: taxReturns.reviewerId,
    preparerName: returnPreparer.name,
    reviewerName: returnReviewer.name,
  })
    .from(taxReturns)
    .innerJoin(clients, and(eq(clients.id, taxReturns.clientId), eq(clients.firmId, taxReturns.firmId)))
    .leftJoin(engagements, and(eq(engagements.id, taxReturns.engagementId), eq(engagements.firmId, taxReturns.firmId)))
    .leftJoin(returnPreparer, and(eq(returnPreparer.id, taxReturns.preparerId), eq(returnPreparer.firmId, taxReturns.firmId)))
    .leftJoin(returnReviewer, and(eq(returnReviewer.id, taxReturns.reviewerId), eq(returnReviewer.firmId, taxReturns.firmId)))
    .where(and(...conditions))
    .orderBy(sql`${taxReturns.filingDeadline} asc nulls last`, desc(taxReturns.updatedAt))
    .limit(500);
}

export async function getTaxReturn(db: Db, actor: Actor, id: string) {
  const row = await loadTaxReturn(db, actor, id);
  const history = await db.select({
    id: taxReturnHistory.id,
    eventType: taxReturnHistory.eventType,
    previousStatus: taxReturnHistory.previousStatus,
    nextStatus: taxReturnHistory.nextStatus,
    filingDate: taxReturnHistory.filingDate,
    submissionReference: taxReturnHistory.submissionReference,
    authorityStatus: taxReturnHistory.authorityStatus,
    authorityResponse: taxReturnHistory.authorityResponse,
    createdAt: taxReturnHistory.createdAt,
    actorName: users.name,
  })
    .from(taxReturnHistory)
    .leftJoin(users, and(eq(users.id, taxReturnHistory.actorId), eq(users.firmId, taxReturnHistory.firmId)))
    .where(and(inFirm(taxReturnHistory.firmId, actor), eq(taxReturnHistory.taxReturnId, id)))
    .orderBy(desc(taxReturnHistory.createdAt))
    .limit(200);
  return { ...row, history };
}

export async function submitTaxReturnForReview(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "tax_preparation", "edit");
  const { taxReturn: row } = await loadTaxReturn(db, actor, id);
  if (!["in_preparation", "changes_required"].includes(row.status)) {
    throw new ValidationError({ _form: ["Only a return in preparation or requiring changes can be submitted for review."] });
  }
  if (!row.preparationCaseId || !row.reviewerId) throw new ValidationError({ _form: ["Link a preparation case and assign a reviewer before submission."] });
  if (!(await requiredDocumentsComplete(db, actor.firmId, row.preparationCaseId))) {
    throw new ValidationError({ _form: ["Verify or mark not applicable every required document before review."] });
  }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxReturns).set({ status: "ready_for_review", reviewStatus: "pending", updatedAt: new Date() })
      .where(and(eq(taxReturns.id, id), inFirm(taxReturns.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();
    if (row.preparationCaseId) await tx.update(taxPreparationCases).set({ status: "internal_review", submittedForReviewAt: new Date(), updatedAt: new Date() })
      .where(and(eq(taxPreparationCases.id, row.preparationCaseId), inFirm(taxPreparationCases.firmId, actor)));
    await recordStatusChange(tx, actor, { entityType: "tax_return", entityId: id, clientId: row.clientId, from: row.status, to: updated.status });
    await appendTaxReturnHistory(tx, actor, id, "submitted_for_review", row.status, updated.status);
    return updated;
  });
}

export async function startTaxReturnReview(db: Db, actor: Actor, id: string) {
  const { taxReturn: row } = await loadTaxReturn(db, actor, id);
  requireAssignedReviewer(actor, row.reviewerId);
  if (row.status !== "ready_for_review") throw new ValidationError({ _form: ["This return is not ready to enter review."] });
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxReturns).set({ status: "under_review", updatedAt: new Date() })
      .where(and(eq(taxReturns.id, id), inFirm(taxReturns.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();
    await recordStatusChange(tx, actor, { entityType: "tax_return", entityId: id, clientId: row.clientId, from: row.status, to: updated.status });
    await appendTaxReturnHistory(tx, actor, id, "review_started", row.status, updated.status);
    return updated;
  });
}

export async function requestTaxReturnChanges(db: Db, actor: Actor, id: string, input: unknown) {
  const { note } = parseInput(taxReturnReviewNoteSchema, input);
  const { taxReturn: row } = await loadTaxReturn(db, actor, id);
  requireAssignedReviewer(actor, row.reviewerId);
  if (!["ready_for_review", "under_review", "rejected"].includes(row.status)) {
    throw new ValidationError({ _form: ["This return is not awaiting review or correction."] });
  }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxReturns).set({ status: "changes_required", reviewStatus: "changes_required", updatedAt: new Date() })
      .where(and(eq(taxReturns.id, id), inFirm(taxReturns.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();
    if (row.preparationCaseId) await tx.update(taxPreparationCases).set({ status: "changes_required", updatedAt: new Date() })
      .where(and(eq(taxPreparationCases.id, row.preparationCaseId), inFirm(taxPreparationCases.firmId, actor)));
    await logActivity(tx, actor, { entityType: "tax_return", entityId: id, clientId: row.clientId, type: "internal_note", body: note });
    await recordStatusChange(tx, actor, { entityType: "tax_return", entityId: id, clientId: row.clientId, from: row.status, to: updated.status });
    await appendTaxReturnHistory(tx, actor, id, "changes_requested", row.status, updated.status);
    return updated;
  });
}

export async function approveTaxReturn(db: Db, actor: Actor, id: string) {
  const { taxReturn: row } = await loadTaxReturn(db, actor, id);
  requireAssignedReviewer(actor, row.reviewerId);
  if (row.status !== "ready_for_review" && row.status !== "under_review") {
    throw new ValidationError({ _form: ["Only a return awaiting review can be approved."] });
  }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxReturns).set({
      status: "awaiting_client_approval",
      reviewStatus: "approved",
      authorizationStatus: "requested",
      updatedAt: new Date(),
    }).where(and(eq(taxReturns.id, id), inFirm(taxReturns.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();
    await recordStatusChange(tx, actor, { entityType: "tax_return", entityId: id, clientId: row.clientId, from: row.status, to: updated.status });
    await appendTaxReturnHistory(tx, actor, id, "approved", row.status, updated.status);
    return updated;
  });
}

export async function recordTaxAuthorization(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "tax_returns", "file");
  const { outcome } = parseInput(taxAuthorizationRecordSchema, input);
  const { taxReturn: row } = await loadTaxReturn(db, actor, id);
  if (row.status !== "awaiting_client_approval" || row.reviewStatus !== "approved") {
    throw new ValidationError({ _form: ["The return must be approved by a reviewer before recording client authorization."] });
  }
  const status: TaxReturnStatus = outcome === "authorized" ? "approved" : "changes_required";
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxReturns).set({
      status,
      authorizationStatus: outcome,
      clientAuthorizedAt: outcome === "authorized" ? new Date() : null,
      updatedAt: new Date(),
    }).where(and(eq(taxReturns.id, id), inFirm(taxReturns.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();
    if (outcome === "declined" && row.preparationCaseId) await tx.update(taxPreparationCases)
      .set({ status: "changes_required", updatedAt: new Date() })
      .where(and(eq(taxPreparationCases.id, row.preparationCaseId), inFirm(taxPreparationCases.firmId, actor)));
    await recordStatusChange(tx, actor, { entityType: "tax_return", entityId: id, clientId: row.clientId, from: row.status, to: status });
    await appendTaxReturnHistory(tx, actor, id, `authorization_${outcome}`, row.status, status);
    return updated;
  });
}

export async function recordTaxFiling(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "tax_returns", "file");
  const data = parseInput(taxFilingRecordSchema, input);
  const { taxReturn: row } = await loadTaxReturn(db, actor, id);
  if (row.status !== "approved" || row.authorizationStatus !== "authorized") {
    throw new ValidationError({ _form: ["Reviewer approval and client authorization are required before filing can be recorded."] });
  }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxReturns).set({
      status: "filed",
      filingStatus: "filed",
      authorityStatus: "pending",
      filingDate: data.filingDate,
      submissionReference: data.submissionReference,
      updatedAt: new Date(),
    }).where(and(eq(taxReturns.id, id), inFirm(taxReturns.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();
    await recordStatusChange(tx, actor, { entityType: "tax_return", entityId: id, clientId: row.clientId, from: row.status, to: "filed" });
    await appendTaxReturnHistory(tx, actor, id, "filed", row.status, "filed", {
      filingDate: data.filingDate,
      submissionReference: data.submissionReference,
      authorityStatus: "pending",
    });
    return updated;
  });
}

export async function recordTaxAuthorityResponse(db: Db, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "tax_returns", "file");
  const data = parseInput(taxAuthorityResponseSchema, input);
  const { taxReturn: row } = await loadTaxReturn(db, actor, id);
  if (row.filingStatus !== "filed" || row.status !== "filed") {
    throw new ValidationError({ _form: ["Record an actual filing before recording the tax authority response."] });
  }
  const status: TaxReturnStatus = data.outcome;
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [updated] = await tx.update(taxReturns).set({
      status,
      filingStatus: data.outcome,
      authorityStatus: data.outcome,
      taxAuthorityResponse: data.response ?? null,
      updatedAt: new Date(),
    }).where(and(eq(taxReturns.id, id), inFirm(taxReturns.firmId, actor))).returning();
    if (!updated) throw new NotFoundError();
    await recordStatusChange(tx, actor, { entityType: "tax_return", entityId: id, clientId: row.clientId, from: row.status, to: status });
    await appendTaxReturnHistory(tx, actor, id, `authority_${data.outcome}`, row.status, status, {
      filingDate: row.filingDate,
      submissionReference: row.submissionReference,
      authorityStatus: data.outcome,
      authorityResponse: data.response ?? null,
    });
    return updated;
  });
}

export async function listTaxReturnDocuments(db: Db, actor: Actor, taxReturnId: string) {
  const { taxReturn: row } = await loadTaxReturn(db, actor, taxReturnId);
  return db.select({
    id: documents.id,
    fileName: documents.fileName,
    contentType: documents.contentType,
    sizeBytes: documents.sizeBytes,
    visibleToClient: documents.visibleToClient,
    createdAt: documents.createdAt,
  }).from(documents)
    .where(and(
      inFirm(documents.firmId, actor),
      eq(documents.clientId, row.clientId),
      row.engagementId ? eq(documents.engagementId, row.engagementId) : undefined,
      isNull(documents.deletedAt),
    ))
    .orderBy(desc(documents.createdAt))
    .limit(100);
}

export async function getTaxReturnHistory(db: Db, actor: Actor, id: string) {
  const { taxReturn: row } = await loadTaxReturn(db, actor, id);
  return db.select({
    id: taxReturnHistory.id,
    eventType: taxReturnHistory.eventType,
    previousStatus: taxReturnHistory.previousStatus,
    nextStatus: taxReturnHistory.nextStatus,
    filingDate: taxReturnHistory.filingDate,
    submissionReference: taxReturnHistory.submissionReference,
    authorityStatus: taxReturnHistory.authorityStatus,
    authorityResponse: taxReturnHistory.authorityResponse,
    createdAt: taxReturnHistory.createdAt,
    actorName: users.name,
  }).from(taxReturnHistory)
    .leftJoin(users, and(eq(users.id, taxReturnHistory.actorId), eq(users.firmId, taxReturnHistory.firmId)))
    .where(and(inFirm(taxReturnHistory.firmId, actor), eq(taxReturnHistory.taxReturnId, row.id)))
    .orderBy(desc(taxReturnHistory.createdAt))
    .limit(200);
}
