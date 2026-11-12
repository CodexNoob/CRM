import { ValidationError } from "@/lib/errors";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Allowed file types. The content type is decided by US from the extension and
 * verified against the file's leading bytes; the browser's claimed type is ignored.
 */
const TYPES: Record<string, { type: string; check: (b: Buffer) => boolean }> = {
  pdf: { type: "application/pdf", check: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  png: { type: "image/png", check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { type: "image/jpeg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { type: "image/jpeg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  heic: { type: "image/heic", check: (b) => b.subarray(4, 8).toString("latin1") === "ftyp" },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: isZip },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: isZip },
  csv: { type: "text/csv", check: isPlainText },
  txt: { type: "text/plain", check: isPlainText },
};

export const ALLOWED_EXTENSIONS = Object.keys(TYPES);
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

function isZip(b: Buffer) {
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

function isPlainText(b: Buffer) {
  const head = b.subarray(0, 4096);
  return !head.includes(0);
}

/** Strips paths and control characters; keeps a readable, safe display name. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // Control characters are matched on purpose: they must never reach headers or the UI.
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "file";
  if (cleaned.length <= 150) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 150 - ext.length) + ext;
}

export function checkFile(name: string, data: Buffer): { fileName: string; contentType: string } {
  const fileName = safeFileName(name);
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const rule = TYPES[ext];
  if (data.length === 0) throw new ValidationError({ file: ["The file is empty."] });
  if (data.length > MAX_UPLOAD_BYTES) throw new ValidationError({ file: ["Files must be 25 MB or smaller."] });
  if (!rule) throw new ValidationError({ file: [`This file type isn’t allowed. Use: ${ALLOWED_EXTENSIONS.join(", ")}.`] });
  if (!rule.check(data)) throw new ValidationError({ file: ["The file’s contents don’t match its type. Please upload the original file."] });
  return { fileName, contentType: rule.type };
}
