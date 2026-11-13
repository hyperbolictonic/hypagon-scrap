from lxml import etree, html as LH

print("lxml", etree.__version__, "| LIBXML_VERSION", etree.LIBXML_VERSION, "| COMPILED", etree.LIBXML_COMPILED_VERSION)

h = "<div><script>var x = '<div>not a real div</div>';</script>after</div>"
d = LH.document_fromstring(h)
print("SERIALIZED :", etree.tostring(d, encoding="unicode"))
s = d.xpath("//script")[0]
print("script .text:", repr(s.text))
print("script children:", [(c.tag if isinstance(c.tag, str) else str(c.tag), c.text, c.tail) for c in s.iterchildren()])
dv = d.xpath("//div")[0]
print("div text/tail:", repr(dv.text), repr(dv.tail))
