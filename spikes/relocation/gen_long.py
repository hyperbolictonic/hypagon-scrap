"""Cases that exercise SequenceMatcher's autojunk heuristic (sequences >= 200).

Short-text cases never reach it, so this is the part of the port most likely to
diverge silently.
"""
import json

cases = []

# 1. long text (>200 chars) with heavy repetition -> popular characters purged
long_a = ("the quick brown fox jumps over the lazy dog " * 8).strip()
long_b = ("the quick brown fox leaps over a very lazy dog " * 8).strip()
cases.append(
    {
        "id": "longtext-repeated",
        "target": "//p[@class='body']",
        "original": f"<html><body><div><p class=\"body\">{long_a}</p></div></body></html>",
        "changed": f"<html><body><div><p class=\"body\">{long_b}</p></div></body></html>",
    }
)

# 2. long attribute value
val_a = " ".join(["item"] * 60)
val_b = " ".join(["item", "thing"] * 30)
cases.append(
    {
        "id": "longattr",
        "target": "//div[@id='x']",
        "original": f"<html><body><div id=\"x\" data-list=\"{val_a}\">A</div></body></html>",
        "changed": f"<html><body><div id=\"x\" data-list=\"{val_b}\">A</div></body></html>",
    }
)

# 3. 220 siblings -> the siblings tuple exceeds 200 and autojunk applies
items = "".join(f"<li class=\"row\">Item {i}</li>" for i in range(220))
changed_items = "".join(f"<li class=\"row alt\">Item {i if i % 7 else i * 2}</li>" for i in range(225))
cases.append(
    {
        "id": "many-siblings",
        "target": "//li[6]",
        "original": f"<html><body><ul class=\"list\">{items}</ul></body></html>",
        "changed": f"<html><body><ul class=\"list\">{changed_items}</ul></body></html>",
    }
)

# 4. CJK long text (code points, not UTF-16 units)
cjk = "日本語のテキストです。" * 20
cjk2 = "日本語のテキストでした。" * 20
cases.append(
    {
        "id": "cjk-longtext",
        "target": "//div[@class='jp']",
        "original": f"<html><body><div class=\"jp\">{cjk}</div></body></html>",
        "changed": f"<html><body><div class=\"jp\">{cjk2}</div></body></html>",
    }
)

with open("corpus-long.json", "w", encoding="utf-8") as fh:
    json.dump(cases, fh, indent=1)
print(f"wrote corpus-long.json: {len(cases)} cases")
