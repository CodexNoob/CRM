import { afterEach, describe, expect, it, vi } from "vitest";
import { dropboxSignConfig, dropboxSignProvider } from "@/integrations/dropbox-sign";

const API_KEY = "provider-test-api-key-012345";
const sendInput = {
  title: "Test engagement letter",
  subject: "Test engagement letter",
  message: "Please sign this test document.",
  signers: [{ name: "Test Signer", email: "signer@example.test", order: 1 }],
  file: { name: "engagement-letter.pdf", data: Buffer.from("%PDF-1.7"), contentType: "application/pdf" },
  testMode: true,
  metadata: { crm_request: "request-test-id" },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Dropbox Sign provider", () => {
  it("uses the server-side API key and sends test_mode=1 without exposing the key in config", async () => {
    vi.stubEnv("DROPBOX_SIGN_API_KEY", API_KEY);
    vi.stubEnv("DROPBOX_SIGN_TEST_MODE", "1");
    vi.stubEnv("DROPBOX_SIGN_ENABLED", "1");

    let url = "";
    let authorization: string | null = null;
    let testMode: FormDataEntryValue | null = null;
    const provider = dropboxSignProvider(async (input, init) => {
      url = String(input);
      authorization = new Headers(init?.headers).get("authorization");
      testMode = (init?.body as FormData).get("test_mode");
      return Response.json({
        signature_request: {
          signature_request_id: "sr_test",
          signatures: [{ signature_id: "sig_test", signer_email_address: "signer@example.test", status_code: "awaiting_signature" }],
        },
      });
    });

    const result = await provider.send({ ...sendInput, testMode: provider.testMode });

    expect(dropboxSignConfig()).toMatchObject({ isConfigured: true, isEnabled: true, testMode: true });
    expect(dropboxSignConfig()).not.toHaveProperty("apiKey");
    expect(url).toBe("https://api.hellosign.com/v3/signature_request/send");
    expect(authorization).toBe(`Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}`);
    expect(testMode).toBe("1");
    expect(result).toEqual({
      providerRequestId: "sr_test",
      signatures: [{ signatureId: "sig_test", email: "signer@example.test", statusCode: "awaiting_signature" }],
    });
  });

  it("redacts the API key from provider error messages", async () => {
    vi.stubEnv("DROPBOX_SIGN_API_KEY", API_KEY);
    const provider = dropboxSignProvider(async () =>
      Response.json({ error: { error_msg: `Invalid credentials: ${API_KEY}` } }, { status: 401 }),
    );

    await expect(provider.send(sendInput)).rejects.toThrow("Invalid credentials: [redacted]");
  });
});
