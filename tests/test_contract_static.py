# tests/test_contract_static.py
# Locally runnable checks for contracts/riddle_keeper.py.
# Runs with plain python3 (stdlib only) — no `genlayer` package, no
# Studio, no gltest harness needed:
#     python3 tests/test_contract_static.py
#
# It verifies: the file compiles, the header pins the py-genlayer hash
# confirmed from genlayer-studio main, the contract declares every
# method the design calls for with the right decorators, and every
# `gl.*` call used is one confirmed from the repo's own examples
# (wizard_of_coin.py, llm_erc20.py, faucet.py, tip_jar.py) or the
# GenLayer value-transfers docs — no invented API.

import ast
import json
import py_compile
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contracts" / "riddle_keeper.py"

EXPECTED_DEPENDS_HASH = "9b8kjyda2ycxyq4ea6g4yfpnydxhd52gqba5rb8dw7krkh5mn9p0"

# Every dotted gl.* name the contract is allowed to use, each confirmed
# from a repo source (see README.md "API surface" section).
ALLOWED_GL_CALLS = {
    "gl.contract.Contract",
    "gl.evm.contract_interface",
    "gl.public.view",
    "gl.public.write",
    "gl.public.write.payable",
    "gl.storage.TreeMap",
    "gl.message.sender_address",
    "gl.message.value",
    "gl.vm.UserError",
    "gl.nondet.exec_prompt",
    "gl.eq_principle.prompt_comparative",
}

EXPECTED_METHODS = {
    "__init__": None,
    "attempt": "gl.public.write.payable",
    "set_riddle": "gl.public.write",
    "claim_winnings": "gl.public.write",
    "get_riddle": "gl.public.view",
    "get_solution_criteria": "gl.public.view",
    "get_keeper": "gl.public.view",
    "get_coin_holder": "gl.public.view",
    "get_prize_pool": "gl.public.view",
    "get_round": "gl.public.view",
    "get_stake_amount": "gl.public.view",
    "get_max_attempts": "gl.public.view",
    "get_attempts": "gl.public.view",
    "get_wins": "gl.public.view",
    "get_points": "gl.public.view",
    "get_winnings": "gl.public.view",
    "get_claimed": "gl.public.view",
    "get_leaderboard": "gl.public.view",
    "get_contract_balance": "gl.public.view",
}

EXPECTED_STATE_FIELDS = {
    "riddle",
    "solution_criteria",
    "keeper",
    "coin_holder",
    "prize_pool",
    "round",
    "stake_amount",
    "max_attempts_per_round",
    "attempts",
    "attempts_round",
    "wins",
    "points",
    "winnings",
    "claimed",
}

failures = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def main():
    # 1. Compiles.
    try:
        py_compile.compile(str(CONTRACT), doraise=True)
        check("py_compile", True)
    except py_compile.PyCompileError as e:
        check("py_compile", False, str(e))
        print(f"{len(failures)} failure(s)")
        return 1

    src = CONTRACT.read_text()
    lines = src.splitlines()

    # 2. Header pins the verified py-genlayer hash.
    check("header version is # v0.3.0", lines[0].strip() == "# v0.3.0", lines[0])
    try:
        depends = json.loads(lines[1].lstrip("# ").strip())
        check(
            "Depends hash matches genlayer-studio main",
            depends.get("Depends") == f"py-genlayer:{EXPECTED_DEPENDS_HASH}",
            lines[1],
        )
    except (json.JSONDecodeError, IndexError) as e:
        check("Depends line parses", False, str(e))

    tree = ast.parse(src)

    # 3. RiddleKeeper class, methods, decorators.
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef)]
    rk = next((c for c in classes if c.name == "RiddleKeeper"), None)
    check("class RiddleKeeper exists", rk is not None)
    if rk is None:
        print(f"{len(failures)} failure(s)")
        return 1
    check(
        "RiddleKeeper extends gl.contract.Contract",
        any(dotted(b) == "gl.contract.Contract" for b in rk.bases),
    )
    methods = {n.name: n for n in rk.body if isinstance(n, ast.FunctionDef)}
    for name, decorator in EXPECTED_METHODS.items():
        check(f"method {name} exists", name in methods)
        if name in methods and decorator:
            decs = {dotted(d) for d in methods[name].decorator_list}
            check(f"method {name} has @{decorator}", decorator in decs, str(decs))

    # 4. State fields declared as class annotations.
    annotated = {
        t.target.id
        for n in rk.body
        if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)
        for t in [n]
    }
    missing = EXPECTED_STATE_FIELDS - annotated
    check("all spec'd state fields declared", not missing, f"missing: {sorted(missing)}")

    # 5. Only confirmed gl.* API surface is used. Collect dotted names,
    # then drop any name that is merely a prefix of a longer one
    # (e.g. "gl.public" inside "gl.public.write.payable").
    used = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            d = dotted(node)
            if d and d.startswith("gl."):
                used.add(d)
    used = {u for u in used if not any(v != u and v.startswith(u + ".") for v in used)}
    invented = {u for u in used if u not in ALLOWED_GL_CALLS}
    check("no invented gl.* calls", not invented, f"unconfirmed: {sorted(invented)}")

    # 6. The unconfirmed `gl.message.sender` must not appear anywhere.
    check(
        "no bare gl.message.sender (repo uses sender_address)",
        "gl.message.sender\n" not in src and "gl.message.sender " not in src
        and "gl.message.sender)" not in src and "gl.message.sender," not in src
        and "gl.message.sender]" not in src,
    )

    # 7. Transfer uses the faucet pattern: emit_transfer(value=...).
    check(
        "claim uses emit_transfer(value=...)",
        "emit_transfer(value=" in src,
    )

    # 8. No plaintext answer is stored: no state field resembles an answer.
    answerish = {f for f in annotated if "answer" in f.lower() and f != "solution_criteria"}
    check("no plaintext-answer state field", not answerish, str(answerish))

    print(f"{len(failures)} failure(s)" if failures else "all checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
