import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluate } from "../../scripts/agent-jev-gate.mjs";
import { PROJECT_FLAGS } from "../../scripts/lib/jev-decision-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const state = { task_id: "JEV-TEST", goal: "Classify a synthetic public documentation spelling task",
  current_stage: "triage", changed_areas: ["docs"], required_gate: "review", hard_risk_flags: [] };
const context = { task: "JEV-TEST", status: "active", writer: "sol", human_gate: "not_required" };
const valid = { model: "jev-test", usage: { input_tokens: 3, output_tokens: 2 },
  answers: { route: { type: "choice", choice: "fast_a", confidence: 0.8,
    probabilities: { sol: 0.1, fast_a: 0.8, fast_b: 0.1 } } } };
const response = (v = valid) => new Response(JSON.stringify(v));
const run = (value = state, options = {}) => evaluate(value, { context, apiKey: "fixture-key-only", fetchImpl: async () => response(), ...options });
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-gate-test-"));
  try {
    for (const f of ["scripts/agent-jev-gate.mjs", "scripts/lib/jev-decision-policy.mjs"]) {
      fs.mkdirSync(path.dirname(path.join(dir,f)), { recursive:true });
      fs.copyFileSync(path.join(root,f), path.join(dir,f));
    }
    fs.mkdirSync(path.join(dir, ".ai-bridge"));
    fs.writeFileSync(path.join(dir, ".ai-bridge/STATUS.md"), "---\ntask: JEV-TEST\nstatus: active\nwriter: sol\nhuman_gate: not_required\nupdated_at: 2026-09-21\n---\n");
    fs.mkdirSync(path.join(dir, ".scratch/jev"), { recursive: true });
    const call = (args = [], input = JSON.stringify(state), env = {}) => {
      const r = spawnSync("bun", ["--no-env-file", "scripts/agent-jev-gate.mjs", ...args], {
        cwd: dir, input, encoding:"utf8", timeout:20000, env: { ...process.env, TYPESAFE_API_KEY:"", ...env } });
      assert.equal(r.error, undefined);
      return { code:r.status, data:JSON.parse(r.stdout), stdout:r.stdout, stderr:r.stderr };
    };
    return fn(dir, call);
  } finally {
    assert.equal(path.dirname(dir), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("jev-gate-test-"));
    fs.rmSync(dir, { recursive:true, force:true });
  }
}
test("missing key is an optional successful Sol fallback, including real CLI", async () => {
  const out = await run(state,{apiKey:""});
  assert.equal(out.status,"fallback"); assert.deepEqual(out.reasons,["missing_api_key"]); assert.equal(out.api_called,false);
  fixture((dir,call)=>{const r=call();assert.equal(r.code,0);assert.equal(r.data.authority,"advisory_only");assert.equal(r.data.fallback,"sol");});
});
test("hard flags including unknown/project-specific values never call HTTP", async () => {
  for(const flag of ["git_write","writer_unconfirmed","human_gate","scope_expansion","important_dependency","irreversible_operation","secrets_or_credentials","reviewer_authority","unknown_future_flag",...PROJECT_FLAGS]){
    let calls=0;const out=await run({...state,hard_risk_flags:[flag]},{fetchImpl:async()=>{calls++;return response();}});
    assert.equal(out.status,"bypass"); assert.equal(calls,0); assert.equal(out.api_called,false);
  }
});
test("Human Gate cannot be cleared by empty flags, and writer/context remain local", async () => {
  for(const [value,ctx] of [[{...state,required_gate:"human"},context],[state,{...context,human_gate:"required"}],[state,{...context,writer:"fast"}],[state,{...context,task:"OTHER"}],[state,null],[state,{...context,status:"idle"}]]){
    let called=false;const out=await run(value,{context:ctx,fetchImpl:async()=>{called=true;return response();}});
    assert.equal(out.status,"bypass");assert.equal(called,false);assert.ok(!("autoContinue" in out));
  }
});
test("valid response is advice only; only minimum summaries are sent", async () => {
  let request;
  const out=await run(state,{fetchImpl:async(url,init)=>{assert.equal(url,"https://api.typesafe.ai/v1/systemone");assert.equal(init.redirect,"error");request=JSON.parse(init.body);return response();}});
  assert.equal(out.status,"advisory");assert.equal(out.authority,"advisory_only");
  assert.deepEqual(Object.keys(request.state).sort(),["changed_areas","current_stage","goal"]);
  assert.ok(!("requireGpt6" in out));assert.ok(!("autoContinue" in out));
});
test("invalid or incomplete typed response always falls back", async () => {
  const cases=[{}, {...valid,answers:{}}, {...valid,model:"jev-latest\nunsafe"}, {...valid,usage:{}},
    {...valid,answers:{route:{...valid.answers.route,choice:"git_write"}}},
    {...valid,answers:{route:{...valid.answers.route,type:"noul"}}},
    {...valid,answers:{route:{...valid.answers.route,confidence:99}}},
    {...valid,answers:{route:{...valid.answers.route,probabilities:{sol:0,fast_a:-1,fast_b:2}}}},
    {...valid,answers:{route:{...valid.answers.route,probabilities:{sol:0,fast_a:0.8}}}},
    {...valid,answers:{route:{...valid.answers.route,probabilities:{sol:0.1,fast_a:0.8,fast_b:0.11}}}},
    {...valid,answers:{route:{...valid.answers.route,choice:"sol"}}}];
  for(const payload of cases){const out=await run(state,{fetchImpl:async()=>response(payload)});assert.equal(out.status,"fallback");assert.equal(out.fallback,"sol");}
  const out=await run(state,{fetchImpl:async()=>new Response("RAW_BODY_SYNTHETIC_MARKER")});
  assert.equal(out.status,"fallback");assert.ok(!JSON.stringify(out).includes("RAW_BODY"));
});
test("evidence mode requires evidence and never grants review approval", async () => {
  assert.equal((await run(state,{mode:"evidence"})).exit_code,2);
  const input={...state,evidence:["Synthetic spelling check passed"]};
  for(const noul of [-1,1.1,null]) assert.equal((await run(input,{mode:"evidence",fetchImpl:async()=>response({...valid,answers:{evidence_readiness:{type:"noul",noul}}})})).status,"fallback");
  const out=await run(input,{mode:"evidence",fetchImpl:async()=>response({...valid,answers:{evidence_readiness:{type:"noul",noul:0.7}}})});
  assert.deepEqual(out.decision,{evidence_readiness:0.7});assert.equal(out.confidence,null);assert.equal(out.authority,"advisory_only");
});
test("HTTP errors, timeout, oversized response and transport errors do not leak or retry", async () => {
  for(const status of [401,429,529]){
    let calls=0;const out=await run(state,{fetchImpl:async()=>{calls++;return new Response("ERROR_BODY_MARKER",{status});}});
    assert.equal(out.status,"fallback");assert.equal(calls,1);assert.ok(!JSON.stringify(out).includes("ERROR_BODY"));
  }
  const thrown=await run(state,{fetchImpl:async()=>{throw new Error("PRIVATE_ERROR_MARKER");}});
  assert.ok(!JSON.stringify(thrown).includes("PRIVATE_ERROR"));
  const timeout=await run(state,{timeoutMs:10,fetchImpl:async(u,{signal})=>new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("abort"))))});
  assert.deepEqual(timeout.reasons,["timeout"]);
  const over=await run(state,{fetchImpl:async()=>new Response("x".repeat(32769))});
  assert.equal(over.status,"fallback");assert.equal(over.limit.limit,32768);
});
test("secret-shaped content is rejected before HTTP and is absent from output", async () => {
  for(const marker of ["Cookie: session=FAKE_MARKER",'{"token":"FAKE_MARKER"}',"Authorization: Bearer FAKE_MARKER","password=FAKE_MARKER","-----BEGIN PRIVATE KEY-----","fixture-key-only"]){
    let calls=0;const out=await run({...state,evidence:[marker]},{fetchImpl:async()=>{calls++;return response();}});
    assert.equal(calls,0);assert.equal(out.exit_code,2);assert.ok(!JSON.stringify(out).includes(marker));
  }
});
test("input is strict and no hidden source-file loading is allowed",async()=>{
  for(const input of [{...state,hard_risk_flags:undefined},{...state,goal:{}},{...state,extra:"data"},{...state,changed_areas:["../source"]}]){
    assert.equal((await run(input,{dryRun:true})).exit_code,2);
  }
});
test("CLI dry-run, path safety, UTF-8 size boundaries and args",()=>{
  fixture((dir,call)=>{
    assert.equal(call(["--dry-run"]).data.status,"dry_run");
    const json=JSON.stringify({...state,goal:"合成任务"});
    const exact=json+" ".repeat(32768-Buffer.byteLength(json));
    assert.equal(call(["--dry-run"],exact).code,0);
    const large=call(["--dry-run"],exact+" ");
    assert.equal(large.code,2);assert.equal(large.data.limit.actual_bytes,32769);
    for(const file of ["../outside.json","AGENTS.md",path.join(dir,"state.json"),".scratch/jev/../x.json",".scratch/jev/NUL:stream.json","\\\\server\\share\\x.json"]){
      assert.equal(call(["--input",file,"--dry-run"]).data.reasons[0],"input_path");
    }
    fs.writeFileSync(path.join(dir,".scratch/jev/state.json"),json);
    assert.equal(call(["--input",".scratch/jev/state.json","--dry-run"]).data.status,"dry_run");
    assert.equal(call(["--state-file",".scratch/jev/state.json","--dry-run"]).code,0);
    assert.equal(call(["--mode","invalid"]).code,2);
    assert.equal(call(["--input"]).code,2);
    assert.equal(call(["--dry-run","--dry-run"]).code,2);
    assert.ok(!call(["--dry-run"],JSON.stringify({...state,evidence:["Cookie: session=FAKE_MARKER"]})).stdout.includes("FAKE_MARKER"));
  });
});
test("directory reparse point cannot turn allowed input into an outside read",()=>{
  fixture((dir,call)=>{
    const link=path.join(dir,".scratch/jev/link");
    fs.symlinkSync(path.join(dir,".ai-bridge"),link,"junction");
    try{assert.equal(call(["--input",".scratch/jev/link/state.json","--dry-run"]).data.reasons[0],"input_path");}
    finally{fs.unlinkSync(link);}
  });
});
test("live synthetic smoke through this project's CLI in an isolated fixture", {skip:process.env.JEV_LIVE_SMOKE!=="1"},()=>{
  assert.ok(process.env.TYPESAFE_API_KEY);
  fixture((dir,call)=>{
    const r=call([],JSON.stringify(state),{TYPESAFE_API_KEY:process.env.TYPESAFE_API_KEY});
    assert.equal(r.code,0);assert.equal(r.data.status,"advisory");assert.match(r.data.model,/^jev-/);
    console.log(JSON.stringify({live_model:r.data.model,usage:r.data.usage,authority:r.data.authority}));
  });
});
