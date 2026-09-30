let folder = null;
let downloadInProgress = false;
const MAX_LOG_LINES = 100;
const logLines = [];

const log = (msg) => {
    const div = document.getElementById("log");
    logLines.push(String(msg));
    if (logLines.length > MAX_LOG_LINES) logLines.shift();
    div.textContent = logLines.join("\n");
    div.scrollTop = div.scrollHeight;
};

const setDownloadInProgress = (inProgress) => {
    downloadInProgress = inProgress;
    document.getElementById("startBtn").disabled = inProgress;
    document.getElementById("folderBtn").disabled = inProgress;
};

document.getElementById("folderBtn").onclick = async () => {
    folder = await window.api.selectFolder();

    document.getElementById("folderPath").innerText =
        folder || "No folder selected";
};

document.getElementById("startBtn").onclick = async () => {
    if (downloadInProgress) return;

    if (!folder) {
        alert("Please select a folder first");
        return;
    }

    log("Starting download...");

    // read date inputs
    const startDateVal = document.getElementById('startDate').value;
    const endDateVal = document.getElementById('endDate').value;

    let startDate = startDateVal ? new Date(startDateVal) : null;
    let endDate = endDateVal ? new Date(endDateVal) : null;

    // normalize endDate to end of day if provided
    if (endDate) {
        endDate.setHours(23, 59, 59, 999);
    }

    if (startDate && endDate && startDate > endDate) {
        alert('Start date must be before end date');
        return;
    }

    try {
        setDownloadInProgress(true);
        await window.api.startDownload({ folder, startDate: startDate ? startDate.toISOString() : null, endDate: endDate ? endDate.toISOString() : null });
    } catch (error) {
        setDownloadInProgress(false);
        log(`Unable to start download: ${error.message}`);
    }
};

document.getElementById("cancelBtn").onclick = async () => {
    log("Cancelling...");
    await window.api.cancelDownload();
};

// progress updates
window.api.onProgress((data) => {
    log(JSON.stringify(data));

    if (["done", "cancelled", "error"].includes(data.stage)) {
        setDownloadInProgress(false);
    }

    if (data.current && data.total) {
        const pct = Math.round((data.current / data.total) * 100);
        document.getElementById("bar").value = pct;
    }
});

window.api.onImage((img) => {
    // const fileName = img.filePath.split("\\").pop(); // windows
    const fileName = img.filePath.split(/[\\/]/).pop(); // cross-platform
    log("Downloaded: " + fileName);
});
