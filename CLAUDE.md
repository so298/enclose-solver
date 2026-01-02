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
