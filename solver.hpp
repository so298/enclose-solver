#pragma once

// solver.hpp - Header-only implementation of the enclose solver
// Include this in both native (solve2.cpp) and WASM (solve2_wasm.cpp) builds

#include <algorithm>
#include <cstdint>
#include <deque>
#include <functional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace enclose {

using std::deque;
using std::function;
using std::pair;
using std::size_t;
using std::string;
using std::unordered_map;
using std::unordered_set;
using std::vector;

/* ---------------- DynamicBitset (vector<uint64_t> based) ---------------- */

struct DynamicBitset {
    int nbits = 0;
    vector<uint64_t> w;

    DynamicBitset() = default;
    explicit DynamicBitset(int n) { init(n); }

    void init(int n) {
        nbits = n;
        w.assign((n + 63) / 64, 0ULL);
    }

    inline void set(int i) {
        w[static_cast<size_t>(i >> 6)] |= (1ULL << (i & 63));
    }
    inline void reset(int i) {
        w[static_cast<size_t>(i >> 6)] &= ~(1ULL << (i & 63));
    }
    inline bool test(int i) const {
        return (w[static_cast<size_t>(i >> 6)] >> (i & 63)) & 1ULL;
    }

    inline bool empty() const {
        for (uint64_t x : w) if (x) return false;
        return true;
    }

    inline int popcount() const {
        int s = 0;
        for (uint64_t x : w) s += __builtin_popcountll(x);
        return s;
    }

    inline void or_with(const DynamicBitset& other) {
        for (size_t i = 0; i < w.size(); i++) w[i] |= other.w[i];
    }

    inline DynamicBitset operator|(const DynamicBitset& other) const {
        DynamicBitset r(*this);
        r.or_with(other);
        return r;
    }

    inline DynamicBitset operator&(const DynamicBitset& other) const {
        DynamicBitset r(*this);
        for (size_t i = 0; i < w.size(); i++) r.w[i] &= other.w[i];
        return r;
    }

    inline bool intersects(const DynamicBitset& other) const {
        for (size_t i = 0; i < w.size(); i++) {
            if (w[i] & other.w[i]) return true;
        }
        return false;
    }

    inline bool subset_of(const DynamicBitset& sup) const {
        for (size_t i = 0; i < w.size(); i++) {
            if (w[i] & ~sup.w[i]) return false;
        }
        return true;
    }

    template <class F>
    inline void for_each_set_bit(F&& f) const {
        for (size_t wi = 0; wi < w.size(); wi++) {
            uint64_t x = w[wi];
            while (x) {
                uint64_t lsb = x & (~x + 1ULL);
                int b = __builtin_ctzll(x);
                int idx = static_cast<int>(wi * 64 + static_cast<size_t>(b));
                if (idx < nbits) f(idx);
                x -= lsb;
            }
        }
    }

    inline int first_set_bit() const {
        for (size_t wi = 0; wi < w.size(); wi++) {
            uint64_t x = w[wi];
            if (!x) continue;
            int b = __builtin_ctzll(x);
            int idx = static_cast<int>(wi * 64 + static_cast<size_t>(b));
            if (idx < nbits) return idx;
        }
        return -1;
    }

    bool operator==(const DynamicBitset& other) const {
        return nbits == other.nbits && w == other.w;
    }
};

/* ---------------- Hash helpers ---------------- */

inline uint64_t splitmix64(uint64_t x) {
    x += 0x9e3779b97f4a7c15ULL;
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
    return x ^ (x >> 31);
}

struct BitsetHash {
    size_t operator()(const DynamicBitset& b) const noexcept {
        uint64_t h = splitmix64(static_cast<uint64_t>(b.nbits));
        for (uint64_t x : b.w) {
            h ^= splitmix64(x + 0x9e3779b97f4a7c15ULL);
            h = splitmix64(h);
        }
        return static_cast<size_t>(h);
    }
};

struct State {
    DynamicBitset deleted;
    DynamicBitset forced;
    int k_rem = 0;

