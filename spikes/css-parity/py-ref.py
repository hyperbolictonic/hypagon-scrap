"""CSS selector parity reference: Scrapling 0.5.1 / cssselect 1.6.0.

For every (document, selector) pair, record the selected element paths. Results
are what matters; the generated XPath is included for diagnosis only.
"""
import json
import sys

from scrapling import Selector
from scrapling.core.translator import css_to_xpath


def main():
    with open("corpus.json", encoding="utf-8") as fh:
        corpus = json.load(fh)

    out = {}
    for doc in corpus["documents"]:
        selector = Selector(doc["html"])
        per_doc = {}
        for css in corpus["selectors"]:
            try:
                xpath = css_to_xpath(css)
            except Exception as exc:
                per_doc[css] = {"error": f"{type(exc).__name__}: {exc}"[:200]}
                continue

            try:
                nodes = selector.xpath(xpath)
                paths = [n._root.getroottree().getpath(n._root) for n in nodes]
            except Exception as exc:
                per_doc[css] = {
                    "error": f"eval {type(exc).__name__}: {exc}"[:200],
                    "xpath": xpath,
                }
                continue

            per_doc[css] = {"xpath": xpath, "paths": paths}
        out[doc["id"]] = per_doc

    dest = sys.argv[1] if len(sys.argv) > 1 else "css-golden.json"
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
