// Local rules run before HTTP. Flags are caller facts, never Jev's permission.
export const TIMEOUT_MS = 3000;
export const PROJECT_FLAGS = ["runtime_cutover", "native_semantics", "rust_cancellation", "contract_authorization", "state_ownership", "sidecar_execution"];
export function localPolicy(state, context, mode) {
  if (state.hard_risk_flags.length) return "hard_risk_flags";
  if (state.required_gate === "human") return "human_gate";
  if (!context || context.task !== state.task_id || !["active", "review"].includes(context.status) ||
      !["sol", "fast", "none"].includes(context.writer) || !["not_required", "required", "passed"].includes(context.human_gate)) return "context_unresolved";
  if (context.human_gate === "required") return "human_gate";
  if (context.writer === "fast") return "writer_owned_by_fast";
  if (mode === "route" && (state.current_stage === "review" || context.status === "review")) return "reviewer_authority";
  if (state.changed_areas.some(p => /^(src-tauri|src\/v2-runtime|packages\/(application|domain|contracts))(\/|$)/i.test(p))) return "project_hard_risk";
  return null;
}
