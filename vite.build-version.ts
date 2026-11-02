import { execSync } from "node:child_process";
import { formatBuildStamp } from "./src/lib/buildStamp";

export function resolveGitSha(): string {
  const fromEnv = (process.env.GITHUB_SHA || process.env.VITE_GIT_SHA || "").trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

export function currentBuildVersion(at = new Date()): string {
  return formatBuildStamp(resolveGitSha(), at);
}
