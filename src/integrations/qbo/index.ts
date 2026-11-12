import { IntegrationNotConfiguredError } from "@/lib/errors";

/**
 * QuickBooks Online integration BOUNDARY — NOT IMPLEMENTED.
 *
 * QBO is the system of record for invoices and payments. This module defines
 * the interface the CRM will use; every call currently throws
 * IntegrationNotConfiguredError so no caller can mistake it for real data.
 * See README "QuickBooks Online" for the setup and next steps.
 */

export interface InvoiceSummary {
  qboInvoiceId: string;
  docNumber: string | null;
  totalAmountCents: number;
  balanceCents: number;
  dueDate: string | null;
  status: "open" | "paid" | "overdue" | "voided";
  /** QBO-hosted payment page; card data never touches this app. */
  paymentUrl: string | null;
}

export interface AccountingProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  /** Invoices for the QBO customer linked to a CRM client. */
  listInvoices(qboCustomerId: string): Promise<InvoiceSummary[]>;
}

export interface QboConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  environment?: string;
}

class UnavailableQboProvider implements AccountingProvider {
  readonly name = "QuickBooks Online";
  readonly isConfigured = false;
  constructor(private readonly reason: string) {}
  async listInvoices(): Promise<InvoiceSummary[]> {
    throw new IntegrationNotConfiguredError(this.name, this.reason);
  }
}

export function getAccountingProvider(config: QboConfig = readQboConfig()): AccountingProvider {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    return new UnavailableQboProvider("QBO app credentials are not configured.");
  }
  // Credentials alone are not enough: the OAuth connect flow, encrypted token
  // storage and the API client have not been built yet.
  return new UnavailableQboProvider("the QBO connection has not been implemented yet.");
}

function readQboConfig(): QboConfig {
  return {
    clientId: process.env.QBO_CLIENT_ID || undefined,
    clientSecret: process.env.QBO_CLIENT_SECRET || undefined,
    redirectUri: process.env.QBO_REDIRECT_URI || undefined,
    environment: process.env.QBO_ENVIRONMENT || undefined,
  };
}
