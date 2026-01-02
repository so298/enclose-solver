// main.js - Frontend logic for Enclose Solver

// Workers
let imageWorker = null;
let solverWorker = null;
let solverReady = false;
let requestId = 0;
const pendingRequests = new Map();

// Current image
let currentImage = null;
let currentImageSource = null;

// DOM Elements
const pasteBtn = document.getElementById('pasteBtn');
const fileInput = document.getElementById('fileInput');
const imagePreview = document.getElementById('imagePreview');
const imageSource = document.getElementById('imageSource');
const modeSelect = document.getElementById('modeSelect');
const rowsInput = document.getElementById('rowsInput');
const colsInput = document.getElementById('colsInput');
const cropInput = document.getElementById('cropInput');
const convertBtn = document.getElementById('convertBtn');
const convertStatus = document.getElementById('convertStatus');
const gridTextarea = document.getElementById('gridTextarea');
const gridInfo = document.getElementById('gridInfo');
const kInput = document.getElementById('kInput');
const solveBtn = document.getElementById('solveBtn');
const solveStatus = document.getElementById('solveStatus');
const resultSection = document.getElementById('resultSection');
const resultArea = document.getElementById('resultArea');
const resultWalls = document.getElementById('resultWalls');
const resultTime = document.getElementById('resultTime');
const resultGridVisual = document.getElementById('resultGridVisual');
const inputGridVisual = document.getElementById('inputGridVisual');
const tabs = document.querySelectorAll('.tab');
const asciiTab = document.getElementById('asciiTab');
const visualTab = document.getElementById('visualTab');

// Initialize workers
function initWorkers() {
    // Image worker
    imageWorker = new Worker('workers/image.worker.js');
    imageWorker.onmessage = handleImageWorkerMessage;
    imageWorker.onerror = (e) => {
        console.error('Image worker error:', e);
        showStatus(convertStatus, 'error', 'Image worker error: ' + e.message);
    };

    // Solver worker
    solverWorker = new Worker('workers/solver.worker.js');
    solverWorker.onmessage = handleSolverWorkerMessage;
    solverWorker.onerror = (e) => {
        console.error('Solver worker error:', e);
        showStatus(solveStatus, 'error', 'Solver worker error: ' + e.message);
    };
}

function handleImageWorkerMessage(e) {
    const { type, id, result, error } = e.data;

    if (type === 'result') {
        const callback = pendingRequests.get(id);
        pendingRequests.delete(id);

        if (callback) {
            if (error) {
                callback.reject(new Error(error));
            } else {
                callback.resolve(result);
            }
        }
    }
}

function handleSolverWorkerMessage(e) {
    const { type, id, result, error } = e.data;

    if (type === 'ready') {
        solverReady = true;
        console.log('Solver WASM module ready');
    } else if (type === 'result') {
        const callback = pendingRequests.get(id);
        pendingRequests.delete(id);

        if (callback) {
            if (error) {
                callback.reject(new Error(error));
            } else {
                callback.resolve(result);
            }
        }
    }
}

// Show status message
function showStatus(element, type, message) {
    element.className = `status ${type}`;
    if (type === 'loading') {
        element.innerHTML = `<span class="spinner"></span>${message}`;
    } else {
        element.textContent = message;
    }
}

function hideStatus(element) {
    element.className = 'status';
    element.textContent = '';
}

// Handle image loading
async function loadImage(source, sourceName = null) {
    let blob;

    if (source instanceof Blob) {
        blob = source;
    } else if (source instanceof File) {
        blob = source;
        sourceName = sourceName || source.name;
    } else {
        throw new Error('Invalid image source');
    }

    // Create image element for preview
    const url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = url;

    // Wait for image to load
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
    });

    // Update preview
    imagePreview.innerHTML = '';
    imagePreview.appendChild(img);

    // Update source display
    currentImageSource = sourceName;
    imageSource.textContent = sourceName ? `Source: ${sourceName}` : '';

    // Store the image bitmap for worker
    currentImage = await createImageBitmap(blob);
    convertBtn.disabled = false;
}

