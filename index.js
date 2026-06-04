const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CHILD_ID = "ec2074e3-c652-4176-afee-f6f174cd724e";
const OUTPUT_DIR = path.join(__dirname, "downloads");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    console.log("Starting Famly interception downloader...");

    const context = await chromium.launchPersistentContext(
        path.join(__dirname, "famly-profile"),
        {
            headless: false
        }
    );

    const page = await context.newPage();

    const images = [];

    // ---------------------------------------------------
    // 1. INTERCEPT REAL API RESPONSES
    // ---------------------------------------------------
    page.on("response", async (response) => {
        try {
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
                console.log(`Intercepted ${batch.length} images`);
                images.push(...batch);
            }
        } catch (err) {
            // ignore JSON parse errors
        }
    });

    // ---------------------------------------------------
    // 2. OPEN FAMLY
    // ---------------------------------------------------
    console.log("\nOpening Famly...");

    await page.goto("https://app.famly.de");

    console.log("\n👉 Please log in manually if needed.");
    console.log("👉 Navigate to the child's PHOTO page:");
    console.log("   /account/childProfile/.../photos");

    console.log("\n⏳ Waiting 20 seconds for app to load...\n");

    // Give user time to navigate + allow API calls to fire
    await sleep(20000);

    // ---------------------------------------------------
    // 3. TRIGGER MORE LOADS (scroll / interaction)
    // ---------------------------------------------------
    console.log("Triggering additional loads...");

    for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 2000);
        await sleep(2000);
    }

    // ---------------------------------------------------
    // 4. REMOVE DUPLICATES
    // ---------------------------------------------------
    const unique = new Map();

    for (const img of images) {
        if (img?.imageId) {
            unique.set(img.imageId, img);
        }
    }

    const finalImages = [...unique.values()];

    console.log(`\nTotal unique images collected: ${finalImages.length}`);

    // ---------------------------------------------------
    // 5. DOWNLOAD IMAGES
    // ---------------------------------------------------
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR);
    }

    console.log("\nDownloading images...\n");

    for (const img of finalImages) {
        try {
            const url = img.url_big || img.url;
            const id = img.imageId;

            if (!url || !id) continue;

            const filePath = path.join(OUTPUT_DIR, `${id}.jpg`);

            if (fs.existsSync(filePath)) {
                console.log("Already exists:", id);
                continue;
            }

            console.log("Downloading:", id);

            const res = await fetch(url);
            const buffer = await res.arrayBuffer();

            fs.writeFileSync(filePath, Buffer.from(buffer));
        } catch (err) {
            console.log("Failed:", img?.imageId);
        }
    }

    console.log("\n✅ Done!");

    await context.close();
})();