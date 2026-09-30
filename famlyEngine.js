const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

function findChromeExecutable() {
    const candidates = [
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser'
    ].filter(Boolean);

    const fs = require('fs');
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch (e) {
            // ignore
        }
    }
    return null;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
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
    signal,
    startDate,
    endDate,
    userDataDir
}) {
    if (!downloadDir || !userDataDir) {
        throw new Error("A download directory and profile directory are required.");
    }

    await fs.promises.mkdir(downloadDir, { recursive: true });
    const timestampCounters = new Map();

    const launchOptions = { headless: false };
    const systemChrome = findChromeExecutable();
    if (systemChrome) {
        launchOptions.executablePath = systemChrome;
        console.log('Using system Chrome executable at ' + systemChrome);
    } else {
        launchOptions.channel = 'chrome';
        console.warn('No explicit Chrome/Chromium executable found. Setting channel:"chrome" as fallback. Ensure Chrome is installed on the system.');
    }

    console.log('launchOptions:', { executablePath: launchOptions.executablePath || null, channel: launchOptions.channel || null, userDataDir });

    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);

    const page = await context.newPage();

    const collectedImages = new Map();
    const pendingResponseParses = new Set();

    // --------------------------------------------------
    // INTERCEPT REAL FAMLY API RESPONSES
    // --------------------------------------------------
    const onResponse = (response) => {
        const parseResponse = async () => {
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
                for (const image of batch) {
                    if (image?.imageId) collectedImages.set(image.imageId, image);
                }

                onProgress({
                    stage: "collecting",
                    count: collectedImages.size
                });
            }
        } catch (e) {
            // ignore parse errors
        }
        };

        const pending = parseResponse();
        pendingResponseParses.add(pending);
        pending.finally(() => pendingResponseParses.delete(pending));
    };

    page.on("response", onResponse);

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
        page.off("response", onResponse);
        await Promise.allSettled([...pendingResponseParses]);

        // if date filters are provided, filter collectedImages by createdAt
        let filtered = Array.from(collectedImages.values());

        let startTs = startDate ? Date.parse(startDate) : null;
        let endTs = endDate ? Date.parse(endDate) : null;

        if (startTs || endTs) {
            filtered = filtered.filter(img => {
                if (!img || !img.createdAt) return false; // exclude images without timestamps when filtering

                const t = Date.parse(img.createdAt);
                if (Number.isNaN(t)) return false;

                if (startTs && t < startTs) return false;
                if (endTs && t > endTs) return false;

                return true;
            });
        }

        const uniqueImages = filtered;

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

                const res = await fetch(url, { signal });
                if (!res.ok) {
                    throw new Error(`Image request failed with status ${res.status}`);
                }
                const buffer = await res.arrayBuffer();
                throwIfCancelled(signal);

                await fs.promises.writeFile(filePath, Buffer.from(buffer));

                onImage({ id, filePath });

            } catch (err) {
                if (signal?.aborted || err.message === "DOWNLOAD_CANCELLED" || err.name === "AbortError") {
                    throw new Error("DOWNLOAD_CANCELLED");
                }

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
        page.off("response", onResponse);
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
    );
}

module.exports = { startDownload };
