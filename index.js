const { startDownload } = require("./famlyEngine");

(async () => {
    await startDownload({
        childId: "ec2074e3-c652-4176-afee-f6f174cd724e",
        downloadDir: "./downloads",

        onProgress: (p) => {
            console.log("PROGRESS:", p);
        },

        onImage: (img) => {
            console.log("DOWNLOADED:", img.id);
        }
    });
})();