import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../server.js";
import { setupTestDB, teardownTestDB } from "./setup.js";

await setupTestDB();

describe("health", () => {
  it("GET /api/health -> ok", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });
});

after(async () => { await teardownTestDB(); });