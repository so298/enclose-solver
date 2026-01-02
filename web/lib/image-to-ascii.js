// image-to-ascii.js - JavaScript port of screenshot_to_ascii.py
// Converts game screenshots to ASCII grid representation
// Output chars: '.' grass, '#' water, 'H' horse

/**
 * Convert ImageData to grayscale array
 * @param {Uint8ClampedArray} data - RGBA pixel data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Float32Array} Grayscale values
 */
function toGrayscale(data, width, height) {
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return gray;
}

/**
 * 1D smoothing convolution
 * @param {Float32Array} x - Input array
 * @param {number} win - Window size (will be made odd)
 * @returns {Float32Array} Smoothed array
 */
function smooth1d(x, win = 7) {
    win = Math.max(3, win | 1); // ensure odd
    const half = Math.floor(win / 2);
    const result = new Float32Array(x.length);

    for (let i = 0; i < x.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - half); j <= Math.min(x.length - 1, i + half); j++) {
            sum += x[j];
            count++;
        }
        result[i] = sum / count;
    }
    return result;
}

/**
 * Find percentile value in array
 * @param {Float32Array} arr - Input array
 * @param {number} p - Percentile (0-100)
 * @returns {number} Percentile value
 */
function percentile(arr, p) {
    const sorted = Float32Array.from(arr).sort((a, b) => a - b);
    const idx = Math.floor((p / 100) * (sorted.length - 1));
    return sorted[idx];
}

/**
 * Find line centers from energy profile
 * @param {Float32Array} energy - Energy values
 * @param {number} percentileThreshold - Threshold percentile
 * @param {number} groupGap - Gap for grouping peaks
 * @param {number} smoothWin - Smoothing window
 * @returns {number[]} Line center positions
 */
function findLineCenters(energy, percentileThreshold = 92.0, groupGap = 10, smoothWin = 7) {
    const e = smooth1d(energy, smoothWin);
    const thr = percentile(e, percentileThreshold);

    // Find peaks
    const peaks = [];
    for (let i = 1; i < e.length - 1; i++) {
        if (e[i] > thr && e[i] > e[i - 1] && e[i] >= e[i + 1]) {
            peaks.push(i);
        }
    }

    if (peaks.length === 0) return [];

    // Group peaks
    const groups = [];
    let cur = [peaks[0]];
    for (let i = 1; i < peaks.length; i++) {
        if (peaks[i] - cur[cur.length - 1] <= groupGap) {
            cur.push(peaks[i]);
        } else {
            groups.push(cur);
            cur = [peaks[i]];
        }
    }
    groups.push(cur);

    // Compute centers
    return groups.map(g => Math.round(g.reduce((a, b) => a + b, 0) / g.length));
}

/**
 * Compute horizontal gradient energy (for vertical lines)
 * @param {Float32Array} gray - Grayscale image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Float32Array} Column energy
 */
function computeColEnergy(gray, width, height) {
    const energy = new Float32Array(width - 1);
    for (let x = 0; x < width - 1; x++) {
        let sum = 0;
        for (let y = 0; y < height; y++) {
            sum += Math.abs(gray[y * width + x + 1] - gray[y * width + x]);
        }
        energy[x] = sum / height;
    }
    return energy;
}

/**
 * Compute vertical gradient energy (for horizontal lines)
 * @param {Float32Array} gray - Grayscale image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Float32Array} Row energy
 */
function computeRowEnergy(gray, width, height) {
    const energy = new Float32Array(height - 1);
    for (let y = 0; y < height - 1; y++) {
        let sum = 0;
        for (let x = 0; x < width; x++) {
            sum += Math.abs(gray[(y + 1) * width + x] - gray[y * width + x]);
        }
        energy[y] = sum / width;
    }
    return energy;
}

/**
 * Detect grid lines automatically
 * @param {Uint8ClampedArray} data - RGBA pixel data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} minLinePercentile - Detection threshold
 * @returns {{xlines: number[], ylines: number[]}} Detected line positions
 */
function detectGridLines(data, width, height, minLinePercentile = 92.0) {
    const gray = toGrayscale(data, width, height);

    const colEnergy = computeColEnergy(gray, width, height);
    const rowEnergy = computeRowEnergy(gray, width, height);

    const xlines = findLineCenters(colEnergy, minLinePercentile);
    const ylines = findLineCenters(rowEnergy, minLinePercentile);

    if (xlines.length < 2 || ylines.length < 2) {
        throw new Error(
            `Failed to detect enough grid lines: x=${xlines.length}, y=${ylines.length}. ` +
            `Try adjusting minLinePercentile (90..97), or use manual mode with rows/cols.`
        );
    }

    return { xlines, ylines };
}

/**
 * Build uniform line positions for manual mode
 * @param {number} ncells - Number of cells
 * @param {number} length - Total length
 * @returns {number[]} Line positions
 */
function buildUniformLines(ncells, length) {
    const lines = [];
    for (let i = 0; i <= ncells; i++) {
        lines.push(Math.round((i / ncells) * length));
    }
    // Ensure monotonic
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] <= lines[i - 1]) {
            lines[i] = lines[i - 1] + 1;
        }
    }
    lines[lines.length - 1] = length;
    return lines;
}

