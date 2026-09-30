const { startDownload } = require("./famlyEngine");

let activeAbortController = null;

function send(type, data) {
    if (process.send) process.send({ type, data });
}

process.on("message", async (message) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "cancel") {
        activeAbortController?.abort();
        return;
    }

    if (message.type !== "start" || activeAbortController) return;

    activeAbortController = new AbortController();

    try {
        await startDownload({
            ...message.options,
            signal: activeAbortController.signal,
            onProgress: (data) => send("progress", data),
            onImage: (data) => send("image", data)
        });
        process.exitCode = 0;
    } catch (error) {
        send("error", { message: error.message || "Download failed" });
        process.exitCode = 1;
    } finally {
        activeAbortController = null;
        if (process.connected) process.disconnect();
    }
});
