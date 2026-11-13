"""Python side: lxml.html (the reference) -> same normalised JSON shape."""
import json
import sys
from lxml import html as LH

XPATHS = [
    "//div",
    "//p",
    "//span",
    "//td",
    "//*[@class]",
    "//a/@href",
    "count(//div)",
    "//div[@id='x']",
    "//*[text()]",
    "//table//td[2]",
]


def skeleton(doc):
    out = []

    def walk(el, depth):
        for c in el.iterchildren():
            if isinstance(c.tag, str):
                attrs = {k: (v if v is not None else "") for k, v in c.attrib.items()}
                out.append({"d": depth, "t": c.tag, "a": attrs})
                walk(c, depth + 1)

    walk(doc, 0)
    return out


def xpath(tree, expr):
    try:
        res = tree.xpath(expr)
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:80]}
    if isinstance(res, (int, float)) and not isinstance(res, bool):
        return {"num": res}
    items = []
    for n in res:
        if isinstance(n, str):
            items.append("attr:" + n.strip())
        elif hasattr(n, "tag") and isinstance(n.tag, str):
            items.append(f"<{n.tag}>{''.join(n.itertext()).strip()}")
        else:
            items.append("other:" + type(n).__name__)
    return {"items": items}


def main():
    with open("corpus.json", encoding="utf-8") as f:
        corpus = json.load(f)
    result = {}
    for c in corpus:
        entry = {}
        try:
            doc = LH.document_fromstring(c["html"])
            entry["skeleton"] = skeleton(doc)
            entry["xpath"] = {x: xpath(doc, x) for x in XPATHS}
        except Exception as e:  # noqa: BLE001
            entry["parseError"] = str(e)[:120]
        result[c["id"]] = entry
    out = sys.argv[1] if len(sys.argv) > 1 else "out-python.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1, ensure_ascii=False)
    print("python side wrote", len(result), "cases")


if __name__ == "__main__":
    main()
