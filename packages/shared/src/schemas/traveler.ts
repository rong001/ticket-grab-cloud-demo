import { z } from "zod";

export const travelerTypeSchema = z.enum(["adult", "child"]);
export const travelerRelationshipSchema = z.enum(["self", "authorized"]);

/** GB 11643-1999 checksum for 18-digit mainland ID cards. */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const;
const ID_CHECK_CHARS = "10X98765432";

export function chineseIdChecksumOk(idNumber: string): boolean {
  const cleaned = idNumber.trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(cleaned)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += Number(cleaned[i]) * ID_WEIGHTS[i]!;
  }
  return ID_CHECK_CHARS[sum % 11] === cleaned[17];
}

const baseTravelerFields = {
  name: z.string().min(1).max(64),
  idType: z.string().min(1).max(32).default("id_card"),
  idNumber: z
    .string()
    .min(4)
    .max(32)
    .regex(/^[A-Za-z0-9]+$/, "idNumber must be alphanumeric"),
  phone: z
    .string()
    .regex(/^1\d{10}$/, "phone must be a mainland mobile number")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  type: travelerTypeSchema.default("adult"),
  relationship: travelerRelationshipSchema.default("self"),
  authorizedConsent: z.boolean().optional().default(false),
};

function refineAuthorizedConsent(
  data: { relationship?: string; authorizedConsent?: boolean },
  ctx: z.RefinementCtx
) {
  if (data.relationship === "authorized" && data.authorizedConsent !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "代购乘车人须勾选授权同意（authorizedConsent=true）",
      path: ["authorizedConsent"],
    });
  }
}

export const createTravelerSchema = z.object(baseTravelerFields).superRefine(refineAuthorizedConsent);

export const updateTravelerSchema = z
  .object({
    name: baseTravelerFields.name.optional(),
    idType: z.string().min(1).max(32).optional(),
    idNumber: z
      .string()
      .min(4)
      .max(32)
      .regex(/^[A-Za-z0-9]+$/, "idNumber must be alphanumeric")
      .optional(),
    phone: baseTravelerFields.phone,
    type: travelerTypeSchema.optional(),
    relationship: travelerRelationshipSchema.optional(),
    authorizedConsent: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // Only enforce when relationship is being set to authorized (or remains implied).
    if (data.relationship === "authorized" && data.authorizedConsent !== true) {
      refineAuthorizedConsent(data, ctx);
    }
  });

export type CreateTravelerInput = z.infer<typeof createTravelerSchema>;
export type UpdateTravelerInput = z.infer<typeof updateTravelerSchema>;

/** Soft + checksum validation helpers used by unit tests and API. */
export function validateTravelerIdNumber(
  idType: string,
  idNumber: string
): { ok: true } | { ok: false; error: string } {
  const cleaned = idNumber.trim().toUpperCase();
  if (idType === "id_card") {
    if (/^\d{15}$/.test(cleaned)) {
      // Legacy 15-digit: format only (no checksum in GB11643-1999).
      return { ok: true };
    }
    if (!/^\d{17}[\dX]$/.test(cleaned)) {
      return { ok: false, error: "身份证号格式不正确（15 或 18 位）" };
    }
    if (!chineseIdChecksumOk(cleaned)) {
      return { ok: false, error: "身份证号校验位不正确（GB11643）" };
    }
    return { ok: true };
  }
  if (idType === "passport") {
    if (cleaned.length < 5 || cleaned.length > 18) {
      return { ok: false, error: "护照号长度不正确" };
    }
    return { ok: true };
  }
  if (cleaned.length < 4) {
    return { ok: false, error: "证件号过短" };
  }
  return { ok: true };
}

export function idNumberHint(idNumber: string): string {
  const s = idNumber.trim();
  if (s.length <= 4) return s;
  return `****${s.slice(-4)}`;
}

/** Public traveler DTO — never includes idNumber / idNumberEnc. */
export type PublicTraveler = {
  id: string;
  name: string;
  idType: string;
  idNumberHint: string | null;
  phone: string | null;
  type: string;
  relationship: string;
  authorizedConsent: boolean;
  authorizedConsentAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export function toPublicTraveler(row: {
  id: string;
  name: string;
  idType: string;
  idNumberHint: string | null;
  phone: string | null;
  type: string;
  relationship?: string | null;
  authorizedConsent?: boolean | null;
  authorizedConsentAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): PublicTraveler {
  return {
    id: row.id,
    name: row.name,
    idType: row.idType,
    idNumberHint: row.idNumberHint,
    phone: row.phone,
    type: row.type,
    relationship: row.relationship ?? "self",
    authorizedConsent: row.authorizedConsent === true,
    authorizedConsentAt: row.authorizedConsentAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Compact summary for grab/watch APIs. */
export function toTravelerSummary(row: {
  id: string;
  name: string;
  idNumberHint: string | null;
  relationship?: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    idNumberHint: row.idNumberHint,
    relationship: row.relationship ?? "self",
  };
}