// Handle paste from clipboard
async function handlePaste() {
    try {
        const items = await navigator.clipboard.read();

        for (const item of items) {
            for (const type of item.types) {
                if (type.startsWith('image/')) {
                    const blob = await item.getType(type);
                    await loadImage(blob, 'from clipboard');
                    return;
                }
            }
        }

        alert('No image found in clipboard');
    } catch (err) {
        console.error('Clipboard error:', err);
        alert('Failed to read clipboard: ' + err.message);
    }
}

// Handle file input
async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        try {
            await loadImage(file);
        } catch (err) {
            alert('Failed to load image: ' + err.message);
        }
    }
}

// Parse crop input
function parseCrop(input) {
    if (!input || input.trim() === '') return null;

    const parts = input.split(',').map(s => parseFloat(s.trim()));
    if (parts.length !== 4 || parts.some(isNaN)) {
        throw new Error('Invalid crop format. Use: left,top,right,bottom (e.g., 0.02,0.02,0.02,0.04)');
    }

    return {
        left: parts[0],
        top: parts[1],
        right: parts[2],
        bottom: parts[3]
    };
}

// Convert image to ASCII
async function convertImage() {
    if (!currentImage) {
        alert('Please load an image first');
        return;
    }

    const id = ++requestId;
    const isManual = modeSelect.value === 'manual';

    try {
        // Parse options
        let crop = null;
        try {
            crop = parseCrop(cropInput.value);
        } catch (e) {
            showStatus(convertStatus, 'error', e.message);
            return;
        }

        const options = {
            minLinePercentile: 92.0,
            innerCropRatio: 0.18,
            rows: isManual ? parseInt(rowsInput.value) : null,
            cols: isManual ? parseInt(colsInput.value) : null,
            crop: crop
        };

        showStatus(convertStatus, 'loading', 'Converting image to ASCII...');
        convertBtn.disabled = true;

        // Send to worker (transfer the bitmap)
        const result = await new Promise((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
            imageWorker.postMessage(
                { type: 'convert', imageBitmap: currentImage, options, id },
                [currentImage]
            );
        });

        // Need to recreate the bitmap since it was transferred
        const img = imagePreview.querySelector('img');
        if (img) {
            const response = await fetch(img.src);
            const blob = await response.blob();
            currentImage = await createImageBitmap(blob);
        }

        // Update textarea
        gridTextarea.value = result.grid;
        gridInfo.textContent = `${result.rows} rows × ${result.cols} cols (${(result.time * 1000).toFixed(0)}ms)`;

        // Update visual grid
        renderInputVisualGrid();

        showStatus(convertStatus, 'success', `Converted successfully in ${(result.time * 1000).toFixed(0)}ms`);
        setTimeout(() => hideStatus(convertStatus), 3000);

    } catch (err) {
        showStatus(convertStatus, 'error', 'Conversion failed: ' + err.message);
    } finally {
        convertBtn.disabled = false;
    }
}

// Solve the grid
async function solveGrid() {
    const grid = gridTextarea.value.trim();
    if (!grid) {
        alert('Please enter or convert a grid first');
        return;
    }

    const k = parseInt(kInput.value);
    if (isNaN(k) || k < 1) {
        alert('Please enter a valid number of walls (k >= 1)');
        return;
    }

    const id = ++requestId;

    try {
        showStatus(solveStatus, 'loading', 'Solving... (this may take a while for large grids)');
        solveBtn.disabled = true;

        const result = await new Promise((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
            solverWorker.postMessage({ type: 'solve', grid, k, id });
        });

        if (result.error) {
            showStatus(solveStatus, 'error', 'Solve failed: ' + result.error);
            return;
        }

        // Show results
        resultSection.style.display = 'block';
        resultArea.textContent = result.area;
        resultWalls.textContent = result.walls.length > 0
            ? result.walls.map(w => `(${w[0]}, ${w[1]})`).join(', ')
            : 'None';
        resultTime.textContent = `${result.time.toFixed(3)}s`;
        renderVisualGrid(result.solvedGrid);

        showStatus(solveStatus, 'success', `Solved in ${result.time.toFixed(3)}s! Enclosed area: ${result.area}`);

        // Scroll to results
        resultSection.scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
        showStatus(solveStatus, 'error', 'Solve failed: ' + err.message);
    } finally {
        solveBtn.disabled = false;
    }
}

