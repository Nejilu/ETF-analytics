import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function copyDirectory(source, target) {
  if (!existsSync(source)) return false;
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  return true;
}

export function prepareStandaloneAssets(projectRoot) {
  const standaloneRoot = resolve(projectRoot, ".next", "standalone");
  return {
    staticCopied: copyDirectory(
      resolve(projectRoot, ".next", "static"),
      resolve(standaloneRoot, ".next", "static"),
    ),
    publicCopied: copyDirectory(
      resolve(projectRoot, "public"),
      resolve(standaloneRoot, "public"),
    ),
  };
}
