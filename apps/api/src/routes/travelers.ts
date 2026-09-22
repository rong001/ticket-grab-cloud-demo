import type { FastifyInstance } from "fastify";
import {
  createTravelerSchema,
  idNumberHint,
  toPublicTraveler,
  updateTravelerSchema,
  validateTravelerIdNumber,
} from "@ticket-grab/shared";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { logActivity } from "../lib/activity.js";
import { encryptSensitive } from "../lib/crypto.js";

export async function travelerRoutes(app: FastifyInstance) {
  app.get("/travelers", {
    schema: { tags: ["travelers"], security: [{ bearerAuth: [] }] },
  }, async (request) => {
    const user = await authenticate(request);
    const rows = await prisma.traveler.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toPublicTraveler);
  });

  app.post("/travelers", {
    schema: { tags: ["travelers"], summary: "Create traveler", security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    let body;
    try {
      body = createTravelerSchema.parse(request.body);
    } catch (err: unknown) {
      const zerr = err as { errors?: { message?: string }[]; message?: string };
      const msg =
        zerr?.errors?.[0]?.message ||
        (err instanceof Error ? err.message : "Invalid traveler payload");
      return reply.code(400).send({ error: msg });
    }
    const idCheck = validateTravelerIdNumber(body.idType, body.idNumber);
    if (!idCheck.ok) return reply.code(400).send({ error: idCheck.error });

    if (body.relationship === "authorized" && body.authorizedConsent !== true) {
      return reply.code(400).send({ error: "代购乘车人须勾选授权同意" });
    }

    const consentAt =
      body.relationship === "authorized" && body.authorizedConsent === true
        ? new Date()
        : null;

    const row = await prisma.traveler.create({
      data: {
        userId: user.sub,
        name: body.name,
        idType: body.idType,
        idNumberEnc: encryptSensitive(body.idNumber.trim().toUpperCase()),
        idNumberHint: idNumberHint(body.idNumber),
        phone: body.phone,
        type: body.type,
        relationship: body.relationship,
        authorizedConsent: body.authorizedConsent === true,
        authorizedConsentAt: consentAt,
      },
    });
    await logActivity(user.sub, user.email, "traveler_create", `Added traveler ${body.name}`, {
      travelerId: row.id,
      relationship: row.relationship,
    });
    return reply.code(201).send(toPublicTraveler(row));
  });

  app.patch("/travelers/:id", {
    schema: { tags: ["travelers"], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.traveler.findFirst({ where: { id, userId: user.sub } });
    if (!existing) return reply.code(404).send({ error: "Not found" });

    let body;
    try {
      body = updateTravelerSchema.parse(request.body ?? {});
    } catch (err: unknown) {
      const zerr = err as { errors?: { message?: string }[]; message?: string };
      const msg =
        zerr?.errors?.[0]?.message ||
        (err instanceof Error ? err.message : "Invalid traveler payload");
      return reply.code(400).send({ error: msg });
    }

    const nextRelationship = body.relationship ?? existing.relationship;
    const nextConsent =
      body.authorizedConsent !== undefined
        ? body.authorizedConsent === true
        : existing.authorizedConsent;
    if (nextRelationship === "authorized" && nextConsent !== true) {
      return reply.code(400).send({ error: "代购乘车人须勾选授权同意" });
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.idType !== undefined) data.idType = body.idType;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.type !== undefined) data.type = body.type;
    if (body.relationship !== undefined) data.relationship = body.relationship;
    if (body.authorizedConsent !== undefined) {
      data.authorizedConsent = body.authorizedConsent === true;
      if (body.authorizedConsent === true) {
        data.authorizedConsentAt = existing.authorizedConsentAt ?? new Date();
      } else {
        data.authorizedConsentAt = null;
      }
    } else if (body.relationship === "authorized" && !existing.authorizedConsentAt && nextConsent) {
      data.authorizedConsentAt = new Date();
    }
    if (body.idNumber !== undefined) {
      const idType = (body.idType ?? existing.idType) as string;
      const idCheck = validateTravelerIdNumber(idType, body.idNumber);
      if (!idCheck.ok) return reply.code(400).send({ error: idCheck.error });
      data.idNumberEnc = encryptSensitive(body.idNumber.trim().toUpperCase());
      data.idNumberHint = idNumberHint(body.idNumber);
    }

    const row = await prisma.traveler.update({ where: { id }, data });
    return toPublicTraveler(row);
  });

  app.delete("/travelers/:id", {
    schema: { tags: ["travelers"], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.traveler.findFirst({ where: { id, userId: user.sub } });
    if (!existing) return reply.code(404).send({ error: "Not found" });
    await prisma.traveler.delete({ where: { id } });
    return { ok: true, id };
  });
}
