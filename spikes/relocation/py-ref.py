"""S5 reference: Scrapling's own relocation code, run on the spike corpus.

Everything here calls the library as shipped — the private scoring method is used
only to expose the *whole* score table, which is a much stronger comparison than
the winning element alone.
"""
import json
import sys

from scrapling import Selector
from scrapling.core.utils._utils import _StorageTools


def ser(value):
    if isinstance(value, tuple):
        return [ser(v) for v in value]
    if isinstance(value, dict):
        return {k: ser(v) for k, v in value.items()}
    return value


def main():
    with open(sys.argv[2] if len(sys.argv) > 2 else "corpus.json", encoding="utf-8") as fh:
        corpus = json.load(fh)

    out = {}
    for case in corpus:
        entry = {}
        try:
            original = Selector(case["original"])
            changed = Selector(case["changed"])

            targets = original.xpath(case["target"])
            if not targets:
                entry["error"] = "target not found in original"
                out[case["id"]] = entry
                continue

            target = targets[0]
            fp = _StorageTools.element_to_dict(target._root)

            score_fn = changed._Selector__calculate_similarity_score
            scores = {}
            for node in changed._root.xpath(".//*"):
                scores[node.getroottree().getpath(node)] = score_fn(fp, node)

            relocated = changed.relocate(fp)
            similar = target.find_similar()

            # find_similar runs on the *changed* tree: re-resolve the target there.
            changed_targets = changed.xpath(case["target"])
            similar_paths = []
            if changed_targets:
                similar_paths = [
                    s._root.getroottree().getpath(s._root)
                    for s in changed_targets[0].find_similar()
                ]

            entry.update(
                {
                    "fp": ser(fp),
                    "scores": scores,
                    "relocate": [n.getroottree().getpath(n) for n in relocated],
                    "findSimilarSameTree": [
                        s._root.getroottree().getpath(s._root) for s in similar
                    ],
                    "findSimilarChangedTree": similar_paths,
                }
            )
        except Exception as exc:  # keep going: a failure is itself a result
            entry["error"] = f"{type(exc).__name__}: {exc}"[:300]

        out[case["id"]] = entry

    dest = sys.argv[1] if len(sys.argv) > 1 else "out-python.json"
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
    print(f"wrote {dest}: {len(out)} cases")


if __name__ == "__main__":
    main()
