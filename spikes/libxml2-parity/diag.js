const libxml = require("libxmljs2");
const versionKeys = Object.keys(libxml).filter((k) => /version/i.test(k));
console.log("libxmljs2 version exports:", versionKeys.map((k) => `${k}=${libxml[k]}`).join(", ") || "(none)");

const html = "<div><script>var x = '<div>not a real div</div>';</script>after</div>";
const doc = libxml.parseHtml(html, { nonet: true });
console.log("SERIALIZED :", doc.toString());

const s = doc.get("//script");
if (s) {
  console.log("script text():", JSON.stringify(s.text()));
  console.log("script children:", JSON.stringify(s.childNodes().map((n) => [n.type(), n.text()])));
}
const d = doc.get("//div");
if (d) console.log("div text():", JSON.stringify(d.text()));
