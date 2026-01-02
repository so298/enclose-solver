import sys
from collections import deque
import argparse
import time


class FlowTemplate:
    """
    Residual-network template for max-flow.
    k が小さい(<= 10〜20程度)前提なので、
    BFS で増加路を探して 1ずつ流す Ford-Fulkerson を使う。
    （最大でも k+1 回しか増加しないので十分速い）
    """
    __slots__ = ("n", "adj", "in_adj", "to", "frm", "rev", "base_cap")

    def __init__(self, n: int):
        self.n = n
        self.adj = [[] for _ in range(n)]      # outgoing edge indices
        self.in_adj = [[] for _ in range(n)]   # incoming edge indices
        self.to = []
        self.frm = []
        self.rev = []
        self.base_cap = []

    def add_edge(self, u: int, v: int, c: int) -> int:
        """Add directed edge u->v with capacity c and its reverse edge."""
        idx = len(self.to)
        # forward
        self.to.append(v)
        self.frm.append(u)
        self.rev.append(idx + 1)
        self.base_cap.append(c)
        # reverse
        self.to.append(u)
        self.frm.append(v)
        self.rev.append(idx)
        self.base_cap.append(0)

        self.adj[u].append(idx)
        self.adj[v].append(idx + 1)

        self.in_adj[v].append(idx)
        self.in_adj[u].append(idx + 1)
        return idx  # forward edge index

    def maxflow_limit(self, s: int, t: int, cap: list[int], limit: int) -> int:
        """
        Compute max flow up to `limit` (early stop when flow reaches limit).
        Each augmentation sends 1 unit.
        """
        n = self.n
        flow = 0
        adj = self.adj
        to = self.to
        rev = self.rev
        frm = self.frm

        while flow < limit:
            parent = [-1] * n
            q = deque([s])
            parent[s] = -2  # visited mark

            # BFS to find any augmenting path
            while q and parent[t] == -1:
                u = q.popleft()
                for e in adj[u]:
                    if cap[e] <= 0:
                        continue
                    v = to[e]
                    if parent[v] != -1:
                        continue
                    parent[v] = e
                    if v == t:
                        q.clear()
                        break
                    q.append(v)

            if parent[t] == -1:
                break

            # augment by 1
            v = t
            while v != s:
                e = parent[v]
                cap[e] -= 1
                cap[rev[e]] += 1
                v = frm[e]
            flow += 1

        return flow


