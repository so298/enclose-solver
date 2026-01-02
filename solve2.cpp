// solve2.cpp - Native command-line solver
// Compile with: clang++ -O2 -std=c++17 -o solve2 solve2.cpp

#include <iostream>
#include <string>
#include <vector>

#include "solver.hpp"

using std::string;
using std::vector;

/* ---------------- Output ---------------- */

void print_ans(int area, const vector<std::pair<int,int>>& walls, const vector<string>& grid_original) {
    std::cout << "max enclosed area: " << area << "\n";
    std::cout << "walls: [";
    for (size_t i = 0; i < walls.size(); i++) {
        if (i) std::cout << ", ";
        std::cout << "(" << walls[i].first << ", " << walls[i].second << ")";
    }
    std::cout << "]\n";

    vector<string> g = grid_original;
    for (const auto& rc : walls) {
        g[static_cast<size_t>(rc.first)][static_cast<size_t>(rc.second)] = 'X';
    }
    for (const auto& row : g) std::cout << row << "\n";
}

/* ---------------- main ---------------- */

int main(int argc, char** argv) {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int k = 6;
    for (int i = 1; i < argc; i++) {
        string a = argv[i];
        if (a == "-k" && i + 1 < argc) {
            k = std::stoi(argv[++i]);
        }
    }

    vector<string> lines;
    string s;
    while (std::getline(std::cin, s)) {
        if (!s.empty() && s.back() == '\r') s.pop_back();
        if (!s.empty()) lines.push_back(s);
    }
    if (lines.empty()) return 0;

    vector<string> grid;
    for (const auto& row : lines) {
        if (!row.empty()) grid.push_back(row);
    }
    if (grid.empty()) return 0;

    enclose::SolveResult res = enclose::solve(k, grid);
    print_ans(res.best_area, res.walls, grid);
    return 0;
}
