import { z } from "zod";

export const travelerTypeSchema = z.enum(["adult", "child"]);

export const createTravelerSchema = z.object({
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
});

export const updateTravelerSchema = createTravelerSchema.partial();

export type CreateTravelerInput = z.infer<typeof createTravelerSchema>;
export type UpdateTravelerInput = z.infer<typeof updateTravelerSchema>;

/** Soft validation helpers used by unit tests and API. */
export function validateTravelerIdNumber(idType: string, idNumber: string): { ok: true } | { ok: false; error: string } {
  const cleaned = idNumber.trim().toUpperCase();
  if (idType === "id_card") {
    if (!/^\d{17}[\dX]$/.test(cleaned) && !/^\d{15}$/.test(cleaned)) {
      return { ok: false, error: "身份证号格式不正确（15 或 18 位）" };
    }
  } else if (cleaned.length < 4) {
    return { ok: false, error: "证件号过短" };
  }
  return { ok: true };
}

export function idNumberHint(idNumber: string): string {
  const s = idNumber.trim();
  if (s.length <= 4) return s;
  return `****${s.slice(-4)}`;
}
