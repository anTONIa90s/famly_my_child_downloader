const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const timestampCounters = new Map();

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function deduplicateByImageId(images) {
    const map = new Map();

    for (const img of images) {
        if (img?.imageId) {
            map.set(img.imageId, img);
        }
    }

    return [...map.values()];
}

function throwIfCancelled(signal) {
    if (signal?.aborted) {
        throw new Error("DOWNLOAD_CANCELLED");
    }
}

/**
 * MAIN ENGINE
 */
async function startDownload({
    childId,
    downloadDir,
    onProgress = () => { },
    onImage = () => { },
    signal
}) {
    ensureDir(downloadDir);

    const path = require("path");
    const { app } = require("electron");

    const userDataDir = path.join(app.getPath("userData"), "famly-profile");

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false
    });

    const page = await context.newPage();

    const collectedImages = [];

    let cancelled = false;

    // --------------------------------------------------
    // INTERCEPT REAL FAMLY API RESPONSES
    // --------------------------------------------------
    page.on("response", async (response) => {
        try {
            if (signal?.aborted) return;

            const url = response.url();

            if (!url.includes("/api/v2/images/tagged")) return;

            const data = await response.json();

            let batch = [];

            if (Array.isArray(data)) {
                batch = data;
            } else {
                batch = Object.values(data || {});
            }

            if (batch.length > 0) {
                collectedImages.push(...batch);

                onProgress({
                    stage: "collecting",
                    count: collectedImages.length
                });
            }
        } catch (e) {
            // ignore parse errors
        }
    });

    try {
        // --------------------------------------------------
        // OPEN FAMLY
        // --------------------------------------------------
        onProgress({ stage: "opening" });

        await page.goto("https://app.famly.de");

        console.log("\n👉 Please log in if needed.");
        console.log("👉 Navigate to the child's profile page.");
        console.log("👉 Waiting for /childProfile/... to appear...\n");

        // Wait until user reaches correct page
        await page.waitForFunction(() => {
            return window.location.href.includes("/childProfile/");
        }, { timeout: 0 }); // infinite wait

        console.log("Child profile detected ✔");

        // Now ensure we are on photos page automatically
        await page.waitForFunction(() => {
            return window.location.href.includes("/childProfile/");
        });

        let url = page.url();

        if (url.includes("/activity")) {
            console.log("Switching to photos page automatically...");
            await page.goto(url.replace("/activity", "/photos"));
        }

        throwIfCancelled(signal);

        // --------------------------------------------------
        // TRIGGER LAZY LOADING
        // --------------------------------------------------
        for (let i = 0; i < 5; i++) {
            throwIfCancelled(signal);

            await page.mouse.wheel(0, 2000);
            await sleep(1500);
        }

        // --------------------------------------------------
        // FINALIZE COLLECTION
        // --------------------------------------------------
        const uniqueImages = deduplicateByImageId(collectedImages);

        onProgress({
            stage: "collected",
            count: uniqueImages.length
        });

        // --------------------------------------------------
        // DOWNLOAD LOOP
        // --------------------------------------------------
        for (let i = 0; i < uniqueImages.length; i++) {
            throwIfCancelled(signal);

            const img = uniqueImages[i];

            try {
                const url = img.url_big || img.url;
                const id = img.imageId;

                if (!url || !id) continue;

                //// const filePath = path.join(downloadDir, `${id}.jpg`);
                // const timestamp = formatTimestamp(img.createdAt);
                // const fileName = `${timestamp}_${id}.jpg`;
                // const filePath = path.join(downloadDir, fileName);
                const timestamp = formatTimestamp(img.createdAt);
                // get current counter for this timestamp
                const currentCount = timestampCounters.get(timestamp) || 0;
                const nextCount = currentCount + 1;
                // store updated counter
                timestampCounters.set(timestamp, nextCount);
                // pad counter (01, 02, 03...)
                const counterStr = String(nextCount).padStart(2, "0");
                const fileName = `${timestamp}_${counterStr}.jpg`;
                const filePath = path.join(downloadDir, fileName);

                if (fs.existsSync(filePath)) {
                    onProgress({
                        stage: "downloading",
                        current: i + 1,
                        total: uniqueImages.length,
                        id,
                        skipped: true
                    });
                    continue;
                }

                onProgress({
                    stage: "downloading",
                    current: i + 1,
                    total: uniqueImages.length,
                    id
                });

                const res = await fetch(url);
                const buffer = await res.arrayBuffer();

                fs.writeFileSync(filePath, Buffer.from(buffer));

                onImage({ id, filePath });

            } catch (err) {
                if (err.message === "DOWNLOAD_CANCELLED") break;

                onProgress({
                    stage: "error",
                    id: img?.imageId,
                    message: err.message
                });
            }
        }

        onProgress({
            stage: "done",
            total: uniqueImages.length
        });

        return uniqueImages;

    } catch (err) {
        if (err.message === "DOWNLOAD_CANCELLED") {
            onProgress({ stage: "cancelled" });
            return [];
        }

        throw err;

    } finally {
        await context.close();
    }
}

function formatTimestamp(isoString) {
    if (!isoString) return "unknown-time";

    const d = new Date(isoString);

    const pad = (n) => String(n).padStart(2, "0");

    return (
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate())
        // "_" +
        // pad(d.getHours()) +
        // "-" +
        // pad(d.getMinutes()) +
        // "-" +
        // pad(d.getSeconds())
    );
}

module.exports = { startDownload };