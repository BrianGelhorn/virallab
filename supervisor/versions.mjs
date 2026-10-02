// Versionado: produccion en main, candidato en worktree aislado, activacion por merge,
// rollback por reset al tag previo. n8n corre sobre el dir principal: el worktree
// nunca interfiere con produccion en curso.
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "../lib/config.mjs";

const ROOT = config.root;
const git = (cmd, cwd = ROOT) => execSync(`git ${cmd}`, { cwd, encoding: "utf8", timeout: 60000 }).trim();

export function workdir(date) {
  return resolve(ROOT, `evo/${date}`);
}

export function startCandidate(date) {
  const dir = workdir(date);
  try { execSync(`git worktree remove "${dir}" --force`, { cwd: ROOT, timeout: 30000 }); } catch {}
  try { execSync(`git branch -D evo/${date}`, { cwd: ROOT, timeout: 30000 }); } catch {}
  execSync(`git worktree add "${dir}" -b evo/${date}`, { cwd: ROOT, timeout: 60000 });
  return dir;
}

export function candidateDiff(date) {
  const out = execSync(`git diff --name-only main...evo/${date}`, { cwd: ROOT, encoding: "utf8", timeout: 30000 }).trim();
  return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

// Commits por delante de main. Un candidato con 0 commits es un no-op: no se activa.
export function aheadCount(date) {
  try {
    return Number(execSync(`git rev-list --count main..evo/${date}`, { cwd: ROOT, encoding: "utf8", timeout: 30000 }).trim()) || 0;
  } catch { return 0; }
}

export function commitCandidate(date, msg) {
  execSync(`git add -A`, { cwd: workdir(date), timeout: 30000 });
  const st = execSync(`git status --porcelain`, { cwd: workdir(date), encoding: "utf8", timeout: 30000 }).trim();
  if (!st) return { committed: false };
  execSync(`git -c user.name=virallab -c user.email=virallab@local commit -m ${JSON.stringify(`evo: ${msg}`)}`, { cwd: workdir(date), timeout: 60000 });
  return { committed: true };
}

// Activa: tag previo, merge a main, tag activo. Solo si el worktree esta commiteado.
export function activate(date) {
  try { git(`tag -f vl-prev vl-active`); } catch {}
  try { git(`rev-parse vl-active`); } catch { git(`tag vl-active main`); git(`tag -f vl-prev main`); }
  git(`checkout main --quiet`);
  git(`merge --no-ff evo/${date} -m "activate evo ${date}" --quiet`);
  const sha = git(`rev-parse --short HEAD`);
  git(`tag -f vl-active`);
  return { sha };
}

export function rollback() {
  const prev = git(`rev-parse vl-prev`);
  git(`checkout main --quiet`);
  git(`reset --hard ${prev} --quiet`);
  git(`tag -f vl-active vl-prev`);
  return { sha: git(`rev-parse --short HEAD`), restored: prev.slice(0, 7) };
}

export function activeVersion() {
  try { return { tag: "vl-active", sha: git(`rev-parse --short vl-active`) }; }
  catch { return { tag: null, sha: git(`rev-parse --short main`) }; }
}

export function cleanup(date) {
  try { execSync(`git worktree remove "${workdir(date)}" --force`, { cwd: ROOT, timeout: 30000 }); } catch {}
  try { execSync(`git worktree prune`, { cwd: ROOT, timeout: 30000 }); } catch {}
  // La rama tambien se borra: si no, un proximo run "reanuda" una rama muerta.
  try { execSync(`git branch -D evo/${date}`, { cwd: ROOT, timeout: 30000 }); } catch {}
}

// Reatacha un worktree a una rama candidata existente (resume tras crash/timeout).
export function reattach(date) {
  const dir = workdir(date);
  try { execSync(`git worktree add "${dir}" evo/${date}`, { cwd: ROOT, timeout: 60000 }); } catch {}
  return dir;
}

export function branchExists(date) {
  try {
    execSync(`git rev-parse --verify evo/${date}`, { cwd: ROOT, timeout: 15000 });
    return true;
  } catch { return false; }
}