def solve(k: int, grid: list[str]):
    R = len(grid)
    C = len(grid[0])

    # find horse
    hr = hc = -1
    for r in range(R):
        row = grid[r]
        for c in range(C):
            if row[c] == "H":
                hr, hc = r, c
                break
        if hr != -1:
            break
    if hr == -1:
        raise ValueError("grid に 'H' が見つかりません")

    def is_open(r: int, c: int) -> bool:
        return grid[r][c] in ".H"

    # Universe = horse から到達できるマスだけに絞る（壁は到達可能集合を増やせないので安全）
    idx_of = {(hr, hc): 0}
    coords = [(hr, hc)]
    q = deque([(hr, hc)])
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))  # deterministic
    while q:
        r, c = q.popleft()
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C and is_open(nr, nc) and (nr, nc) not in idx_of:
                idx_of[(nr, nc)] = len(coords)
                coords.append((nr, nc))
                q.append((nr, nc))

    N = len(coords)
    horse_idx = 0  # horse was inserted first

    # adjacency on original graph
    adj = [[] for _ in range(N)]
    boundary_mask = 0
    wallable = [False] * N  # '.' only

    for i, (r, c) in enumerate(coords):
        if r == 0 or r == R - 1 or c == 0 or c == C - 1:
            boundary_mask |= 1 << i
        wallable[i] = (grid[r][c] == ".")
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            j = idx_of.get((nr, nc))
            if j is not None:
                adj[i].append(j)

    # horse on boundary => impossible to enclose (can't wall 'H')
    if (boundary_mask >> horse_idx) & 1:
        return 0, []

    # Build split graph (vertex cut -> edge cut)
    INF = k + 1
    node_count = 2 * N + 2
    SRC = 2 * N
    SNK = 2 * N + 1

    flow = FlowTemplate(node_count)
    cell_edge_idx = [0] * N  # in->out edge index
    src_edge_idx = [0] * N   # SRC->out edge index

    # vertex edges
    for i in range(N):
        cap_cell = INF if (i == horse_idx or not wallable[i]) else 1
        cell_edge_idx[i] = flow.add_edge(2 * i, 2 * i + 1, cap_cell)

    # adjacency edges (undirected -> directed in split graph)
    for i in range(N):
        out_i = 2 * i + 1
        for j in adj[i]:
            flow.add_edge(out_i, 2 * j, INF)

    # boundary -> outside sink
    for i in range(N):
        if (boundary_mask >> i) & 1:
            flow.add_edge(2 * i + 1, SNK, INF)

    # source edges (prepared for all vertices)
    for i in range(N):
        cap_src = INF if i == horse_idx else 0
        src_edge_idx[i] = flow.add_edge(SRC, 2 * i + 1, cap_src)

    base_cap = flow.base_cap

    def bfs_reachable(blocked_mask: int):
        """reachable cells from horse in original graph with blocked vertices."""
        if (blocked_mask >> horse_idx) & 1:
            return 0, 0, True
        vis = 0
        dq = deque([horse_idx])
        vis |= 1 << horse_idx
        while dq:
            u = dq.popleft()
            for v in adj[u]:
                if (blocked_mask >> v) & 1:
                    continue
                if (vis >> v) & 1:
                    continue
                vis |= 1 << v
                dq.append(v)
        area = vis.bit_count()
        escapes = (vis & boundary_mask) != 0
        return vis, area, escapes

    def min_separator(deleted_mask: int, forced_mask: int, k_rem: int):
        cap = base_cap.copy()

        # apply deletions
        dm = deleted_mask
        while dm:
            lsb = dm & -dm
            i = lsb.bit_length() - 1
            cap[cell_edge_idx[i]] = 0
            dm -= lsb

        # apply forced: undeletable + connect to SRC
        fm = forced_mask
        while fm:
            lsb = fm & -fm
            i = lsb.bit_length() - 1
            if (deleted_mask >> i) & 1:
                return None
            cap[cell_edge_idx[i]] = INF
            cap[src_edge_idx[i]] = INF
            fm -= lsb

        f = flow.maxflow_limit(SRC, SNK, cap, k_rem + 1)
        if f > k_rem:
            return None

        # Rmax via "nodes that can reach sink" in residual graph
        can = [False] * node_count
        dq = deque([SNK])
        can[SNK] = True
        in_adj = flow.in_adj
        frm = flow.frm
        while dq:
            v = dq.popleft()
            for e in in_adj[v]:
                u = frm[e]
                if cap[e] > 0 and not can[u]:
                    can[u] = True
                    dq.append(u)

        sep_mask = 0
        for i in range(N):
            if not wallable[i]:
                continue
            if (deleted_mask >> i) & 1 or (forced_mask >> i) & 1:
                continue
            inn = 2 * i
            out = 2 * i + 1
            if (not can[inn]) and can[out]:
                sep_mask |= 1 << i

        return sep_mask

    best_area = 0
    best_walls = 0
    start_forced = 1 << horse_idx
    visited_states = set()

    def dfs(deleted_mask: int, forced_mask: int, k_rem: int):
        nonlocal best_area, best_walls
        key = (deleted_mask, forced_mask, k_rem)
        if key in visited_states:
            return
        visited_states.add(key)

        vis_now, ub_area, _ = bfs_reachable(deleted_mask)
        if ub_area <= best_area:
            return
        if forced_mask & ~vis_now:
            return

        sep = min_separator(deleted_mask, forced_mask, k_rem)
        if sep is None:
            return

        cand_walls = deleted_mask | sep
        _, area, escapes = bfs_reachable(cand_walls)
        if (not escapes) and area > best_area:
            best_area = area
            best_walls = cand_walls

        if k_rem == 0 or sep == 0:
            return

        v_bit = sep & -sep
        v = v_bit.bit_length() - 1

        # exclude-first (often improves pruning faster for maximize-area)
        dfs(deleted_mask, forced_mask | (1 << v), k_rem)          # do NOT wall v
        dfs(deleted_mask | (1 << v), forced_mask, k_rem - 1)      # wall v

    dfs(0, start_forced, k)

    walls = []
    m = best_walls
    while m:
        lsb = m & -m
        i = lsb.bit_length() - 1
        walls.append(coords[i])
        m -= lsb
    walls.sort()
    return best_area, walls


def print_ans(area, walls, grid_original):
    print(f"max enclosed area: {area}")
    print(f"walls: {walls}")

    grid = [list(row) for row in grid_original]
    for r, c in walls:
        grid[r][c] = "X"
    for row in grid:
        print("".join(row))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-k", type=int, default=6, help="Number of walls available")

    t_start = time.time()
    lines = [line.rstrip("\n") for line in sys.stdin]
    while lines and lines[-1] == "":
        lines.pop()
    if not lines:
        return
    args = parser.parse_args()
    k = args.k
    grid = [s.rstrip("\n") for s in lines if s.strip("\n") != ""]
    if not grid:
        return

    ans, walls = solve(k, grid)
    t_end = time.time()
    print(f"Time taken: {t_end - t_start:.3f} seconds")
    print_ans(ans, walls, grid)


if __name__ == "__main__":
    main()