    bool operator==(const State& o) const {
        return k_rem == o.k_rem && deleted == o.deleted && forced == o.forced;
    }
};

struct StateHash {
    size_t operator()(const State& s) const noexcept {
        BitsetHash bh;
        uint64_t h = static_cast<uint64_t>(bh(s.deleted));
        h ^= splitmix64(static_cast<uint64_t>(bh(s.forced)) + 0x123456789abcdef0ULL);
        h ^= splitmix64(static_cast<uint64_t>(s.k_rem));
        return static_cast<size_t>(h);
    }
};

/* ---------------- FlowTemplate ---------------- */

struct FlowTemplate {
    int n;
    vector<vector<int>> adj;
    vector<vector<int>> in_adj;
    vector<int> to, frm, rev;
    vector<int> base_cap;

    explicit FlowTemplate(int n_) : n(n_), adj(static_cast<size_t>(n_)), in_adj(static_cast<size_t>(n_)) {}

    int add_edge(int u, int v, int c) {
        int idx = static_cast<int>(to.size());
        to.push_back(v);
        frm.push_back(u);
        rev.push_back(idx + 1);
        base_cap.push_back(c);
        to.push_back(u);
        frm.push_back(v);
        rev.push_back(idx);
        base_cap.push_back(0);

        adj[static_cast<size_t>(u)].push_back(idx);
        adj[static_cast<size_t>(v)].push_back(idx + 1);

        in_adj[static_cast<size_t>(v)].push_back(idx);
        in_adj[static_cast<size_t>(u)].push_back(idx + 1);

        return idx;
    }

    int maxflow_limit(int s, int t, vector<int>& cap, int limit) const {
        int flow = 0;
        vector<int> parent(static_cast<size_t>(n), -1);

        while (flow < limit) {
            std::fill(parent.begin(), parent.end(), -1);
            deque<int> q;
            q.push_back(s);
            parent[static_cast<size_t>(s)] = -2;

            while (!q.empty() && parent[static_cast<size_t>(t)] == -1) {
                int u = q.front();
                q.pop_front();
                for (int e : adj[static_cast<size_t>(u)]) {
                    if (cap[static_cast<size_t>(e)] <= 0) continue;
                    int v = to[static_cast<size_t>(e)];
                    if (parent[static_cast<size_t>(v)] != -1) continue;
                    parent[static_cast<size_t>(v)] = e;
                    if (v == t) {
                        q.clear();
                        break;
                    }
                    q.push_back(v);
                }
            }

            if (parent[static_cast<size_t>(t)] == -1) break;

            int v = t;
            while (v != s) {
                int e = parent[static_cast<size_t>(v)];
                cap[static_cast<size_t>(e)] -= 1;
                cap[static_cast<size_t>(rev[static_cast<size_t>(e)])] += 1;
                v = frm[static_cast<size_t>(e)];
            }
            flow += 1;
        }
        return flow;
    }
};

/* ---------------- Solver Result ---------------- */

struct SolveResult {
    int best_area = 0;
    vector<pair<int,int>> walls;
};

/* ---------------- Solver Implementation ---------------- */

inline bool is_open_cell(char ch) {
    return ch == '.' || ch == 'H';
}

