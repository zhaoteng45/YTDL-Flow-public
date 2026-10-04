#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

console.log("=== Agent Context & Skill Verification ===");
console.log(`Workspace : ${rootDir}`);

// 1. AGENTS.md
const agentsPath = path.join(rootDir, "AGENTS.md");
const hasAgents = fs.existsSync(agentsPath);
console.log(`AGENTS.md : ${hasAgents ? "✅ OK" : "❌ Missing"}`);

// 2. skills-lock.json
const lockPath = path.join(rootDir, "skills-lock.json");
let skillsCount = 0;
if (fs.existsSync(lockPath)) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
    skillsCount = Object.keys(lock.skills || {}).length;
    console.log(`Lockfile  : ✅ OK (${skillsCount} skills recorded)`);
  } catch {
    console.log("Lockfile  : ⚠️ Invalid JSON");
  }
} else {
  console.log("Lockfile  : ❌ Missing (skills-lock.json)");
}

// 3. .agents/skills inventory
const skillsDir = path.join(rootDir, ".agents", "skills");
let localSkills = [];
if (fs.existsSync(skillsDir)) {
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  localSkills = entries
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md")))
    .map((d) => d.name);
  console.log(`Skills Dir: ✅ ${localSkills.length} local skills found`);
} else {
  console.log("Skills Dir: ⚠️ Not found (.agents/skills)");
}

// 4. Routing doc
const routingPath = path.join(rootDir, "docs", "agents", "skill-routing.md");
const hasRouting = fs.existsSync(routingPath);
console.log(`Routing   : ${hasRouting ? "✅ OK (docs/agents/skill-routing.md)" : "❌ Missing"}`);

// 5. Jev collaboration gate (API key is optional; fallback-to-Sol is valid)
const jevGatePath = path.join(rootDir, "scripts", "agent-jev-gate.mjs");
const jevRoutingPath = path.join(rootDir, "docs", "agents", "jev-routing.md");
const hasJevGate = fs.existsSync(jevGatePath) && fs.existsSync(jevRoutingPath);

function detectJevApiKey() {
  if (process.env.TYPESAFE_API_KEY) {
    return { configured: true, source: "process env" };
  }

  if (process.platform === "win32") {
    try {
      const probe = Bun.spawnSync(
        [
          "powershell.exe",
          "-NoProfile",
          "-Command",
          "$u=[Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY','User'); $m=[Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY','Machine'); if($u -or $m){'CONFIGURED'}",
        ],
        { stdout: "pipe", stderr: "ignore" },
      );
      const output = new TextDecoder().decode(probe.stdout).trim();
      if (output === "CONFIGURED") {
        return {
          configured: true,
          source: "Windows persistent env (restart long-lived agents to inherit)",
        };
      }
    } catch {
      // Optional diagnostic only; failure keeps the safe fallback behavior.
    }
  }

  return { configured: false, source: "safe Sol fallback" };
}

const jevApiKey = detectJevApiKey();
console.log(
  `Jev Gate  : ${hasJevGate ? "✅ Installed" : "⚠️ Missing (optional; Sol fallback)"} | API ${jevApiKey.configured ? `configured [${jevApiKey.source}]` : `not configured [${jevApiKey.source}]`}`,
);

// 6. Lightweight collaboration STATUS
const statusPath = path.join(rootDir, ".ai-bridge", "STATUS.md");
const allowedStatus = new Set(["idle", "active", "review", "blocked", "done"]);
const allowedWriter = new Set(["sol", "principal", "fast", "none"]);
const allowedHumanGate = new Set(["not_required", "required", "passed"]);

function readStatus(file) {
  if (!fs.existsSync(file)) {
    throw new Error("missing .ai-bridge/STATUS.md");
  }

  const content = fs.readFileSync(file, "utf-8");
  const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!frontmatterMatch) {
    throw new Error("STATUS frontmatter is missing or malformed");
  }

  const data = {};
  for (const rawLine of frontmatterMatch[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new Error(`STATUS frontmatter line is not "key: value": ${line}`);
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || !value) {
      throw new Error(`STATUS frontmatter line is incomplete: ${line}`);
    }
    if (Object.hasOwn(data, key)) {
      throw new Error(`STATUS frontmatter contains duplicate field: ${key}`);
    }
    data[key] = value;
  }

  const required = ["task", "status", "writer", "human_gate", "updated_at"];
  for (const key of required) {
    if (typeof data[key] !== "string" || !data[key].trim()) {
      throw new Error(`STATUS field "${key}" is required and must be a non-empty string`);
    }
  }

  if (!allowedStatus.has(data.status)) {
    throw new Error(`STATUS field "status" has invalid value: ${data.status}`);
  }
  if (!allowedWriter.has(data.writer)) {
    throw new Error(`STATUS field "writer" has invalid value: ${data.writer}`);
  }
  if (!allowedHumanGate.has(data.human_gate)) {
    throw new Error(`STATUS field "human_gate" has invalid value: ${data.human_gate}`);
  }

  const body = content.slice(frontmatterMatch[0].length);
  if ([...body.matchAll(/^# Current Task[ \t]*\r?$/gm)].length !== 1) {
    throw new Error("STATUS must contain exactly one Current Task section");
  }
  const current = body.split(/^# Current Task[ \t]*\r?$/m)[1].split(/^# /m)[0];
  const workflowMatches = [...current.matchAll(/^Workflow:[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*([A-Za-z0-9][A-Za-z0-9_-]*)[ \t]*\r?$/gm)];
  if (workflowMatches.length !== 1) {
    throw new Error("STATUS Current Task must contain a fixed Workflow slot exactly once");
  }

  return {
    task: data.task.trim(),
    status: data.status,
    writer: data.writer,
    humanGate: data.human_gate,
    workflow: workflowMatches[0][1],
  };
}

let statusContext = null;
let statusError = null;
try {
  statusContext = readStatus(statusPath);
  console.log(
    `Context   : ✅ Task [${statusContext.task}] | Workflow [${statusContext.workflow}] | Status [${statusContext.status}] | Writer [${statusContext.writer}] | Human Gate [${statusContext.humanGate}]`,
  );
} catch (error) {
  statusError = error instanceof Error ? error.message : String(error);
  console.log(`Context   : ❌ ${statusError}`);
}

console.log("==========================================");
if (!hasAgents || !hasRouting || localSkills.length === 0 || statusError) {
  console.log("Status    : ❌ ACTION REQUIRED: Review missing or invalid configuration above.");
  process.exit(1);
}

console.log("Status    : 🚀 Ready. Use STATUS.md as the current collaboration authority.");

// Optional Jev interface inventory is not a product approval.
for (const file of ["scripts/agent-jev-gate.mjs", "scripts/lib/jev-decision-policy.mjs", "tests/agents/jev-gate.test.mjs"]) {
  if (!fs.existsSync(path.join(rootDir, file))) console.log("Jev optional file missing: " + file);
}
