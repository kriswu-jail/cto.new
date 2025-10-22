import request from "supertest";
import app from "../src/server.js";
import { JobTypes } from "../src/types.js";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe("REST API", () => {
  test("enqueue, status polling, and cancel", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send({ type: JobTypes.OCR, payload: { delayMs: 20 } })
      .expect(202);
    const id = res.body.id;
    expect(id).toBeTruthy();

    // Immediately fetch status
    const s1 = await request(app).get(`/api/jobs/${id}`).expect(200);
    expect(s1.body.status).toBeDefined();

    // Wait until it's running or completed
    let status = s1.body.status;
    let tries = 0;
    while (!['running','completed','failed','cancelled'].includes(status) && tries < 50) {
      await sleep(20);
      const s = await request(app).get(`/api/jobs/${id}`);
      status = s.body.status;
      tries++;
    }

    // Cancel it
    const c = await request(app).delete(`/api/jobs/${id}`).expect(200);
    expect(c.body.id).toBe(id);

    // Final state should be cancelled or completed if finished fast
    const s2 = await request(app).get(`/api/jobs/${id}`).expect(200);
    expect(["cancelled", "completed", "failed", "timed_out"]).toContain(s2.body.status);
  });

  test("rejects unsupported job type", async () => {
    await request(app).post("/api/jobs").send({ type: "Unknown Type" }).expect(400);
  });

  test("health endpoints expose queue state", async () => {
    const health = await request(app).get("/health").expect(200);
    expect(health.body.status).toBe("ok");
    const status = await request(app).get("/status").expect(200);
    expect(status.body).toHaveProperty("concurrency");
    expect(status.body).toHaveProperty("counts");
  });
});