inline SolveResult solve(int k, const vector<string>& grid) {
    int R = static_cast<int>(grid.size());
    int C = static_cast<int>(grid[0].size());

    int hr = -1, hc = -1;
    for (int r = 0; r < R && hr == -1; r++) {
        for (int c = 0; c < C; c++) {
            if (grid[static_cast<size_t>(r)][static_cast<size_t>(c)] == 'H') {
                hr = r; hc = c; break;
            }
        }
    }
    if (hr == -1) throw std::runtime_error("grid に 'H' が見つかりません");

    unordered_map<long long, int> idx_of;
    idx_of.reserve(static_cast<size_t>(R) * 4);

    auto key = [&](int r, int c) -> long long {
        return (static_cast<long long>(r) << 32) ^ static_cast<unsigned long long>(c);
    };

    vector<pair<int,int>> coords;
    coords.reserve(1024);

    idx_of[key(hr, hc)] = 0;
    coords.push_back({hr, hc});
    deque<pair<int,int>> q;
    q.push_back({hr, hc});

    const int drs[4] = {1, -1, 0, 0};
    const int dcs[4] = {0, 0, 1, -1};

    while (!q.empty()) {
        pair<int,int> cur = q.front();
        q.pop_front();
        int r = cur.first, c = cur.second;

        for (int di = 0; di < 4; di++) {
            int nr = r + drs[di], nc = c + dcs[di];
            if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
            if (!is_open_cell(grid[static_cast<size_t>(nr)][static_cast<size_t>(nc)])) continue;

            long long kk = key(nr, nc);
            if (idx_of.find(kk) != idx_of.end()) continue;

            int id = static_cast<int>(coords.size());
            idx_of[kk] = id;
            coords.push_back({nr, nc});
            q.push_back({nr, nc});
        }
    }

    int N = static_cast<int>(coords.size());
    int horse_idx = 0;

    vector<vector<int>> adj(static_cast<size_t>(N));
    vector<unsigned char> wallable(static_cast<size_t>(N), 0);
    DynamicBitset boundary(N);

    for (int i = 0; i < N; i++) {
        int r = coords[static_cast<size_t>(i)].first;
        int c = coords[static_cast<size_t>(i)].second;

        if (r == 0 || r == R - 1 || c == 0 || c == C - 1) boundary.set(i);
        wallable[static_cast<size_t>(i)] = (grid[static_cast<size_t>(r)][static_cast<size_t>(c)] == '.');

        for (int di = 0; di < 4; di++) {
            int nr = r + drs[di], nc = c + dcs[di];
            long long kk = key(nr, nc);
            auto it = idx_of.find(kk);
            if (it != idx_of.end()) adj[static_cast<size_t>(i)].push_back(it->second);
        }
    }

    if (boundary.test(horse_idx)) {
        return {0, {}};
    }

    const int INF = k + 1;
    int node_count = 2 * N + 2;
    int SRC = 2 * N;
    int SNK = 2 * N + 1;

    FlowTemplate flow(node_count);
    vector<int> cell_edge_idx(static_cast<size_t>(N));
    vector<int> src_edge_idx(static_cast<size_t>(N));

    for (int i = 0; i < N; i++) {
        int cap_cell = (i == horse_idx || !wallable[static_cast<size_t>(i)]) ? INF : 1;
        cell_edge_idx[static_cast<size_t>(i)] = flow.add_edge(2 * i, 2 * i + 1, cap_cell);
    }

    for (int i = 0; i < N; i++) {
        int out_i = 2 * i + 1;
        for (int j : adj[static_cast<size_t>(i)]) {
            flow.add_edge(out_i, 2 * j, INF);
        }
    }

    for (int i = 0; i < N; i++) {
        if (boundary.test(i)) {
            flow.add_edge(2 * i + 1, SNK, INF);
        }
    }

    for (int i = 0; i < N; i++) {
        int cap_src = (i == horse_idx) ? INF : 0;
        src_edge_idx[static_cast<size_t>(i)] = flow.add_edge(SRC, 2 * i + 1, cap_src);
    }

    const vector<int> base_cap = flow.base_cap;

    auto bfs_reachable = [&](const DynamicBitset& blocked,
                             DynamicBitset& vis_out,
                             int& area_out,
                             bool& escapes_out) {
        vis_out.init(N);
        if (blocked.test(horse_idx)) {
            area_out = 0;
            escapes_out = true;
            return;
        }
        deque<int> dq;
        dq.push_back(horse_idx);
        vis_out.set(horse_idx);

        while (!dq.empty()) {
            int u = dq.front();
            dq.pop_front();
            for (int v : adj[static_cast<size_t>(u)]) {
                if (blocked.test(v)) continue;
                if (vis_out.test(v)) continue;
                vis_out.set(v);
                dq.push_back(v);
            }
        }
        area_out = vis_out.popcount();
        escapes_out = vis_out.intersects(boundary);
    };

    auto min_separator = [&](const DynamicBitset& deleted,
                             const DynamicBitset& forced,
                             int k_rem,
                             DynamicBitset& sep_out) -> bool {
        vector<int> cap = base_cap;

        deleted.for_each_set_bit([&](int i) {
            cap[static_cast<size_t>(cell_edge_idx[static_cast<size_t>(i)])] = 0;
        });

        bool ok = true;
        forced.for_each_set_bit([&](int i) {
            if (deleted.test(i)) { ok = false; return; }
            cap[static_cast<size_t>(cell_edge_idx[static_cast<size_t>(i)])] = INF;
            cap[static_cast<size_t>(src_edge_idx[static_cast<size_t>(i)])]  = INF;
        });
        if (!ok) return false;

        int f = flow.maxflow_limit(SRC, SNK, cap, k_rem + 1);
        if (f > k_rem) return false;

        vector<unsigned char> can(static_cast<size_t>(node_count), 0);
        deque<int> dq;
        dq.push_back(SNK);
        can[static_cast<size_t>(SNK)] = 1;

        while (!dq.empty()) {
            int v = dq.front();
            dq.pop_front();
            for (int e : flow.in_adj[static_cast<size_t>(v)]) {
                int u = flow.frm[static_cast<size_t>(e)];
                if (cap[static_cast<size_t>(e)] > 0 && !can[static_cast<size_t>(u)]) {
                    can[static_cast<size_t>(u)] = 1;
                    dq.push_back(u);
                }
            }
        }

        sep_out.init(N);
        for (int i = 0; i < N; i++) {
            if (!wallable[static_cast<size_t>(i)]) continue;
            if (deleted.test(i) || forced.test(i)) continue;
            int inn = 2 * i;
            int out = 2 * i + 1;
            if (!can[static_cast<size_t>(inn)] && can[static_cast<size_t>(out)]) sep_out.set(i);
        }
        return true;
    };

    int best_area = 0;
    DynamicBitset best_walls(N);

    DynamicBitset start_forced(N);
    start_forced.set(horse_idx);

    unordered_set<State, StateHash> visited_states;
    visited_states.reserve(1u << 16);

    function<void(const DynamicBitset&, const DynamicBitset&, int)> dfs =
        [&](const DynamicBitset& deleted, const DynamicBitset& forced, int k_rem) {
            State st{deleted, forced, k_rem};
            if (visited_states.find(st) != visited_states.end()) return;
            visited_states.insert(st);

            DynamicBitset vis_now;
            int ub_area = 0;
            bool esc_dummy = false;
            bfs_reachable(deleted, vis_now, ub_area, esc_dummy);
            if (ub_area <= best_area) return;

            if (!forced.subset_of(vis_now)) return;

            DynamicBitset sep;
            if (!min_separator(deleted, forced, k_rem, sep)) return;

            DynamicBitset cand_walls = deleted | sep;

            DynamicBitset vis2;
            int area2 = 0;
            bool escapes2 = false;
            bfs_reachable(cand_walls, vis2, area2, escapes2);

            if (!escapes2 && area2 > best_area) {
                best_area = area2;
                best_walls = cand_walls;
            }

            if (k_rem == 0 || sep.empty()) return;

            int v = sep.first_set_bit();
            if (v < 0) return;

            DynamicBitset forced2 = forced;
            forced2.set(v);
            dfs(deleted, forced2, k_rem);

            DynamicBitset deleted2 = deleted;
            deleted2.set(v);
            dfs(deleted2, forced, k_rem - 1);
        };

    DynamicBitset empty_deleted(N);
    dfs(empty_deleted, start_forced, k);

    vector<pair<int,int>> walls;
    best_walls.for_each_set_bit([&](int i) {
        walls.push_back(coords[static_cast<size_t>(i)]);
    });
    std::sort(walls.begin(), walls.end());

    SolveResult res;
    res.best_area = best_area;
    res.walls = std::move(walls);
    return res;
}

} // namespace enclose
