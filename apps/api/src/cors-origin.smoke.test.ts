import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseCorsOriginAllowlist } from "./env.js";

describe("parseCorsOriginAllowlist", () => {
  it("splits comma list, trims, drops empty", () => {
    assert.deepEqual(
      parseCorsOriginAllowlist(
        "https://159.75.71.192:18444, https://159.75.71.192:18090, ,"
      ),
      ["https://159.75.71.192:18444", "https://159.75.71.192:18090"]
    );
  });

  it("rejects bare * and empty", () => {
    assert.deepEqual(parseCorsOriginAllowlist("*"), []);
    assert.deepEqual(parseCorsOriginAllowlist(""), []);
    assert.deepEqual(parseCorsOriginAllowlist("  , * , "), []);
  });
});

describe("CORS single matching Origin header", () => {
  let app: Awaited<ReturnType<typeof import("./app.js").buildApp>>;

  before(async () => {
    // env.corsOrigins already loaded from process.env at import time —
    // this suite expects CORS_ORIGIN set by the test runner script.
    const { buildApp } = await import("./app.js");
    const { env } = await import("./env.js");
    assert.ok(
      env.corsOrigins.length >= 2,
      `expected multi-origin allowlist for this smoke, got ${JSON.stringify(env.corsOrigins)}`
    );
    assert.ok(
      !env.corsOrigins.some((o) => o.includes(",")),
      "allowlist entries must not themselves contain commas"
    );
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it("Origin 18444 → ACAO exactly that one URL (never comma-joined)", async () => {
    const origin = "https://159.75.71.192:18444";
    const res = await app.inject({
      method: "OPTIONS",
      url: "/auth/register",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      },
    });
    const acao = res.headers["access-control-allow-origin"];
    assert.equal(acao, origin);
    assert.ok(typeof acao === "string" && !String(acao).includes(","));
  });

  it("Origin 18090 → ACAO exactly that one URL", async () => {
    const origin = "https://159.75.71.192:18090";
    const res = await app.inject({
      method: "OPTIONS",
      url: "/auth/register",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      },
    });
    assert.equal(res.headers["access-control-allow-origin"], origin);
  });

  it("unknown Origin → no / false ACAO (not comma-joined allowlist)", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/auth/register",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    const acao = res.headers["access-control-allow-origin"];
    assert.ok(
      acao === undefined || acao === false || acao === "false" || acao === null,
      `unexpected ACAO for unknown origin: ${JSON.stringify(acao)}`
    );
    if (typeof acao === "string") {
      assert.ok(!acao.includes(","), "must never echo comma-joined allowlist");
      assert.notEqual(acao, "https://evil.example");
    }
  });
});
