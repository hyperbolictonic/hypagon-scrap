"""Text-helper parity reference: Scrapling 0.5.1.

Records get_all_text output and find_by_text / find_by_regex result paths for
every (document, operation) pair.
"""
import json
import sys

from scrapling import Selector


def to_paths(result):
    items = result if isinstance(result, list) else [result]
    return [item._root.getroottree().getpath(item._root) for item in items]


def kwargs_for(args, keys):
    return {key: args[key] for key in keys if key in args}


def apply(selector, operation):
    kind = operation["kind"]
    args = operation.get("args", {})

    if kind == "all_text":
        kwargs = {}
        if "separator" in args:
            kwargs["separator"] = args["separator"]
        if "strip" in args:
            kwargs["strip"] = args["strip"]
        if "ignore_tags" in args:
            kwargs["ignore_tags"] = tuple(args["ignore_tags"])
        if "valid_values" in args:
            kwargs["valid_values"] = args["valid_values"]
        return selector.get_all_text(**kwargs)

    if kind == "find_text":
        kwargs = kwargs_for(
            args, ("first_match", "partial", "case_sensitive", "clean_match")
        )
        return to_paths(selector.find_by_text(args["text"], **kwargs))

    if kind == "find_regex":
        kwargs = kwargs_for(args, ("first_match", "case_sensitive", "clean_match"))
        return to_paths(selector.find_by_regex(args["query"], **kwargs))

    raise ValueError(f"unknown operation kind: {kind}")


def main():
    with open("corpus.json", encoding="utf-8") as fh:
        corpus = json.load(fh)

    out = {}
    for document in corpus["documents"]:
        root = Selector(document["html"])
        per_doc = {}

        for operation in corpus["operations"]:
            allowed = operation.get("documents")
            if allowed and document["id"] not in allowed:
                continue

            base = root
            selector = operation.get("selector")
            if selector:
                found = root.css(selector)
                if not found:
                    per_doc[operation["id"]] = {"error": "selector not found"}
                    continue
                base = found[0]

            try:
                per_doc[operation["id"]] = apply(base, operation)
            except Exception as exc:  # a failure is itself a result
                per_doc[operation["id"]] = {"error": f"{type(exc).__name__}: {exc}"[:200]}

        out[document["id"]] = per_doc

    dest = sys.argv[1] if len(sys.argv) > 1 else "text-golden.json"
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
