// solver.worker.js - Web Worker for WASM solver
// Runs the enclose solver in the background

let Module = null;
let moduleReady = false;
let initPromise = null;

// Load the WASM module
async function initModule() {
    if (moduleReady) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            // Import the Emscripten module factory
            importScripts('../wasm/solve2.js');

            // SolveModule is now available as a global function
            // Call it to initialize and get the module instance
            Module = await SolveModule({
                // Provide locateFile to help find the .wasm file
                locateFile: (path) => {
                    if (path.endsWith('.wasm')) {
                        return '../wasm/' + path;
                    }
                    return path;
                }
            });

            moduleReady = true;
            self.postMessage({ type: 'ready' });
            return true;
        } catch (error) {
            console.error('Failed to load WASM module:', error);
            self.postMessage({ type: 'error', error: `Failed to load WASM module: ${error.message}` });
            return false;
        }
    })();

    return initPromise;
}

// Initialize on worker start
initModule();

// Handle messages from main thread
self.onmessage = async function(e) {
    const { type, grid, k, id } = e.data;

    if (type === 'solve') {
        const ready = await initModule();
        if (!ready || !moduleReady) {
            self.postMessage({ type: 'result', id, error: 'WASM module not ready' });
            return;
        }

        try {
            const startTime = performance.now();

            // Call the WASM function
            const resultJson = Module.solveGrid(grid, k);
            const result = JSON.parse(resultJson);

            const endTime = performance.now();
            result.time = (endTime - startTime) / 1000; // seconds

            self.postMessage({ type: 'result', id, result });
        } catch (error) {
            self.postMessage({ type: 'result', id, error: error.message });
        }
    }
};
