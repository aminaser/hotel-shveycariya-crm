const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const isDev = !app.isPackaged;
let backendProcess = null;
let mainWindow = null;

app.setName("Отель Швейцария CRM");

function waitForBackend(retries = 40) {
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
  const backendDir = path.join(__dirname, "..", "backend");
  const python =
    process.platform === "win32"
      ? path.join(backendDir, ".venv", "Scripts", "python.exe")
      : path.join(backendDir, ".venv", "bin", "python");

  backendProcess = spawn(
    python,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    { cwd: backendDir, stdio: "inherit", env: { ...process.env } },
  );
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
    } catch {
      // ignore backup errors on close
    }
    mainWindow.destroy();
    mainWindow = null;
  });
}

ipcMain.handle("get-app-path", () => app.getPath("userData"));

app.whenReady().then(async () => {
  if (process.env.SKIP_BACKEND !== "1") {
    startBackend();
  }
  try {
    await waitForBackend();
    await createWindow();
  } catch (error) {
    console.error(error);
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
    await createWindow();
  }
});
