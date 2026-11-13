"""Generate a seeded adversarial corpus for S5.

Random trees + random mutations. Deterministic, so failures are reproducible.
The point is to stress the *scoring table*, not just the winning element: a port
can return the right element with every score subtly wrong.
"""
import copy
import json
import random
import sys

TAGS = ["div", "span", "p", "article", "section", "li", "ul", "h3", "a", "td"]
WORDS = ["alpha", "beta", "gamma", "delta", "item", "Widget", "19.99", "price", "x", ""]
CLASSES = ["card", "product", "row", "item", "box", "list", "value", "summary"]


class Node:
    __slots__ = ("tag", "attrs", "text", "children")

    def __init__(self, tag):
        self.tag = tag
        self.attrs = {}
        self.text = ""
        self.children = []


def random_node(rng, depth, budget):
    node = Node(rng.choice(TAGS))
    if rng.random() < 0.7:
        node.attrs["class"] = rng.choice(CLASSES)
    if rng.random() < 0.25:
        node.attrs["id"] = "n" + "".join(rng.choice("abcdef") for _ in range(3))
    if rng.random() < 0.2:
        node.attrs[rng.choice(["href", "src", "data-x"])] = "/p/" + str(rng.randint(0, 9))
    if rng.random() < 0.6:
        node.text = rng.choice(WORDS)
    if depth < 4:
        for _ in range(rng.randint(0, 3)):
            if budget[0] <= 0:
                break
            budget[0] -= 1
            node.children.append(random_node(rng, depth + 1, budget))
    return node


def collect(node, out):
    out.append(node)
    for child in node.children:
        collect(child, out)


def serialize(node):
    attrs = "".join(f' {k}="{v}"' for k, v in node.attrs.items())
    inner = (node.text or "") + "".join(serialize(c) for c in node.children)
    return f"<{node.tag}{attrs}>{inner}</{node.tag}>"


def mutate(tree, rng):
    tree = copy.deepcopy(tree)
    nodes = []
    collect(tree, nodes)
    # rename classes
    for node in nodes:
        if "class" in node.attrs and rng.random() < 0.35:
            node.attrs["class"] = rng.choice(CLASSES) + rng.choice(["", " new", " big"])
    # change text
    for node in nodes:
        if rng.random() < 0.25:
            node.text = rng.choice(WORDS)
    # insert a sibling
    parent = rng.choice(nodes)
    if parent.children and rng.random() < 0.5:
        parent.children.insert(rng.randrange(len(parent.children)), random_node(rng, 3, [2]))
    # occasionally wrap a child
    if rng.random() < 0.3:
        host = rng.choice(nodes)
        if host.children:
            idx = rng.randrange(len(host.children))
            wrapper = Node("div")
            wrapper.attrs["class"] = "wrapper"
            wrapper.children.append(host.children[idx])
            host.children[idx] = wrapper
    return tree


def make_case(seed):
    rng = random.Random(seed)
    budget = [rng.randint(12, 28)]
    root = Node("div")
    root.attrs["class"] = "root"
    for _ in range(rng.randint(1, 3)):
        root.children.append(random_node(rng, 1, budget))

    nodes = []
    collect(root, nodes)
    target = nodes[rng.randrange(len(nodes))]
    target.attrs["id"] = "t"

    changed = mutate(root, rng)
    # sometimes remove the id so the changed tree cannot resolve the target
    if rng.random() < 0.4:
        for node in collect_nodes(changed):
            if node.attrs.get("id") == "t":
                node.attrs["id"] = "t-moved"

    return {
        "id": f"fuzz-{seed}",
        "target": "//*[@id='t']",
        "original": "<html><body>" + serialize(root) + "</body></html>",
        "changed": "<html><body>" + serialize(changed) + "</body></html>",
    }


def collect_nodes(node):
    out = []
    collect(node, out)
    return out


def main():
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    dest = sys.argv[2] if len(sys.argv) > 2 else "corpus-fuzz.json"
    cases = [make_case(seed) for seed in range(count)]
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(cases, fh, indent=1)
    print(f"wrote {dest}: {count} cases")


if __name__ == "__main__":
    main()
