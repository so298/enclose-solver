// solve2_wasm.cpp - WebAssembly bindings for enclose solver
// Compile with:
// source emsdk/emsdk_env.sh
// em++ -O2 -std=c++17 -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME="SolveModule" \
//   -s ALLOW_MEMORY_GROWTH=1 --bind -o web/wasm/solve2.js solve2_wasm.cpp

#include <sstream>
#include <string>
#include <vector>

#include <emscripten/bind.h>

#include "solver.hpp"

using std::string;
using std::vector;

/* ---------------- WASM Interface ---------------- */

// Parse grid string (newline separated) into vector<string>
vector<string> parseGrid(const string& gridStr) {
    vector<string> grid;
    std::istringstream iss(gridStr);
    string line;
    while (std::getline(iss, line)) {
        // Remove trailing \r if present
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (!line.empty()) {
            grid.push_back(line);
        }
    }
    return grid;
}

// Build solved grid string with walls marked as 'X' and enclosed area marked as '&'
string buildSolvedGrid(const vector<string>& grid, const vector<std::pair<int,int>>& walls) {
    int R = static_cast<int>(grid.size());
    int C = static_cast<int>(grid[0].size());

    vector<string> g = grid;

    // Mark walls
    for (const auto& rc : walls) {
        g[static_cast<size_t>(rc.first)][static_cast<size_t>(rc.second)] = 'X';
    }

    // Find horse position
    int hr = -1, hc = -1;
    for (int r = 0; r < R && hr == -1; r++) {
        for (int c = 0; c < C; c++) {
            if (g[static_cast<size_t>(r)][static_cast<size_t>(c)] == 'H') {
                hr = r; hc = c; break;
            }
        }
    }

    if (hr == -1) {
        // No horse found, just return grid with walls
        string result;
        for (const auto& row : g) result += row + "\n";
        return result;
    }

    // BFS to find enclosed area (reachable from horse)
    vector<vector<bool>> visited(static_cast<size_t>(R), vector<bool>(static_cast<size_t>(C), false));
    std::deque<std::pair<int,int>> q;
    q.push_back({hr, hc});
    visited[static_cast<size_t>(hr)][static_cast<size_t>(hc)] = true;

    const int drs[4] = {1, -1, 0, 0};
    const int dcs[4] = {0, 0, 1, -1};

    while (!q.empty()) {
        auto [r, c] = q.front();
        q.pop_front();

        for (int di = 0; di < 4; di++) {
            int nr = r + drs[di], nc = c + dcs[di];
            if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
            if (visited[static_cast<size_t>(nr)][static_cast<size_t>(nc)]) continue;

            char ch = g[static_cast<size_t>(nr)][static_cast<size_t>(nc)];
            if (ch == '#' || ch == 'X') continue; // blocked

            visited[static_cast<size_t>(nr)][static_cast<size_t>(nc)] = true;
            q.push_back({nr, nc});
        }
    }

    // Mark enclosed grass cells as '&'
    for (int r = 0; r < R; r++) {
        for (int c = 0; c < C; c++) {
            if (visited[static_cast<size_t>(r)][static_cast<size_t>(c)] &&
                g[static_cast<size_t>(r)][static_cast<size_t>(c)] == '.') {
                g[static_cast<size_t>(r)][static_cast<size_t>(c)] = '&';
            }
        }
    }

    string result;
    for (const auto& row : g) {
        result += row + "\n";
    }
    return result;
}

// Main exported function - returns JSON string
string solveGrid(const string& gridStr, int k) {
    try {
        vector<string> grid = parseGrid(gridStr);
        if (grid.empty()) {
            return R"({"error": "Empty grid"})";
        }

        enclose::SolveResult res = enclose::solve(k, grid);

        // Build JSON response manually
        std::ostringstream json;
        json << "{";
        json << "\"area\": " << res.best_area << ",";
        json << "\"walls\": [";
        for (size_t i = 0; i < res.walls.size(); i++) {
            if (i > 0) json << ",";
            json << "[" << res.walls[i].first << "," << res.walls[i].second << "]";
        }
        json << "],";
        json << "\"solvedGrid\": \"";

        string solvedGrid = buildSolvedGrid(grid, res.walls);
        // Escape newlines for JSON
        for (char c : solvedGrid) {
            if (c == '\n') json << "\\n";
            else if (c == '"') json << "\\\"";
            else if (c == '\\') json << "\\\\";
            else json << c;
        }
        json << "\"";
        json << "}";

        return json.str();
    } catch (const std::exception& e) {
        std::ostringstream json;
        json << "{\"error\": \"" << e.what() << "\"}";
        return json.str();
    }
}

// Embind bindings
EMSCRIPTEN_BINDINGS(solve_module) {
    emscripten::function("solveGrid", &solveGrid);
}
