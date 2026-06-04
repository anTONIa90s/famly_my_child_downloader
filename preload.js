const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    selectFolder: () => ipcRenderer.invoke("select-folder"),
    startDownload: (folder) => ipcRenderer.invoke("start-download", folder),
    cancelDownload: () => ipcRenderer.invoke("cancel-download"),

    onProgress: (cb) => ipcRenderer.on("progress", (_, data) => cb(data)),
    onImage: (cb) => ipcRenderer.on("image", (_, data) => cb(data))
});