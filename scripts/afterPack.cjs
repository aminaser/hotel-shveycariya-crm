const { existsSync, mkdirSync, cpSync, rmSync } = require("fs");
const { execSync } = require("child_process");
const path = require("path");

/**
 * electron-builder skips gitignored paths (backend/runtime*, backend/.env).
 * Copy the correct portable Python + .env into resources after pack.
 */
exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName; // darwin | win32 | linux
  const projectDir = context.packager.projectDir;
  const appName = context.packager.appInfo.productFilename;

  let backendDest;
  if (platform === "darwin") {
    backendDest = path.join(
      context.appOutDir,
      `${appName}.app`,
      "Contents",
      "Resources",
      "backend",
    );
  } else {
    // Windows / Linux unpacked layout
    backendDest = path.join(context.appOutDir, "resources", "backend");
  }

  const srcEnv = path.join(projectDir, "backend", ".env");
  const srcRuntime =
    platform === "win32"
      ? path.join(projectDir, "backend", "runtime-win")
      : path.join(projectDir, "backend", "runtime");
  const destRuntime = path.join(backendDest, "runtime");

  mkdirSync(backendDest, { recursive: true });

  if (!existsSync(srcRuntime)) {
    const hint =
      platform === "win32"
        ? "npm run prepare:runtime:win"
        : "npm run prepare:runtime";
    throw new Error(`Missing ${srcRuntime}. Run: ${hint}`);
  }

  console.log(`[afterPack] Copying portable Python (${platform})…`);
  rmSync(destRuntime, { recursive: true, force: true });

  if (platform === "darwin") {
    // Dereference symlinks so the .app is portable to other Macs.
    execSync(`cp -aL "${srcRuntime}" "${destRuntime}"`, { stdio: "inherit" });
    const py = path.join(destRuntime, "bin", "python3");
    const link = execSync(`readlink "${py}" || true`).toString().trim();
    if (link.startsWith("/Users/") || link.startsWith("/home/")) {
      throw new Error(`[afterPack] python3 still absolute symlink: ${link}`);
    }
    console.log("[afterPack] python3 OK:", execSync(`"${py}" --version`).toString().trim());
  } else {
    // Windows tree has no macOS-style symlinks; plain recursive copy is fine.
    cpSync(srcRuntime, destRuntime, { recursive: true });
    const py = path.join(destRuntime, "python.exe");
    if (!existsSync(py)) {
      throw new Error(`[afterPack] python.exe missing at ${py}`);
    }
    console.log("[afterPack] python.exe present");
  }

  if (existsSync(srcEnv)) {
    console.log("[afterPack] Copying backend/.env…");
    cpSync(srcEnv, path.join(backendDest, ".env"));
  } else {
    console.warn("[afterPack] WARNING: backend/.env missing — Supabase sync disabled");
  }
};
