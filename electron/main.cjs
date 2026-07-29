const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const isDev = !app.isPackaged;
let backendProcess = null;
let mainWindow = null;

app.setName("Отель Швейцария CRM");

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

function waitForBackend(retries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      http
        .get("http://127.0.0.1:8000/api/v1/health", (res) => {
          if (res.statusCode === 200) resolve();
          else if (left > 0) setTimeout(() => attempt(left - 1), 500);
          else reject(new Error("Backend health check failed"));
        })
        .on("error", () => {
          if (left > 0) setTimeout(() => attempt(left - 1), 500);
          else reject(new Error("Backend not reachable"));
        });
    };
    attempt(retries);
  });
}

function startBackend() {
  const backendDir = getBackendDir();
  const python = getPythonPath(backendDir);
  const dataDir = getDataDir();

  if (!fs.existsSync(python)) {
    throw new Error(
      `Python runtime not found:\n${python}\n\nПересоберите приложение: npm run electron:build`,
    );
  }

  backendProcess = spawn(
    python,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: backendDir,
      stdio: isDev ? "inherit" : "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        HOTEL_CRM_DATA_DIR: dataDir,
        PYTHONUNBUFFERED: "1",
      },
    },
  );

  if (backendProcess.stderr) {
    backendProcess.stderr.on("data", (chunk) => {
      console.error("[backend]", chunk.toString());
    });
  }
  backendProcess.on("exit", (code, signal) => {
    console.error(`[backend] exited code=${code} signal=${signal}`);
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

app.whenReady().then(async () => {
  try {
    if (process.env.SKIP_BACKEND !== "1") {
      startBackend();
    }
    await waitForBackend();
    await createWindow();
  } catch (error) {
    console.error(error);
    dialog.showErrorBox(
      "Отель Швейцария CRM",
      `Не удалось запустить приложение.\n\n${error.message || error}`,
    );
    if (backendProcess) {
      backendProcess.kill();
      backendProcess = null;
    }
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
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
