let folder = null;

const log = (msg) => {
    const div = document.getElementById("log");
    div.innerHTML += msg + "<br>";
    div.scrollTop = div.scrollHeight;
};

document.getElementById("folderBtn").onclick = async () => {
    folder = await window.api.selectFolder();

    document.getElementById("folderPath").innerText =
        folder || "No folder selected";
};

document.getElementById("startBtn").onclick = async () => {
    if (!folder) {
        alert("Please select a folder first");
        return;
    }

    log("Starting download...");

    window.api.startDownload(folder);
};

document.getElementById("cancelBtn").onclick = async () => {
    log("Cancelling...");
    await window.api.cancelDownload();
};

// progress updates
window.api.onProgress((data) => {
    log(JSON.stringify(data));

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