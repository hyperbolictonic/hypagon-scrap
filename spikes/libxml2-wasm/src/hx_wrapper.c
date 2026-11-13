/*
 * hx_wrapper.c — minimal HTML-tree + XPath surface over libxml2, for WASM.
 *
 * Design goal: expose exactly what the parity harness needs, so the JS side can
 * walk the tree and build the same normalised skeleton that lxml produces.
 *
 * Deliberately mirrors libxml2 semantics rather than inventing an API:
 *   - parsing uses htmlReadMemory with RECOVER|NONET (lxml.html defaults)
 *   - paths use xmlGetNodePath (what lxml's getpath() uses)
 */
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include <libxml/HTMLparser.h>
#include <libxml/HTMLtree.h>
#include <libxml/tree.h>
#include <libxml/xpath.h>

/* Keep the last parsed doc so callers don't have to thread handles for the
 * common single-document case. A real API would require explicit handles. */
static xmlDocPtr last_doc = NULL;

EMSCRIPTEN_KEEPALIVE
xmlDocPtr hx_parse(const char *html, int len, const char *encoding) {
    if (last_doc) { xmlFreeDoc(last_doc); last_doc = NULL; }
    /* lxml passes UTF-8 for str input; passing NULL makes libxml2 fall back to
     * ISO-8859-1 for HTML with no declared charset, which mojibakes CJK. */
    const char *enc = (encoding && encoding[0]) ? encoding : NULL;
    /* Flags mirror Scrapling's HTMLParser: recover=True, remove_blank_text=True,
     * huge_tree=True. Comments are dropped by lxml post-parse, so callers must
     * skip comment nodes themselves. */
    xmlDocPtr doc = htmlReadMemory(html, len, NULL, enc,
        HTML_PARSE_RECOVER | HTML_PARSE_NOERROR | HTML_PARSE_NOWARNING |
        HTML_PARSE_NONET | HTML_PARSE_NOBLANKS | XML_PARSE_HUGE);
    last_doc = doc;
    return doc;
}

EMSCRIPTEN_KEEPALIVE
void hx_doc_free(xmlDocPtr doc) {
    if (doc) xmlFreeDoc(doc);
    if (doc == last_doc) last_doc = NULL;
}

/* ---- node accessors ---------------------------------------------------- */

EMSCRIPTEN_KEEPALIVE
int hx_type(xmlNodePtr n) { return n ? (int)n->type : -1; }

EMSCRIPTEN_KEEPALIVE
const char *hx_name(xmlNodePtr n) { return (n && n->name) ? (const char *)n->name : ""; }

/* Caller must hx_free_str() the result. */
EMSCRIPTEN_KEEPALIVE
char *hx_text(xmlNodePtr n) { return n ? (char *)xmlNodeGetContent(n) : NULL; }

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

/* Caller must hx_free_str() the result. */
EMSCRIPTEN_KEEPALIVE
char *hx_attr_value(xmlNodePtr n, int idx) {
    int i = 0;
    for (xmlAttrPtr a = n ? n->properties : NULL; a; a = a->next, i++)
        if (i == idx) return (char *)xmlNodeGetContent((xmlNodePtr)a);
    return NULL;
}

/* Caller must hx_free_str() the result. Matches lxml getpath() via libxml2. */
EMSCRIPTEN_KEEPALIVE
char *hx_path(xmlNodePtr n) { return n ? (char *)xmlGetNodePath(n) : NULL; }

EMSCRIPTEN_KEEPALIVE
void hx_free_str(char *s) { if (s) xmlFree(s); }

/* ---- XPath -------------------------------------------------------------
 * Object-based so one eval can be inspected repeatedly:
 *   hx_xpath -> hx_xpath_type/size/item/number -> hx_xpath_free
 */

EMSCRIPTEN_KEEPALIVE
xmlXPathObjectPtr hx_xpath(xmlDocPtr doc, const char *expr) {
    if (!doc) return NULL;
    xmlXPathContextPtr ctx = xmlXPathNewContext(doc);
    if (!ctx) return NULL;
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
