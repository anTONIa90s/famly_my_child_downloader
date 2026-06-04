const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { startDownload } = require("./famlyEngine");

let mainWindow;
let currentAbortController = null;

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

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
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
ipcMain.handle("start-download", async (event, folder) => {
    currentAbortController = new AbortController();

    return startDownload({
        childId: "ec2074e3-c652-4176-afee-f6f174cd724e",
        downloadDir: folder,
        signal: currentAbortController.signal,

        onProgress: (data) => {
            mainWindow.webContents.send("progress", data);
        },

        onImage: (img) => {
            mainWindow.webContents.send("image", img);
        }
    });
});

// --------------------------------------------------
// CANCEL download
// --------------------------------------------------
ipcMain.handle("cancel-download", async () => {
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
});