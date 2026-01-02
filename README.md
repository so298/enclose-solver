# Enclose Solver

A solver for [enclose.horse](https://enclose.horse/) puzzles.

Given a grid with a horse, grass, and water tiles, this solver finds the optimal wall placements to maximize the enclosed area while preventing the horse from escaping to the boundary.

**Try it online: https://so298.github.io/enclose-solver/**

## Features

- **Web Application**: Browser-based solver with visual grid display
- **Screenshot to ASCII**: Convert game screenshots to ASCII grid format
- **WASM-powered**: Fast solving using WebAssembly
- **CLI Tools**: Python and C++ command-line solvers

## Web Application

### Quick Start

```bash
# Start local server
python -m http.server 8000 --directory web

# Open http://localhost:8000
```

### Usage

1. **Load an image**: Paste from clipboard or upload a screenshot
2. **Convert to ASCII**: Click "Convert to ASCII" (use Manual mode if auto-detection fails)
3. **Solve**: Set the number of walls (k) and click "Solve"
4. **View results**: See the solution with color-coded grid

### Grid Legend

| Symbol | Color  | Meaning |
|--------|--------|---------|
| H      | White  | Horse   |
| .      | Green  | Grass   |
| #      | Blue   | Water   |
| X      | Gray   | Wall    |
| &      | Yellow | Enclosed area |

## CLI Usage

### C++ Solver

```bash
# Compile
clang++ -O2 -std=c++17 -o solve2 solve2.cpp

# Run
./solve2 -k 6 < input.txt
```

### Screenshot to ASCII Converter

```bash
# Auto grid-line detection
python screenshot_to_ascii.py screenshot.png

# Manual grid size
python screenshot_to_ascii.py screenshot.png --rows 16 --cols 19

# From clipboard
python screenshot_to_ascii.py --clipboard
```

## Building WASM from Source

Requires [Emscripten](https://emscripten.org/).

```bash
# Setup emsdk
source emsdk/emsdk_env.sh

# Compile
em++ -O2 -std=c++17 -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME="SolveModule" \
  -s ALLOW_MEMORY_GROWTH=1 --bind -o web/wasm/solve2.js solve2_wasm.cpp
```

## Algorithm

The solver uses a **vertex-cut minimum separator** approach:

1. **Graph Construction**: Build a graph where each walkable cell is a node
2. **Split Graph**: Convert vertex cuts to edge cuts by splitting each node into in/out pairs
3. **Max-Flow**: Use Ford-Fulkerson algorithm to find minimum separators
4. **DFS with Pruning**: Explore wall placement combinations with memoization
5. **Early Termination**: Stop when max flow exceeds the wall limit (k)

The algorithm is optimal for small k values (k ≤ 10-20).

## Project Structure

```
.
├── solver.hpp           # Header-only core solver library
├── solve2.cpp           # Native CLI solver
├── solve2_wasm.cpp      # WASM bindings
├── screenshot_to_ascii.py  # Image to ASCII converter
└── web/
    ├── index.html       # Web UI
    ├── main.js          # Frontend logic
    ├── style.css        # Styles
    ├── lib/
    │   └── image-to-ascii.js  # JS port of screenshot converter
    ├── workers/
    │   ├── solver.worker.js   # WASM solver worker
    │   └── image.worker.js    # Image processing worker
    └── wasm/
        ├── solve2.js    # Emscripten glue code
        └── solve2.wasm  # Compiled WASM module
```

## License

MIT
