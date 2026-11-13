/*
 * wrapper.c — HTML tree + XPath surface over libxml2, for WASM.
 *
 * Ownership model: there is NO module-level document state. `hx_parse` returns a
 * document handle that the caller owns and must release with `hx_doc_free`.
 * Node handles stay valid only while their document is alive. This is deliberate:
 * the S5 spike held a single static document and freed it on the next parse,
 * which produced dangling pointers that failed silently.
 */
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include <libxml/HTMLparser.h>
#include <libxml/HTMLtree.h>
#include <libxml/tree.h>
#include <libxml/xpath.h>

/* Flags mirror Scrapling's HTMLParser: recover, remove_blank_text, huge_tree.
 * Comments are dropped by lxml post-parse, so callers skip comment nodes. */
#define HX_PARSE_FLAGS \
    (HTML_PARSE_RECOVER | HTML_PARSE_NOERROR | HTML_PARSE_NOWARNING | \
     HTML_PARSE_NONET | HTML_PARSE_NOBLANKS | XML_PARSE_HUGE)

EMSCRIPTEN_KEEPALIVE
xmlDocPtr hx_parse(const char *html, int len, const char *encoding) {
    const char *enc = (encoding && encoding[0]) ? encoding : NULL;
    if (!html) return NULL;
    return htmlReadMemory(html, len, NULL, enc, HX_PARSE_FLAGS);
}

EMSCRIPTEN_KEEPALIVE
void hx_doc_free(xmlDocPtr doc) {
    if (doc) xmlFreeDoc(doc);
}

/* Scrapling parses with remove_comments=True; libxml2 has no such flag, so it
 * is a post-parse pass. Freeing while walking requires capturing `next` first. */
static void drop_comment_children(xmlNodePtr parent) {
    for (xmlNodePtr c = parent->children; c;) {
        xmlNodePtr next = c->next;
        if (c->type == XML_COMMENT_NODE) {
            xmlUnlinkNode(c);
            xmlFreeNode(c);
        } else {
            drop_comment_children(c);
        }
        c = next;
    }
}

EMSCRIPTEN_KEEPALIVE
void hx_drop_comments(xmlDocPtr doc) {
    if (doc) drop_comment_children((xmlNodePtr)doc);
}

EMSCRIPTEN_KEEPALIVE
xmlNodePtr hx_root(xmlDocPtr doc) {
    return doc ? xmlDocGetRootElement(doc) : NULL;
}

/* ---- node accessors ---------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE
int hx_type(xmlNodePtr n) { return n ? (int)n->type : -1; }

/* Interned in the document dictionary: do NOT free. */
EMSCRIPTEN_KEEPALIVE
const char *hx_name(xmlNodePtr n) { return (n && n->name) ? (const char *)n->name : ""; }

EMSCRIPTEN_KEEPALIVE
xmlNodePtr hx_parent(xmlNodePtr n) { return n ? n->parent : NULL; }

/* Deep text (element content). Caller frees with hx_free_str. */
EMSCRIPTEN_KEEPALIVE
char *hx_text(xmlNodePtr n) { return n ? (char *)xmlNodeGetContent(n) : NULL; }

/* Own text only: the lxml `.text` semantics relocation depends on.
 * Skips comment nodes, which the parser settings remove. */
EMSCRIPTEN_KEEPALIVE
char *hx_own_text(xmlNodePtr n) {
    if (!n) return NULL;
    for (xmlNodePtr c = n->children; c; c = c->next) {
        if (c->type == XML_COMMENT_NODE) continue;
        if (c->type == XML_TEXT_NODE || c->type == XML_CDATA_SECTION_NODE) {
            return (char *)xmlNodeGetContent(c);
        }
        return NULL;
    }
    return NULL;
}

EMSCRIPTEN_KEEPALIVE
int hx_child_count(xmlNodePtr n) {
    int c = 0;
    for (xmlNodePtr k = n ? n->children : NULL; k; k = k->next) c++;
    return c;
}

EMSCRIPTEN_KEEPALIVE
xmlNodePtr hx_child_at(xmlNodePtr n, int idx) {
    int i = 0;
    for (xmlNodePtr k = n ? n->children : NULL; k; k = k->next, i++)
        if (i == idx) return k;
    return NULL;
}

EMSCRIPTEN_KEEPALIVE
int hx_attr_count(xmlNodePtr n) {
    int c = 0;
    for (xmlAttrPtr a = n ? n->properties : NULL; a; a = a->next) c++;
    return c;
}

EMSCRIPTEN_KEEPALIVE
const char *hx_attr_name(xmlNodePtr n, int idx) {
    int i = 0;
    for (xmlAttrPtr a = n ? n->properties : NULL; a; a = a->next, i++)
        if (i == idx) return (const char *)a->name;
    return "";
}

/* Caller frees with hx_free_str. */
EMSCRIPTEN_KEEPALIVE
char *hx_attr_value(xmlNodePtr n, int idx) {
    int i = 0;
    for (xmlAttrPtr a = n ? n->properties : NULL; a; a = a->next, i++)
        if (i == idx) return (char *)xmlNodeGetContent((xmlNodePtr)a);
    return NULL;
}

/* Caller frees with hx_free_str. */
EMSCRIPTEN_KEEPALIVE
char *hx_path(xmlNodePtr n) { return n ? (char *)xmlGetNodePath(n) : NULL; }

EMSCRIPTEN_KEEPALIVE
void hx_free_str(char *s) { if (s) xmlFree(s); }

/* ---- XPath ------------------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE
xmlXPathObjectPtr hx_xpath(xmlDocPtr doc, const char *expr) {
    if (!doc || !expr) return NULL;
    xmlXPathContextPtr ctx = xmlXPathNewContext(doc);
    if (!ctx) return NULL;
    xmlXPathObjectPtr obj = xmlXPathEvalExpression((const xmlChar *)expr, ctx);
    xmlXPathFreeContext(ctx);
    return obj;
}

/* Relative XPath: evaluates with `n` as the context node, like lxml's
 * element.xpath(). `//` still selects from the document root; `.//` is relative. */
EMSCRIPTEN_KEEPALIVE
xmlXPathObjectPtr hx_xpath_at(xmlNodePtr n, const char *expr) {
    if (!n || !expr || !n->doc) return NULL;
    xmlXPathContextPtr ctx = xmlXPathNewContext(n->doc);
    if (!ctx) return NULL;
    ctx->node = n;
    xmlXPathObjectPtr obj = xmlXPathEvalExpression((const xmlChar *)expr, ctx);
    xmlXPathFreeContext(ctx);
    return obj;
}

EMSCRIPTEN_KEEPALIVE
int hx_xpath_type(xmlXPathObjectPtr o) { return o ? (int)o->type : -1; }

EMSCRIPTEN_KEEPALIVE
int hx_xpath_size(xmlXPathObjectPtr o) {
    return (o && o->nodesetval) ? o->nodesetval->nodeNr : 0;
}

EMSCRIPTEN_KEEPALIVE
xmlNodePtr hx_xpath_item(xmlXPathObjectPtr o, int i) {
    if (!o || !o->nodesetval || i < 0 || i >= o->nodesetval->nodeNr) return NULL;
    return o->nodesetval->nodeTab[i];
}

EMSCRIPTEN_KEEPALIVE
double hx_xpath_number(xmlXPathObjectPtr o) {
    return (o && o->type == XPATH_NUMBER) ? o->floatval : 0.0;
}

EMSCRIPTEN_KEEPALIVE
void hx_xpath_free(xmlXPathObjectPtr o) { if (o) xmlXPathFreeObject(o); }
