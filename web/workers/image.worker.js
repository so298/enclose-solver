// image.worker.js - Web Worker for image processing
// Converts screenshots to ASCII grids in the background

// Import the image-to-ascii library
importScripts('../lib/image-to-ascii.js');

self.onmessage = async function(e) {
    const { type, imageBitmap, options, id } = e.data;

    if (type === 'convert') {
        try {
            const startTime = performance.now();

            // Create OffscreenCanvas to get image data
            const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);

            let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // Apply crop if specified
            if (options.crop) {
                const { left, top, right, bottom } = options.crop;
                if (left > 0 || top > 0 || right > 0 || bottom > 0) {
                    imageData = applyCrop(imageData, options.crop);
                }
            }

            // Convert to ASCII
            const result = screenshotToAscii(imageData, {
                minLinePercentile: options.minLinePercentile || 92.0,
                innerCropRatio: options.innerCropRatio || 0.18,
                rows: options.rows || null,
                cols: options.cols || null
            });

            const endTime = performance.now();

            self.postMessage({
                type: 'result',
                id,
                result: {
                    grid: result.grid.join('\n'),
                    rows: result.grid.length,
                    cols: result.grid[0]?.length || 0,
                    time: (endTime - startTime) / 1000
                }
            });

            // Close the bitmap to free memory
            imageBitmap.close();

        } catch (error) {
            self.postMessage({
                type: 'result',
                id,
                error: error.message
            });
        }
    }
};
