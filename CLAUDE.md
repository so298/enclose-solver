# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a graph algorithm solver for the "horse enclosure" puzzle: given a grid with a horse (H), grass (.), and water (#), find optimal wall (X) placements to maximize the enclosed area while preventing the horse from escaping to the boundary.

## Commands

### Setup
```bash
uv sync  # Install Python dependencies
```

### Running the Solver
```bash
# Python solver
python solve2.py -k 6 < input.txt

# C++ solver (faster, pre-compiled binary exists)
./solve2 -k 6 < input.txt
```

### Screenshot to ASCII Converter
```bash
# Auto grid-line detection
python screenshot_to_ascii.py screenshot.png

# Manual grid size
python screenshot_to_ascii.py screenshot.png --rows 16 --cols 19

# With image cropping
python screenshot_to_ascii.py screenshot.png --rows 16 --cols 19 --crop 0.02,0.02,0.02,0.04

# From clipboard
python screenshot_to_ascii.py --clipboard
```

### Compiling C++ Solver
```bash
clang++ -O2 -std=c++17 -o solve2 solve2.cpp
```

### Web Application
```bash
# Compile WASM (requires emsdk)
source emsdk/emsdk_env.sh
em++ -O2 -std=c++17 -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME="SolveModule" \
  -s ALLOW_MEMORY_GROWTH=1 --bind -o web/wasm/solve2.js solve2_wasm.cpp

# Start local server
python -m http.server 8000 --directory web
# Open http://localhost:8000
```

## Architecture

### Core Algorithm (solve2.py, solve2.cpp)
- **Vertex-cut minimum separator problem** solved via max-flow (Ford-Fulkerson with BFS)
- **Split graph construction**: vertices split into in/out nodes to convert vertex cuts to edge cuts
- **DFS with pruning**: explores wall placement combinations with memoization
- Key parameter: `-k` specifies maximum number of walls (default: 6)
- Optimal for small k (k <= 10-20) due to early termination when max flow exceeds limit

### Screenshot Converter (screenshot_to_ascii.py)
- Converts game screenshots to ASCII grid input
- Auto mode: detects grid lines using edge detection and peak finding
- Manual mode: uniform grid splitting with specified rows/cols
- Tile classification by color analysis: grass (.), water (#), horse (H)

### Web Application (web/)
- **solver.hpp**: Header-only library shared between native and WASM builds
- **solve2_wasm.cpp**: Embind bindings for WASM export
- **web/lib/image-to-ascii.js**: JavaScript port of screenshot converter
- **web/workers/**: Web Workers for background execution (solver, image processing)
- **web/wasm/**: Compiled WASM module (solve2.js, solve2.wasm)

### Grid Format
```
....#....
...#H#...
....#....
```
- `.` = grass (walkable, can place wall)
- `#` = water (impassable)
- `H` = horse (must enclose, cannot wall)
- `X` = wall (in output)