// Render visual grid to a container
function renderVisualGridTo(container, gridString) {
    const lines = gridString.trim().split('\n');
    container.innerHTML = '';

    for (const line of lines) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'grid-row';

        for (const char of line) {
            const cellDiv = document.createElement('div');
            cellDiv.className = 'grid-cell';
            cellDiv.textContent = char;

            // Add cell type class based on character
            switch (char) {
                case 'H':
                    cellDiv.classList.add('cell-horse');
                    break;
                case '.':
                    cellDiv.classList.add('cell-grass');
                    break;
                case '#':
                    cellDiv.classList.add('cell-water');
                    break;
                case 'X':
                    cellDiv.classList.add('cell-wall');
                    break;
                case '&':
                    cellDiv.classList.add('cell-enclosed');
                    break;
                default:
                    cellDiv.classList.add('cell-unknown');
            }

            rowDiv.appendChild(cellDiv);
        }

        container.appendChild(rowDiv);
    }
}

// Render visual grid for result
function renderVisualGrid(gridString) {
    renderVisualGridTo(resultGridVisual, gridString);
}

// Render input visual grid
function renderInputVisualGrid() {
    const gridString = gridTextarea.value.trim();
    if (gridString) {
        renderVisualGridTo(inputGridVisual, gridString);
    } else {
        inputGridVisual.innerHTML = '<span style="color: #999;">No grid to display</span>';
    }
}

// Tab switching
function setupTabs() {
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show/hide content
            if (targetTab === 'ascii') {
                asciiTab.classList.remove('hidden');
                visualTab.classList.add('hidden');
            } else {
                asciiTab.classList.add('hidden');
                visualTab.classList.remove('hidden');
                // Render visual grid when switching to visual tab
                renderInputVisualGrid();
            }
        });
    });

    // Update visual grid when textarea changes
    gridTextarea.addEventListener('input', () => {
        if (!visualTab.classList.contains('hidden')) {
            renderInputVisualGrid();
        }
    });
}

// Toggle manual mode options
function toggleManualOptions() {
    const isManual = modeSelect.value === 'manual';
    document.querySelectorAll('.manual-only').forEach(el => {
        el.style.display = isManual ? 'flex' : 'none';
    });
}

// Event listeners
pasteBtn.addEventListener('click', handlePaste);
fileInput.addEventListener('change', handleFileSelect);
modeSelect.addEventListener('change', toggleManualOptions);
convertBtn.addEventListener('click', convertImage);
solveBtn.addEventListener('click', solveGrid);

// Handle paste anywhere on the page
document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (blob) {
                try {
                    await loadImage(blob, 'from clipboard');
                } catch (err) {
                    console.error('Paste error:', err);
                }
            }
            break;
        }
    }
});

// Load default example image and run full flow
async function loadDefaultExample() {
    try {
        // Set manual mode with 12x12
        modeSelect.value = 'manual';
        rowsInput.value = '12';
        colsInput.value = '12';
        kInput.value = '8';
        toggleManualOptions();

        // Load the example image
        const response = await fetch('example_12x12.png');
        const blob = await response.blob();
        await loadImage(blob, 'example_12x12.png');

        // Auto-convert
        await convertImage();

        // Auto-solve
        await solveGrid();
    } catch (err) {
        console.log('Could not load default example:', err);
    }
}

// Initialize
initWorkers();
setupTabs();
toggleManualOptions();
loadDefaultExample();
