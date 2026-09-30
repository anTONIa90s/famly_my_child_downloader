const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const { fork } = require("child_process");
const path = require("path");

let mainWindow;
let currentDownloadProcess = null;
let cancelTimeout = null;

function sendToRenderer(channel, data) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, data);
}

function clearCurrentProcess(child) {
    if (currentDownloadProcess !== child) return;

    currentDownloadProcess = null;
    if (cancelTimeout) {
        clearTimeout(cancelTimeout);
        cancelTimeout = null;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true
        }
    });

    mainWindow.loadFile("renderer.html");
}

app.whenReady().then(createWindow);
// remove default application menu (File/Edit/View/Window)
app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("before-quit", () => {
    if (currentDownloadProcess && !currentDownloadProcess.killed) {
        currentDownloadProcess.kill();
    }
});

// --------------------------------------------------
// Folder picker
// --------------------------------------------------
ipcMain.handle("select-folder", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openDirectory"]
    });

    return result.canceled ? null : result.filePaths[0];
});

// --------------------------------------------------
// Start download engine
// --------------------------------------------------
ipcMain.handle("start-download", async (event, arg) => {
    // arg can be either a string (folder) for backward compatibility
    // or an object: { folder, startDate, endDate }
    let folder = null;
    let startDate = null;
    let endDate = null;

    if (typeof arg === 'string') {
        folder = arg;
    } else if (arg && typeof arg === 'object') {
        folder = arg.folder;
        startDate = arg.startDate || null;
        endDate = arg.endDate || null;
    }

    if (!folder) {
        throw new Error("A download folder is required.");
    }

    if (currentDownloadProcess) {
        throw new Error("A download is already in progress.");
    }

    const child = fork(path.join(__dirname, "downloaderProcess.js"), [], {
        // Electron's executable is also used to run the forked Node process.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "ignore", "ignore", "ipc"]
    });

    currentDownloadProcess = child;

    child.on("message", (message) => {
        if (!message || typeof message !== "object") return;

        if (message.type === "progress") {
            sendToRenderer("progress", message.data);
        } else if (message.type === "image") {
            sendToRenderer("image", message.data);
        } else if (message.type === "error") {
            sendToRenderer("progress", { stage: "error", message: message.data?.message || "Download failed" });
        }
    });

    child.once("error", (error) => {
        sendToRenderer("progress", { stage: "error", message: error.message });
        clearCurrentProcess(child);
    });

    child.once("exit", (code, signal) => {
        if (currentDownloadProcess === child && code !== 0) {
            sendToRenderer("progress", {
                stage: "error",
                message: `Downloader process stopped unexpectedly (${signal || `exit code ${code}`}).`
            });
        }
        clearCurrentProcess(child);
    });

    child.send({
        type: "start",
        options: {
            childId: "ec2074e3-c652-4176-afee-f6f174cd724e",
            downloadDir: folder,
            startDate,
            endDate,
            userDataDir: path.join(app.getPath("userData"), "famly-profile")
        }
    });

    return { started: true };
});

// --------------------------------------------------
// CANCEL download
// --------------------------------------------------
ipcMain.handle("cancel-download", async () => {
    const child = currentDownloadProcess;
    if (!child) return { cancelled: false };

    child.send({ type: "cancel" });

    // A stalled browser or network request must not leave the UI permanently busy.
    cancelTimeout = setTimeout(() => {
        if (currentDownloadProcess === child && !child.killed) {
            child.kill();
        }
    }, 5000);

    return { cancelled: true };
});