/**
 * Classify a tile patch
 * @param {Uint8ClampedArray} data - RGBA pixel data
 * @param {number} width - Full image width
 * @param {number} x0 - Patch start x
 * @param {number} y0 - Patch start y
 * @param {number} x1 - Patch end x
 * @param {number} y1 - Patch end y
 * @returns {string} Tile character: '.' grass, '#' water, 'H' horse
 */
function classifyTile(data, width, x0, y0, x1, y1) {
    let sumR = 0, sumG = 0, sumB = 0;
    let whiteCount = 0;
    let count = 0;

    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            sumR += r;
            sumG += g;
            sumB += b;
            count++;

            if (r > 235 && g > 235 && b > 235) {
                whiteCount++;
            }
        }
    }

    if (count === 0) return '?';

    const avgR = sumR / count;
    const avgG = sumG / count;
    const avgB = sumB / count;
    const whiteRatio = whiteCount / count;

    const isWater = (avgB - avgG > 10) && (avgB - avgR > 30);

    if (whiteRatio > 0.01 && !isWater) {
        return 'H';
    }
    return isWater ? '#' : '.';
}

/**
 * Convert screenshot to ASCII grid
 * @param {ImageData|{data: Uint8ClampedArray, width: number, height: number}} imageData - Image data
 * @param {Object} options - Options
 * @param {number} [options.minLinePercentile=92.0] - Auto detection threshold
 * @param {number} [options.innerCropRatio=0.18] - Crop ratio per tile
 * @param {number|null} [options.rows=null] - Manual rows (both rows and cols required)
 * @param {number|null} [options.cols=null] - Manual cols (both rows and cols required)
 * @returns {{grid: string[], xlines: number[], ylines: number[]}} Result
 */
function screenshotToAscii(imageData, options = {}) {
    const {
        minLinePercentile = 92.0,
        innerCropRatio = 0.18,
        rows = null,
        cols = null
    } = options;

    const { data, width, height } = imageData;

    let xlines, ylines;

    if (rows !== null || cols !== null) {
        if (rows === null || cols === null) {
            throw new Error('Manual mode requires BOTH rows and cols.');
        }
        if (rows <= 0 || cols <= 0) {
            throw new Error('rows/cols must be positive.');
        }
        xlines = buildUniformLines(cols, width - 1);
        ylines = buildUniformLines(rows, height - 1);
    } else {
        ({ xlines, ylines } = detectGridLines(data, width, height, minLinePercentile));
    }

    const grid = [];
    const nrows = ylines.length - 1;
    const ncols = xlines.length - 1;

    for (let i = 0; i < nrows; i++) {
        const y0 = ylines[i];
        const y1 = ylines[i + 1];
        let rowChars = '';

        for (let j = 0; j < ncols; j++) {
            const x0 = xlines[j];
            const x1 = xlines[j + 1];
            const dy = y1 - y0;
            const dx = x1 - x0;
            const m = Math.floor(Math.min(dx, dy) * innerCropRatio);

            const yy0 = y0 + m;
            const yy1 = y1 - m;
            const xx0 = x0 + m;
            const xx1 = x1 - m;

            if (yy1 <= yy0 || xx1 <= xx0) {
                rowChars += '?';
                continue;
            }

            rowChars += classifyTile(data, width, xx0, yy0, xx1, yy1);
        }
        grid.push(rowChars);
    }

    return { grid, xlines, ylines };
}

/**
 * Apply crop to image data (creates new ImageData)
 * @param {ImageData} imageData - Original image data
 * @param {Object} crop - Crop ratios {left, top, right, bottom}
 * @returns {{data: Uint8ClampedArray, width: number, height: number}} Cropped data
 */
function applyCrop(imageData, crop) {
    const { data, width, height } = imageData;
    const { left = 0, top = 0, right = 0, bottom = 0 } = crop;

    const x0 = Math.round(width * left);
    const y0 = Math.round(height * top);
    const x1 = Math.round(width * (1 - right));
    const y1 = Math.round(height * (1 - bottom));

    if (x1 <= x0 || y1 <= y0) {
        throw new Error('Crop is too large; results in empty image.');
    }

    const newWidth = x1 - x0;
    const newHeight = y1 - y0;
    const newData = new Uint8ClampedArray(newWidth * newHeight * 4);

    for (let y = 0; y < newHeight; y++) {
        for (let x = 0; x < newWidth; x++) {
            const srcIdx = ((y + y0) * width + (x + x0)) * 4;
            const dstIdx = (y * newWidth + x) * 4;
            newData[dstIdx] = data[srcIdx];
            newData[dstIdx + 1] = data[srcIdx + 1];
            newData[dstIdx + 2] = data[srcIdx + 2];
            newData[dstIdx + 3] = data[srcIdx + 3];
        }
    }

    return { data: newData, width: newWidth, height: newHeight };
}

// Export for use in worker
if (typeof self !== 'undefined') {
    self.screenshotToAscii = screenshotToAscii;
    self.applyCrop = applyCrop;
}
