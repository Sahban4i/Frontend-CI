import { describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../server.js";
import { setupTestDB } from "./setup.js";

await setupTestDB();

let token;

describe("auth + summaries", () => {
  it("register", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "a@b.com", password: "secret1" });
    assert.equal(res.status, 201);
    token = res.body.token;
    assert.ok(token);
  });

  it("create summary (auth)", async () => {
    const res = await request(app)
      .post("/api/summaries")
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "hello world", summary: "hello", tags: ["t1"] });
    assert.equal(res.status, 201);
    assert.equal(res.body.summary, "hello");
  });
});