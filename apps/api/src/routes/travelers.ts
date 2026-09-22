import type { FastifyInstance } from "fastify";
import {
  createTravelerSchema,
  idNumberHint,
  updateTravelerSchema,
  validateTravelerIdNumber,
} from "@ticket-grab/shared";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../lib/auth.js";
import { logActivity } from "../lib/activity.js";
import { encryptSensitive } from "../lib/crypto.js";

function publicTraveler(row: {
  id: string;
  name: string;
  idType: string;
  idNumberHint: string | null;
  phone: string | null;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    idType: row.idType,
    idNumberHint: row.idNumberHint,
    phone: row.phone,
    type: row.type,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function travelerRoutes(app: FastifyInstance) {
  app.get("/travelers", {
    schema: { tags: ["travelers"], security: [{ bearerAuth: [] }] },
  }, async (request) => {
    const user = await authenticate(request);
    const rows = await prisma.traveler.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(publicTraveler);
  });

  app.post("/travelers", {
    schema: { tags: ["travelers"], summary: "Create traveler", security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const body = createTravelerSchema.parse(request.body);
    const idCheck = validateTravelerIdNumber(body.idType, body.idNumber);
    if (!idCheck.ok) return reply.code(400).send({ error: idCheck.error });

    const row = await prisma.traveler.create({
      data: {
        userId: user.sub,
        name: body.name,
        idType: body.idType,
        idNumberEnc: encryptSensitive(body.idNumber.trim().toUpperCase()),
        idNumberHint: idNumberHint(body.idNumber),
        phone: body.phone,
        type: body.type,
      },
    });
    await logActivity(user.sub, user.email, "traveler_create", `Added traveler ${body.name}`, {
      travelerId: row.id,
    });
    return reply.code(201).send(publicTraveler(row));
  });

  app.patch("/travelers/:id", {
    schema: { tags: ["travelers"], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = await authenticate(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.traveler.findFirst({ where: { id, userId: user.sub } });
    if (!existing) return reply.code(404).send({ error: "Not found" });
    const body = updateTravelerSchema.parse(request.body ?? {});

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.idType !== undefined) data.idType = body.idType;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.type !== undefined) data.type = body.type;
    if (body.idNumber !== undefined) {
      const idType = (body.idType ?? existing.idType) as string;
      const idCheck = validateTravelerIdNumber(idType, body.idNumber);
      if (!idCheck.ok) return reply.code(400).send({ error: idCheck.error });
      data.idNumberEnc = encryptSensitive(body.idNumber.trim().toUpperCase());
      data.idNumberHint = idNumberHint(body.idNumber);
    }

    const row = await prisma.traveler.update({ where: { id }, data });
    return publicTraveler(row);
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

