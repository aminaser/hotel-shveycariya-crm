const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const isDev = !app.isPackaged;
const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
let backendProcess = null;
let mainWindow = null;
let updateCheckTimer = null;
let backendLog = "";
/** Skip close-backup and force-kill backend while NSIS update is installing. */
let isInstallingUpdate = false;

app.setName("Отель Швейцария CRM");

function appendBackendLog(chunk) {
  const text = chunk.toString();
  backendLog = (backendLog + text).slice(-8000);
  console.error("[backend]", text);
}

function stopBackend() {
  if (!backendProcess) return;
  const proc = backendProcess;
  const pid = proc.pid;
  backendProcess = null;

  if (process.platform === "win32" && pid) {
    // Kill the whole tree — plain kill() leaves python/uvicorn holding install files.
    try {
      execFile(
        "taskkill",
        ["/pid", String(pid), "/T", "/F"],
        { windowsHide: true },
        () => {},
      );
    } catch {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }
    return;
  }

  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }
  setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, 800);
}

/** Kill packaged Electron + Python still holding NSIS install files (Windows). */
function killPackagedPythonLocks() {
  if (process.platform !== "win32" || isDev) return;
  try {
    execFile(
      "taskkill",
      ["/F", "/IM", "HotelShveycariyaCRM.exe", "/T"],
      { windowsHide: true },
      () => {},
    );
  } catch {
    // ignore
  }
  try {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$needles = @('HotelShveycariyaCRM','hotel-shveycariya-crm','Hotel Shveycariya CRM','Shveycariya');
Get-CimInstance Win32_Process -EA SilentlyContinue | ForEach-Object {
  $p = $_; $blob = (($p.ExecutablePath + ' ' + $p.CommandLine) + '');
  foreach ($n in $needles) {
    if ($blob -like ('*' + $n + '*')) {
      if ($p.ProcessId -ne $PID) {
        Stop-Process -Id $p.ProcessId -Force -EA SilentlyContinue
      }
      break
    }
  }
}`,
      ],
      { windowsHide: true },
      () => {},
    );
  } catch {
    // ignore
  }
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackendDir() {
  return isDev
    ? path.join(__dirname, "..", "backend")
    : path.join(process.resourcesPath, "backend");
}

function getPythonPath(backendDir) {
  if (isDev) {
    return process.platform === "win32"
      ? path.join(backendDir, ".venv", "Scripts", "python.exe")
      : path.join(backendDir, ".venv", "bin", "python");
  }
  // Packaged: portable CPython from scripts/prepare-runtime.sh
  if (process.platform === "win32") {
    return path.join(backendDir, "runtime", "python.exe");
  }
  return path.join(backendDir, "runtime", "bin", "python3");
}

function getDataDir() {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(path.join(dir, "backups"), { recursive: true });
  return dir;
}

function getLogPath() {
  return path.join(app.getPath("userData"), "backend.log");
}

function writeBackendLogFile() {
  try {
    fs.writeFileSync(getLogPath(), backendLog || "(empty)\n", "utf8");
  } catch (error) {
    console.warn("Could not write backend.log:", error);
  }
}

function waitForBackend(retries = 90) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      if (backendProcess && backendProcess.exitCode !== null) {
        reject(
          new Error(
            `Backend exited early (code ${backendProcess.exitCode}).\n\n${backendLog.trim() || "No output from Python."}`,
          ),
        );
        return;
      }
      http
        .get("http://127.0.0.1:8000/api/v1/health", (res) => {
          if (res.statusCode === 200) resolve();
          else if (left > 0) setTimeout(() => attempt(left - 1), 500);
          else reject(new Error("Backend health check failed"));
        })
        .on("error", () => {
          if (left > 0) setTimeout(() => attempt(left - 1), 500);
          else {
            reject(
              new Error(
                `Backend not reachable.\n\n${backendLog.trim() || "Python did not start or produced no output."}\n\nLog: ${getLogPath()}`,
              ),
            );
          }
        });
    };
    attempt(retries);
  });
}

function startBackend() {
  const backendDir = getBackendDir();
  const python = getPythonPath(backendDir);
  const dataDir = getDataDir();
  const runtimeDir = path.join(backendDir, "runtime");
  const sitePackages = path.join(runtimeDir, "Lib", "site-packages");

  if (!fs.existsSync(python)) {
    throw new Error(
      `Python runtime not found:\n${python}\n\nПереустановите CRM (Setup) или пересоберите: npm run electron:build:win`,
    );
  }

  backendLog = `python=${python}\ncwd=${backendDir}\ndata=${dataDir}\n`;
  writeBackendLogFile();

  const env = {
    ...process.env,
    HOTEL_CRM_DATA_DIR: dataDir,
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
  };

  // Packaged Windows: force portable runtime + site-packages onto sys.path.
  if (!isDev && process.platform === "win32") {
    env.PYTHONHOME = runtimeDir;
    env.PYTHONPATH = [sitePackages, backendDir].join(path.delimiter);
  }

  backendProcess = spawn(
    python,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: backendDir,
      stdio: isDev ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env,
    },
  );

  backendProcess.on("error", (error) => {
    appendBackendLog(`spawn error: ${error.message}\n`);
    writeBackendLogFile();
  });

  if (backendProcess.stdout) {
    backendProcess.stdout.on("data", (chunk) => {
      appendBackendLog(chunk);
      writeBackendLogFile();
    });
  }
  if (backendProcess.stderr) {
    backendProcess.stderr.on("data", (chunk) => {
      appendBackendLog(chunk);
      writeBackendLogFile();
    });
  }
  backendProcess.on("exit", (code, signal) => {
    appendBackendLog(`exited code=${code} signal=${signal}\n`);
    writeBackendLogFile();
  });
}

function requestBackup(token) {
  return new Promise((resolve) => {
    if (!token) {
      resolve();
      return;
    }
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 8000,
        path: "/api/v1/settings/backup",
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Length": 0,
        },
      },
      () => resolve(),
    );
    req.setTimeout(5000, () => {
      req.destroy();
      resolve();
    });
    req.on("error", () => resolve());
    req.end();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "Отель Швейцария · CRM",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (isDev) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, "..", "frontend", "dist", "index.html"),
    );
  }

  mainWindow.on("close", async (event) => {
    if (isInstallingUpdate) {
      mainWindow.destroy();
      mainWindow = null;
      return;
    }
    event.preventDefault();
    try {
      const token = await mainWindow.webContents.executeJavaScript(
        `localStorage.getItem('hotel-crm-auth')`,
      );
      let parsedToken = null;
      if (token) {
        const data = JSON.parse(token);
        parsedToken = data?.state?.token ?? null;
      }
      await requestBackup(parsedToken);
    } catch (error) {
      console.warn("Backup skipped on close:", error);
    }
    mainWindow.destroy();
    mainWindow = null;
  });
}

ipcMain.handle("get-app-path", () => app.getPath("userData"));
ipcMain.handle("relaunch-app", () => {
  // Full process restart so SQLite reopens the restored DB file.
  isInstallingUpdate = true;
  stopBackend();
  app.relaunch();
  app.exit(0);
});
ipcMain.handle("check-for-updates", async () => {
  if (isDev || isPortable) {
    return { ok: false, reason: "updates_unavailable" };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      ok: true,
      version: result?.updateInfo?.version ?? null,
    };
  } catch (error) {
    console.error("[updater]", error);
    return { ok: false, reason: error.message || String(error) };
  }
});

function setupAutoUpdater() {
  if (isDev || isPortable) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (...args) => console.log("[updater]", ...args),
    warn: (...args) => console.warn("[updater]", ...args),
    error: (...args) => console.error("[updater]", ...args),
  };

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] available: ${info.version}`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      title: "Обновление готово",
      message: `Скачана версия ${info.version}`,
      detail:
        "Приложение закроется и установит обновление само. Данные CRM (база в AppData) сохранятся.",
      buttons: ["Установить сейчас", "Позже"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) {
      isInstallingUpdate = true;
      if (updateCheckTimer) {
        clearInterval(updateCheckTimer);
        updateCheckTimer = null;
      }
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.removeAllListeners("close");
          mainWindow.close();
        }
      } catch {
        // ignore
      }
      stopBackend();
      killPackagedPythonLocks();
      // Give Windows time to release locks on portable CPython under resources\
      // before NSIS runs (otherwise CopyFiles / old uninstall hit Retry loops).
      void (async () => {
        await waitMs(3000);
        killPackagedPythonLocks();
        await waitMs(1000);
        try {
          // Silent NSIS (/S) + relaunch — avoids interactive "close CRM" UI.
          autoUpdater.quitAndInstall(true, true);
        } catch (error) {
          isInstallingUpdate = false;
          console.error("[updater] quitAndInstall failed:", error);
          dialog.showErrorBox(
            "Обновление",
            `Не удалось запустить установку.\n\n${error.message || error}\n\nЗакройте CRM через Диспетчер задач (HotelShveycariyaCRM.exe и python.exe) и установите Setup с GitHub Releases.`,
          );
        }
      })();
    }
  });

  autoUpdater.on("error", (error) => {
    console.error("[updater]", error);
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.error("[updater] check failed:", error);
    });
  };

  setTimeout(check, 8000);
  updateCheckTimer = setInterval(check, 4 * 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  try {
    if (process.env.SKIP_BACKEND !== "1") {
      startBackend();
    }
    await waitForBackend();
    await createWindow();
    setupAutoUpdater();
  } catch (error) {
    console.error(error);
    writeBackendLogFile();
    dialog.showErrorBox(
      "Отель Швейцария CRM",
      `Не удалось запустить приложение.\n\n${error.message || error}`,
    );
    stopBackend();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  stopBackend();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      await createWindow();
    } catch (error) {
      console.error(error);
    }
  }
});
