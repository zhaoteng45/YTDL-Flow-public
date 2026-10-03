import { describe, expect, it } from "vitest";
import { evaluate } from "../../scripts/agent-jev-gate.mjs";
import { localPolicy } from "../../scripts/lib/jev-decision-policy.mjs";
const state = { task_id: "TEST", goal: "Synthetic doc task", current_stage: "triage", changed_areas: ["docs"], required_gate: "review", hard_risk_flags: [] };
const context = { task: "TEST", status: "active", writer: "sol", human_gate: "not_required" };
describe("Jev local authority policy", () => {
  it.each(["runtime_cutover", "rust_cancellation", "git_write", "unknown"])("bypasses %s before HTTP", async flag => {
    let calls = 0;
    const result = await evaluate({ ...state, hard_risk_flags: [flag] }, { context, apiKey: "fixture", fetchImpl: async () => { calls++; throw new Error("must not call"); } });
    expect(calls).toBe(0); expect(result.status).toBe("bypass"); expect(result.authority).toBe("advisory_only");
  });
  it("retains Human Gate even if caller flags are empty", () => {
    expect(localPolicy(state, { ...context, human_gate: "required" }, "route")).toBe("human_gate");
  });
  it("keeps final review with Sol", () => {
    expect(localPolicy({ ...state, current_stage: "review" }, context, "route")).toBe("reviewer_authority");
  });
  it("blocks mismatched current task", () => {
    expect(localPolicy(state, { ...context, task: "OTHER" }, "route")).toBe("context_unresolved");
  });
  it("keeps Rust execution changes outside semantic routing", () => {
    expect(localPolicy({ ...state, changed_areas: ["src-tauri/src/state.rs"] }, context, "route")).toBe("project_hard_risk");
  });
  it("keeps Fast writer ownership", () => {
    expect(localPolicy(state, { ...context, writer: "fast" }, "evidence")).toBe("writer_owned_by_fast");
  });
  it("rejects incomplete response with a complete fallback envelope", async () => {
    const out = await evaluate(state, { context, apiKey: "fixture", fetchImpl: async () => new Response("{}") });
    expect(out.status).toBe("fallback"); expect(out.fallback).toBe("sol"); expect(out).not.toHaveProperty("autoContinue");
  });
});
