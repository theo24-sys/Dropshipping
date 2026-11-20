/**
 * Stages the deployable static site into ./dist for `wrangler deploy`.
 *
 * The repository keeps Supabase migrations, Edge Functions, tests and docs at
 * the root; only the browser files below should ever be uploaded publicly.
 * Run with: npm run build
 */
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "dist");

const STATIC_ENTRIES = ["assets", "data", "admin"];

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const files = await readdir(root, { withFileTypes: true });

  let htmlCount = 0;
  for (const entry of files) {
    if (entry.isFile() && entry.name.endsWith(".html")) {
      await cp(join(root, entry.name), join(out, entry.name));
      htmlCount += 1;
    }
  }

  for (const name of STATIC_ENTRIES) {
    const source = join(root, name);
    if (await isDirectory(source)) {
      await cp(source, join(out, name), { recursive: true });
    }
  }

  // Deliberately excluded: supabase/, node_modules/, .env, README, tests,
  // the Zip of this folder and anything else not served to a browser.

  console.log(`Staged ${htmlCount} HTML pages plus ${STATIC_ENTRIES.join(", ")} into dist/`);
}

main().catch((error) => {
  console.error("Build failed:", error);
  process.exitCode = 1;
});
