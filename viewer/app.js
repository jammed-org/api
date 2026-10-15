/* Jammed API viewer — renders v2/jammed.yaml (OpenAPI 3) without Redoc.
   Plain JS, no build step. Depends on vendor/js-yaml and vendor/marked. */
(function () {
  "use strict";

  var SPEC_URL = document.documentElement.getAttribute("data-spec") || "v2/jammed.yaml";
  var POSTMAN_URL = "v2/jammed-postman-collection.json";
  var METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
  var LANGS = [
    { id: "curl", label: "cURL" },
    { id: "js", label: "JavaScript" },
    { id: "python", label: "Python" },
    { id: "ruby", label: "Ruby" }
  ];

  var spec = null;
  var baseUrl = "";
  var lang = store("jammed-api-lang") || "curl";

  // ---------- small helpers ----------

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) { return null; }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function md(text, inline) {
    if (!text) return "";
    var src = String(text);
    return inline ? window.marked.parseInline(src) : window.marked.parse(src);
  }

  // Field descriptions use one line per item (e.g. enum meanings), so keep line breaks.
  function mdField(text) {
    return text ? window.marked.parse(String(text), { breaks: true }) : "";
  }

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function resolvePointer(ref) {
    if (typeof ref !== "string" || ref.charAt(0) !== "#") return undefined;
    var parts = ref.slice(2).split("/");
    var node = spec;
    for (var i = 0; i < parts.length; i++) {
      var key = decodeURIComponent(parts[i]).replace(/~1/g, "/").replace(/~0/g, "~");
      if (node == null) return undefined;
      node = node[key];
    }
    return node;
  }

  // Follow $ref chains; returns { node, name } where name is the last schema name seen.
  function deref(node) {
    var name = null;
    var guard = 0;
    while (node && typeof node === "object" && node.$ref && guard++ < 20) {
      name = node.$ref.split("/").pop();
      node = resolvePointer(node.$ref);
    }
    return { node: node || {}, name: name };
  }

  function refName(node) {
    return node && node.$ref ? node.$ref.split("/").pop() : null;
  }

  // ---------- schema helpers ----------

  function nonNullVariants(list) {
    return (list || []).filter(function (v) { return deref(v).node.type !== "null"; });
  }

  function typeLabel(schemaIn) {
    var r = deref(schemaIn);
    var s = r.node;
    var name = r.name;
    var label;
    if (s.oneOf || s.anyOf) {
      var vs = nonNullVariants(s.oneOf || s.anyOf);
      label = vs.map(function (v) { return typeLabel(v); }).join(" | ");
      if (vs.length !== (s.oneOf || s.anyOf).length) label += " | null";
      return label;
    }
    if (s.allOf) return name || "object";
    var t = Array.isArray(s.type) ? s.type.join(" | ") : s.type;
    if (t === "array" || (!t && s.items)) {
      label = "array of " + (s.items ? typeLabel(s.items) : "any");
    } else if (t === "object" || (!t && s.properties)) {
      label = name ? name : "object";
    } else {
      label = t || (name ? name : "any");
      if (s.format) label += " <" + s.format + ">";
    }
    if (s.nullable) label += " | null";
    return label;
  }

  function mergedAllOf(s) {
    var out = { type: "object", properties: {}, required: [] };
    (s.allOf || []).forEach(function (part) {
      var p = deref(part).node;
      if (p.allOf) p = mergedAllOf(p);
      Object.assign(out.properties, p.properties || {});
      out.required = out.required.concat(p.required || []);
      if (p.description && !out.description) out.description = p.description;
    });
    Object.keys(s).forEach(function (k) {
      if (k !== "allOf" && k !== "properties" && k !== "required") out[k] = s[k];
    });
    Object.assign(out.properties, s.properties || {});
    out.required = out.required.concat(s.required || []);
    return out;
  }

  // Returns the object-ish schema whose properties should be listed, or null.
  function expandable(schemaIn) {
    var s = deref(schemaIn).node;
    if (s.allOf) return { kind: "object", schema: mergedAllOf(s) };
    if (s.oneOf || s.anyOf) {
      var vs = nonNullVariants(s.oneOf || s.anyOf);
      var complex = vs.filter(function (v) { return expandable(v); });
      if (!complex.length) return null;
      if (vs.length === 1) return expandable(vs[0]);
      return { kind: "variants", variants: vs };
    }
    var scalar = s.type && s.type !== "object" && s.type !== "array";
    var hasProps = s.properties && Object.keys(s.properties).length;
    if (!scalar && (hasProps || s.additionalProperties && typeof s.additionalProperties === "object")) {
      return { kind: "object", schema: s };
    }
    if ((s.type === "array" || s.items) && s.items) {
      var inner = expandable(s.items);
      return inner ? { kind: "array", inner: inner, items: s.items } : null;
    }
    return null;
  }

  function sampleFor(schemaIn, depth, seen) {
    depth = depth || 0;
    seen = seen || [];
    var r = deref(schemaIn);
    var s = r.node;
    if (s.example !== undefined) return s.example;
    if (s.default !== undefined) return s.default;
    if (s.enum && s.enum.length) return s.enum[0];
    if (r.name && seen.indexOf(r.name) !== -1) return {};
    if (r.name) seen = seen.concat(r.name);
    if (depth > 6) return null;
    if (s.allOf) return sampleFor(mergedAllOf(s), depth, seen);
    if (s.oneOf || s.anyOf) {
      var vs = nonNullVariants(s.oneOf || s.anyOf);
      return vs.length ? sampleFor(vs[0], depth, seen) : null;
    }
    var t = Array.isArray(s.type) ? s.type.filter(function (x) { return x !== "null"; })[0] : s.type;
    if (!t && s.properties) t = "object";
    if (!t && s.items) t = "array";
    switch (t) {
      case "object":
        var obj = {};
        Object.keys(s.properties || {}).forEach(function (k) {
          obj[k] = sampleFor(s.properties[k], depth + 1, seen);
        });
        return obj;
      case "array":
        return s.items ? [sampleFor(s.items, depth + 1, seen)] : [];
      case "integer":
        if (s.minimum !== undefined) return s.minimum;
        return /(_at|timestamp|time)$/i.test(r.name || "") ? 1735689600 : 0;
      case "number": return s.minimum !== undefined ? s.minimum : 0;
      case "boolean": return true;
      case "null": return null;
      case "string":
        switch (s.format) {
          case "date": return "2026-01-31";
          case "date-time": return "2026-01-31T19:00:00Z";
          case "email": return "hello@example.com";
          case "uri": case "url": return "https://example.com";
          case "uuid": return "3f2b8c1e-9d4a-4f6b-8a2e-1c5d7e9f0a1b";
        }
        return "string";
    }
    return null;
  }

  // An example on a media type may itself be a {$ref} (Redoc-style) — resolve it.
  function exampleFor(media) {
    if (!media) return undefined;
    if (media.example !== undefined) {
      var ex = media.example;
      if (ex && typeof ex === "object" && ex.$ref) ex = resolvePointer(ex.$ref);
      if (ex !== undefined) return ex;
    }
    if (media.examples) {
      var first = media.examples[Object.keys(media.examples)[0]];
      if (first) {
        first = deref(first).node;
        if (first.value !== undefined) return first.value;
      }
    }
    if (media.schema) return sampleFor(media.schema);
    return undefined;
  }

  function jsonMedia(content) {
    if (!content) return null;
    var key = Object.keys(content).filter(function (k) { return /json/.test(k); })[0] || Object.keys(content)[0];
    return key ? { type: key, media: content[key] } : null;
  }

  // ---------- syntax highlighting ----------

  function highlightJSON(str) {
    return esc(str).replace(
      /(&quot;(?:\\.|[^&\\]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      function (m, str, colon, bool, num) {
        if (str) return colon ? '<span class="tk-key">' + str + "</span>" + colon : '<span class="tk-str">' + str + "</span>";
        if (bool) return '<span class="tk-bool">' + m + "</span>";
        if (num) return '<span class="tk-num">' + m + "</span>";
        return '<span class="tk-null">null</span>';
      }
    );
  }

  function highlightCode(code, language) {
    if (language === "json") return highlightJSON(code);
    var out = esc(code);
    out = out.replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="tk-str">$1</span>');
    if (language === "curl") {
      out = out.replace(/^curl\b/m, '<span class="tk-cmd">curl</span>')
        .replace(/(\s)(-[A-Za-z]|--[a-z-]+)(?=\s)/g, '$1<span class="tk-flag">$2</span>');
    } else {
      out = out.replace(/^(\s*(?:#|\/\/).*)$/gm, '<span class="tk-com">$1</span>')
        .replace(/\b(const|await|import|require|def|end|print|puts|fetch|async|do)\b/g, '<span class="tk-cmd">$1</span>');
    }
    return out;
  }

  // ---------- model building ----------

  function buildModel() {
    var tagMeta = {};
    (spec.tags || []).forEach(function (t) { tagMeta[t.name] = t; });

    var ops = [];
    function collect(map, isWebhook) {
      Object.keys(map || {}).forEach(function (path) {
        var item = map[path] || {};
        METHODS.forEach(function (method) {
          var op = item[method];
          if (!op) return;
          var tag = (op.tags && op.tags[0]) || (isWebhook ? "Webhooks" : "Other");
          var id = slug(tag) + "--" + slug(op.operationId || (isWebhook ? path : method + "-" + path));
          ops.push({
            id: id, path: path, method: method, op: op, tag: tag, webhook: isWebhook,
            params: (item.parameters || []).concat(op.parameters || [])
          });
        });
      });
    }
    collect(spec.paths, false);
    collect(spec["x-webhooks"], true);
    collect(spec.webhooks, true);

    // De-duplicate ids
    var seenIds = {};
    ops.forEach(function (o) {
      if (seenIds[o.id]) o.id += "-" + (++seenIds[o.id]);
      else seenIds[o.id] = 1;
    });

    var byTag = {};
    ops.forEach(function (o) { (byTag[o.tag] = byTag[o.tag] || []).push(o); });

    var groups = [];
    var placed = {};
    (spec["x-tagGroups"] || []).forEach(function (g) {
      var tags = [];
      (g.tags || []).forEach(function (name) {
        if (placed[name]) return;
        placed[name] = true;
        tags.push(name);
      });
      groups.push({ name: g.name, tags: tags });
    });
    // Any tag with operations that the groups forgot about.
    Object.keys(byTag).forEach(function (name) {
      if (placed[name]) return;
      placed[name] = true;
      var isHook = byTag[name][0].webhook;
      var target = groups.filter(function (g) { return /webhook/i.test(g.name) === isHook && !/model/i.test(g.name); })[0];
      if (!target) { target = { name: isHook ? "Webhooks" : "Endpoints", tags: [] }; groups.push(target); }
      target.tags.push(name);
    });

    groups.forEach(function (g) {
      g.id = "group-" + slug(g.name);
      g.tags = g.tags.map(function (name) {
        var meta = tagMeta[name] || { name: name };
        var schemaRef = null;
        var m = /<SchemaDefinition\s+schemaRef="([^"]+)"/.exec(meta.description || "");
        if (m) schemaRef = m[1];
        return {
          name: name,
          display: meta["x-displayName"] || name,
          description: schemaRef ? "" : meta.description,
          schemaRef: schemaRef,
          id: "tag-" + slug(name),
          ops: byTag[name] || []
        };
      }).filter(function (t) { return t.ops.length || t.schemaRef; });
    });

    return { groups: groups.filter(function (g) { return g.tags.length; }), ops: ops };
  }

  // Split info.description on H1 headings into intro sections (like Redoc).
  function introSections() {
    var text = (spec.info && spec.info.description) || "";
    var lines = text.split("\n");
    var lede = [];
    var sections = [];
    var current = null;
    var inFence = false;
    lines.forEach(function (line) {
      if (/^```/.test(line)) inFence = !inFence;
      var m = !inFence && /^#\s+(.+)$/.exec(line);
      if (m) {
        current = { title: m[1].trim(), body: [] };
        sections.push(current);
      } else if (current) current.body.push(line);
      else lede.push(line);
    });
    sections.forEach(function (s) {
      s.id = "intro-" + slug(s.title);
      s.body = s.body.join("\n");
    });
    return { lede: lede.join("\n").trim(), sections: sections };
  }

  function securityHTML() {
    var schemes = (spec.components && spec.components.securitySchemes) || {};
    var keys = Object.keys(schemes);
    if (!keys.length) return "";
    return keys.map(function (k) {
      var s = schemes[k];
      return '<div class="fields">' +
        field('<code>Authorization</code><div class="field-meta"><span class="loc">header</span><span class="req">required</span></div>',
          (s.description ? md(s.description) : "") +
          '<div class="kv">Format: <code>Bearer &lt;api_key&gt;</code></div>') +
        "</div>";
    }).join("");
  }

  // ---------- rendering ----------

  function field(nameHTML, descHTML) {
    return '<div class="field"><div class="field-name">' + nameHTML + '</div><div class="field-desc">' + descHTML + "</div></div>";
  }

  function constraintsHTML(s) {
    var bits = [];
    if (s.default !== undefined) bits.push("Default: <code>" + esc(JSON.stringify(s.default)) + "</code>");
    if (s.minimum !== undefined) bits.push("Min: <code>" + esc(s.minimum) + "</code>");
    if (s.maximum !== undefined) bits.push("Max: <code>" + esc(s.maximum) + "</code>");
    if (s.minLength !== undefined) bits.push("Min length: <code>" + esc(s.minLength) + "</code>");
    if (s.maxLength !== undefined) bits.push("Max length: <code>" + esc(s.maxLength) + "</code>");
    if (s.pattern) bits.push("Pattern: <code>" + esc(s.pattern) + "</code>");
    var html = bits.length ? '<div class="kv">' + bits.join(" · ") + "</div>" : "";
    var en = s.enum || (s.items && deref(s.items).node.enum);
    if (en && en.length) {
      html += '<div class="enum"><span class="kv" style="margin:0">One of:</span>' +
        en.map(function (v) { return "<code>" + esc(JSON.stringify(v)) + "</code>"; }).join("") + "</div>";
    }
    return html;
  }

  // Render a property list for an object schema into HTML. Nested objects are
  // lazily rendered when their <details> opens, so large specs stay quick.
  var lazy = [];
  function lazyId(schema, ancestry) {
    lazy.push({ schema: schema, ancestry: ancestry });
    return lazy.length - 1;
  }

  function propsHTML(schemaIn, ancestry) {
    var ex = expandable(schemaIn);
    if (!ex) return "";
    if (ex.kind === "array") return propsHTML(ex.items, ancestry);
    if (ex.kind === "variants") {
      return ex.variants.map(function (v, i) {
        var label = deref(v).node.title || refName(v) || "Option " + (i + 1);
        return '<p class="variant-label">' + (i ? "or " : "One of: ") + "<strong>" + esc(label) + "</strong></p>" + propsHTML(v, ancestry);
      }).join("");
    }
    var s = ex.schema;
    var req = s.required || [];
    var keys = Object.keys(s.properties || {});
    var rows = keys.map(function (k) {
      var raw = s.properties[k];
      var r = deref(raw);
      var p = r.node;
      var desc = p.description || (raw && raw.description) || "";
      if (!desc && p.title && p.title !== k) desc = p.title;
      var nameHTML = "<code>" + esc(k) + '</code><div class="field-meta"><span class="type">' + esc(typeLabel(raw)) + "</span>" +
        (req.indexOf(k) !== -1 ? '<span class="req">required</span>' : "") + "</div>";
      var descHTML = (desc ? mdField(desc) : "") + constraintsHTML(p);
      if (p.example !== undefined && typeof p.example !== "object") descHTML += '<div class="kv">Example: <code>' + esc(JSON.stringify(p.example)) + "</code></div>";
      var html = '<div class="field"><div class="field-name">' + nameHTML + '</div><div class="field-desc">' + descHTML + "</div>";
      var childEx = expandable(raw);
      var childName = r.name || (p.items && refName(p.items));
      if (childEx) {
        if (childName && ancestry.indexOf(childName) !== -1) {
          html += '<div class="nested"><span class="kv">Recursive: <code>' + esc(childName) + "</code></span></div>";
        } else {
          var n = childEx.kind === "variants" ? childEx.variants.length + " shapes" : childEx.kind === "array" ? "item properties" : "properties";
          html += '<details class="nested" data-lazy="' + lazyId(raw, childName ? ancestry.concat(childName) : ancestry) + '">' +
            '<summary><i class="fa-solid fa-chevron-right"></i><span class="when-closed">Show</span><span class="when-open">Hide</span> ' + n + '</summary><div class="nested-body"></div></details>';
        }
      }
      return html + "</div>";
    });
    if (s.additionalProperties && typeof s.additionalProperties === "object") {
      rows.push(field("<code>[key]</code><div class=\"field-meta\"><span class=\"type\">" + esc(typeLabel(s.additionalProperties)) + "</span></div>",
        '<span class="muted">Additional properties</span>'));
    }
    return rows.length ? '<div class="fields">' + rows.join("") + "</div>" : "";
  }

  function schemaBlockHTML(schemaIn) {
    var r = deref(schemaIn);
    var s = r.node;
    var ancestry = r.name ? [r.name] : [];
    var head = "";
    if (s.type === "array" || s.items) head = '<p class="kv">Returns an <strong>array</strong> of <code>' + esc(typeLabel(s.items || {})) + "</code></p>";
    var props = propsHTML(schemaIn, ancestry);
    if (!props && !head) head = '<p class="kv">Type: <code>' + esc(typeLabel(schemaIn)) + "</code></p>";
    return head + props;
  }

  function paramsHTML(params) {
    if (!params.length) return "";
    var order = { path: 0, query: 1, header: 2, cookie: 3 };
    var list = params.map(function (p) { return deref(p).node; })
      .sort(function (a, b) { return (order[a.in] || 9) - (order[b.in] || 9); });
    return '<div class="section-title">Parameters</div><div class="fields">' + list.map(function (p) {
      var sc = p.schema ? deref(p.schema).node : {};
      var nameHTML = "<code>" + esc(p.name) + '</code><div class="field-meta"><span class="loc">' + esc(p.in) + '</span><span class="type">' +
        esc(p.schema ? typeLabel(p.schema) : "string") + "</span>" + (p.required ? '<span class="req">required</span>' : "") + "</div>";
      var desc = (p.description ? mdField(p.description) : "") + constraintsHTML(sc);
      var exv = p.example !== undefined ? p.example : sc.example;
      if (exv !== undefined) desc += '<div class="kv">Example: <code>' + esc(typeof exv === "string" ? exv : JSON.stringify(exv)) + "</code></div>";
      if (!desc) desc = '<span class="muted">—</span>';
      return field(nameHTML, desc);
    }).join("") + "</div>";
  }

  function bodyHTML(rb) {
    if (!rb) return "";
    rb = deref(rb).node;
    var jm = jsonMedia(rb.content);
    if (!jm) return "";
    return '<div class="section-title">Request body <span class="type" style="letter-spacing:0;text-transform:none">' + esc(jm.type) + "</span>" +
      (rb.required ? ' <span class="req">required</span>' : "") + "</div>" +
      (rb.description ? '<div class="prose">' + md(rb.description) + "</div>" : "") +
      (jm.media.schema ? schemaBlockHTML(jm.media.schema) : "");
  }

  function responsesHTML(responses, isWebhook) {
    var codes = Object.keys(responses || {});
    if (!codes.length) return "";
    if (isWebhook) {
      var res = deref(responses[codes[0]]).node;
      var jm = jsonMedia(res.content);
      return jm && jm.media.schema ? '<div class="section-title">Payload</div>' + schemaBlockHTML(jm.media.schema) : "";
    }
    return '<div class="section-title">Responses</div><div class="responses">' + codes.map(function (code, i) {
      var res = deref(responses[code]).node;
      var jm = jsonMedia(res.content);
      var body = jm && jm.media.schema ? schemaBlockHTML(jm.media.schema) : "";
      var cls = "s-" + String(code).charAt(0);
      var summary = '<summary><span class="status ' + cls + '">' + esc(code) + '</span><span class="rdesc">' +
        md(res.description || "", true) + '</span><i class="fa-solid fa-chevron-right chev"></i></summary>';
      if (!body) return '<details class="response empty">' + summary + "</details>";
      return '<details class="response"' + (i === 0 && /^2/.test(code) ? " open" : "") + ">" + summary +
        '<div class="response-body">' + body + "</div></details>";
    }).join("") + "</div>";
  }

  function pathHTML(path) {
    return esc(path).replace(/\{([^}]+)\}/g, '<span class="param">{$1}</span>');
  }

  // ---------- code samples ----------

  function sampleValue(p) {
    var sc = p.schema ? deref(p.schema).node : {};
    if (p.example !== undefined) return p.example;
    if (sc.example !== undefined) return sc.example;
    var v = sampleFor(p.schema || { type: "string" });
    if (v === "string") return p.in === "path" ? p.name.toUpperCase() : "value";
    return v;
  }

  function buildRequest(o) {
    var params = o.params.map(function (p) { return deref(p).node; });
    var path = o.path.replace(/\{([^}]+)\}/g, function (m, name) {
      var p = params.filter(function (x) { return x.in === "path" && x.name === name; })[0];
      return encodeURIComponent(p ? String(sampleValue(p)) : name.toUpperCase());
    });
    var qs = params.filter(function (p) { return p.in === "query" && p.required; })
      .map(function (p) { return encodeURIComponent(p.name) + "=" + encodeURIComponent(String(sampleValue(p))); });
    var url = baseUrl.replace(/\/$/, "") + "/" + path.replace(/^\//, "") + (qs.length ? "?" + qs.join("&") : "");
    var headers = [["Authorization", "Bearer $JAMMED_API_KEY"]];
    params.filter(function (p) { return p.in === "header" && !/^authorization$/i.test(p.name) && p.required; })
      .forEach(function (p) { headers.push([p.name, String(sampleValue(p))]); });
    var body;
    var rb = o.op.requestBody && deref(o.op.requestBody).node;
    var jm = rb && jsonMedia(rb.content);
    if (jm) {
      body = exampleFor(jm.media);
      headers.push(["Content-Type", jm.type]);
    }
    return { method: o.method.toUpperCase(), url: url, headers: headers, body: body };
  }

  function codeSample(o, which) {
    var r = buildRequest(o);
    var json = r.body !== undefined ? JSON.stringify(r.body, null, 2) : null;
    if (which === "curl") {
      var lines = ["curl -X " + r.method + ' "' + r.url + '"'];
      r.headers.forEach(function (h) { lines.push('  -H "' + h[0] + ": " + h[1] + '"'); });
      if (json) lines.push("  -d '" + json.replace(/'/g, "'\\''").replace(/\n/g, "\n  ") + "'");
      return lines.join(" \\\n");
    }
    if (which === "js") {
      var hs = r.headers.map(function (h) {
        var v = h[0] === "Authorization" ? "`Bearer ${process.env.JAMMED_API_KEY}`" : JSON.stringify(h[1]);
        return "    " + JSON.stringify(h[0]) + ": " + v;
      }).join(",\n");
      return "const res = await fetch(" + JSON.stringify(r.url) + ", {\n" +
        '  method: "' + r.method + '",\n' +
        "  headers: {\n" + hs + "\n  }" +
        (json ? ",\n  body: JSON.stringify(" + json.replace(/\n/g, "\n  ") + ")" : "") +
        "\n});\n\nconst data = await res.json();";
    }
    if (which === "python") {
      var ph = r.headers.map(function (h) {
        var v = h[0] === "Authorization" ? 'f"Bearer {os.environ[\'JAMMED_API_KEY\']}"' : JSON.stringify(h[1]);
        return "    " + JSON.stringify(h[0]) + ": " + v;
      }).join(",\n");
      return "import os, requests\n\n" +
        "res = requests." + r.method.toLowerCase() + "(\n" +
        "  " + JSON.stringify(r.url) + ",\n" +
        "  headers={\n" + ph + "\n  }" +
        (json ? ",\n  json=" + toPython(r.body, "  ") : "") +
        "\n)\n\ndata = res.json()";
    }
    if (which === "ruby") {
      var cls = r.method.charAt(0) + r.method.slice(1).toLowerCase();
      var rh = r.headers.map(function (h) {
        var v = h[0] === "Authorization" ? '"Bearer #{ENV.fetch(\'JAMMED_API_KEY\')}"' : JSON.stringify(h[1]);
        return "req[" + JSON.stringify(h[0]) + "] = " + v;
      }).join("\n");
      return 'require "net/http"\nrequire "json"\n\n' +
        "uri = URI(" + JSON.stringify(r.url) + ")\n" +
        "req = Net::HTTP::" + cls + ".new(uri)\n" + rh + "\n" +
        (json ? "req.body = " + JSON.stringify(JSON.stringify(r.body)) + "\n" : "") +
        "\nres = Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |http| http.request(req) }\n" +
        "data = JSON.parse(res.body)";
    }
    return "";
  }

  function toPython(v, indent) {
    var json = JSON.stringify(v, null, 2).replace(/\n/g, "\n" + indent);
    return json.replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None");
  }

  function responseExamples(o) {
    var out = [];
    var responses = o.op.responses || {};
    Object.keys(responses).forEach(function (code) {
      var res = deref(responses[code]).node;
      var jm = jsonMedia(res.content);
      if (!jm) return;
      var ex = exampleFor(jm.media);
      if (ex === undefined) return;
      out.push({ code: code, json: JSON.stringify(ex, null, 2) });
    });
    return out;
  }

  function codePanelHTML(o) {
    var html = "";
    if (!o.webhook) {
      html += '<div class="code-card" data-req="' + esc(o.id) + '"><div class="code-head"><div class="tabs" role="tablist">' +
        LANGS.map(function (l) {
          return '<button class="tab" role="tab" data-lang="' + l.id + '" aria-selected="' + (l.id === lang) + '">' + l.label + "</button>";
        }).join("") +
        '</div><button class="copy-btn" title="Copy" aria-label="Copy code"><i class="fa-regular fa-copy"></i></button></div>' +
        '<pre><code class="req-code"></code></pre></div>';
    }
    var exs = responseExamples(o);
    if (exs.length) {
      var title = o.webhook ? "Example payload" : "Response";
      html += '<div class="code-card" data-res><div class="code-head"><span class="title">' + title + "</span>" +
        (exs.length > 1 && !o.webhook
          ? '<select aria-label="Response status">' + exs.map(function (e, i) { return '<option value="' + i + '">' + esc(e.code) + "</option>"; }).join("") + "</select>"
          : (o.webhook ? "" : '<span class="status s-' + exs[0].code.charAt(0) + '">' + esc(exs[0].code) + "</span>")) +
        '<button class="copy-btn" title="Copy" aria-label="Copy response"><i class="fa-regular fa-copy"></i></button></div>' +
        exs.map(function (e, i) {
          return '<pre data-ex="' + i + '"' + (i ? " hidden" : "") + "><code>" + highlightJSON(e.json) + "</code></pre>";
        }).join("") +
        (o.webhook ? '<div class="code-note"><i class="fa-solid fa-bolt"></i>&nbsp; Sent to the webhook URL you set in your studio’s Website Settings.</div>' : "") +
        "</div>";
    }
    return html ? '<div class="code-stack">' + html + "</div>" : "";
  }

  function opHTML(o) {
    var op = o.op;
    var title = op.summary || (o.webhook ? o.path : o.method.toUpperCase() + " " + o.path);
    var badges = "";
    if (o.webhook) badges += '<span class="pill webhook"><i class="fa-solid fa-bolt"></i> Webhook</span>';
    if (op["x-epos"]) badges += '<span class="pill epos" title="Used by the Jammed ePOS app">ePOS</span>';
    if (op.deprecated) badges += '<span class="pill">Deprecated</span>';
    var endpoint = o.webhook
      ? '<div class="endpoint"><span class="method lg m-event">Event</span><span class="path">' + esc(o.path) + "</span>" +
        '<button class="copy-btn" data-copy="' + esc(o.path) + '" title="Copy event name" aria-label="Copy event name"><i class="fa-regular fa-copy"></i></button></div>'
      : '<div class="endpoint"><span class="method lg m-' + o.method + '">' + o.method + '</span><span class="path"><span class="base">' +
        esc(baseUrl.replace(/\/$/, "")) + "</span>" + pathHTML(o.path) + "</span>" +
        '<button class="copy-btn" data-copy="' + esc(baseUrl.replace(/\/$/, "") + o.path) + '" title="Copy URL" aria-label="Copy URL"><i class="fa-regular fa-copy"></i></button></div>';
    var params = o.params.filter(function (p) {
      // Every endpoint takes the auth header; it's covered once in Authentication.
      var n = deref(p).node;
      return !(n.in === "header" && /^authorization$/i.test(n.name));
    });
    var needsAuth = params.length !== o.params.length;
    return '<section class="op" id="' + esc(o.id) + '"><div class="op-main">' +
      '<h4>' + esc(title) + badges + '<a class="anchor" href="#' + esc(o.id) + '" aria-label="Link to this section"><i class="fa-solid fa-link"></i></a></h4>' +
      endpoint +
      (op.description ? '<div class="prose">' + md(op.description) + "</div>" : "") +
      (needsAuth ? '<p class="kv"><i class="fa-solid fa-lock"></i>&nbsp; Requires your API key — see <a href="#intro-authentication">Authentication</a>.</p>' : "") +
      paramsHTML(params) + bodyHTML(op.requestBody) + responsesHTML(op.responses, o.webhook) +
      "</div><div class=\"op-code\">" + codePanelHTML(o) + "</div></section>";
  }

  function modelHTML(t) {
    var r = deref({ $ref: t.schemaRef });
    var s = r.node;
    var sample = sampleFor({ $ref: t.schemaRef });
    return '<section class="op" id="' + esc(t.id) + '"><div class="op-main">' +
      "<h4>" + esc(t.display) + '<span class="pill">' + esc(r.name) + '</span><a class="anchor" href="#' + esc(t.id) + '" aria-label="Link to this section"><i class="fa-solid fa-link"></i></a></h4>' +
      (s.description ? '<div class="prose">' + md(s.description) + "</div>" : "") +
      '<div class="section-title">Properties</div>' + schemaBlockHTML({ $ref: t.schemaRef }) +
      '</div><div class="op-code"><div class="code-stack"><div class="code-card" data-res><div class="code-head"><span class="title">Example object</span>' +
      '<button class="copy-btn" title="Copy" aria-label="Copy example"><i class="fa-regular fa-copy"></i></button></div>' +
      "<pre><code>" + highlightJSON(JSON.stringify(sample, null, 2)) + "</code></pre></div></div></div></section>";
  }

  function navHTML(model, intro) {
    var html = '<div class="nav-group"><div class="nav-group-title">Overview</div>' +
      intro.sections.map(function (s) {
        return '<a class="nav-link top" href="#' + s.id + '" data-search="' + esc(s.title.toLowerCase()) + '"><span class="label">' + esc(s.title) + "</span></a>";
      }).join("") + "</div>";
    model.groups.forEach(function (g) {
      html += '<div class="nav-group"><div class="nav-group-title">' + esc(g.name) + "</div>";
      g.tags.forEach(function (t) {
        if (t.schemaRef && !t.ops.length) {
          html += '<a class="nav-link top" href="#' + t.id + '" data-search="' + esc((t.display + " " + t.schemaRef).toLowerCase()) + '">' +
            '<span class="label">' + esc(t.display) + "</span></a>";
          return;
        }
        html += '<details class="nav-tag" data-tag="' + t.id + '"><summary>' + esc(t.display.replace(/ (Endpoints|Webhooks)$/, "")) +
          ' <span class="count">' + t.ops.length + '</span><i class="fa-solid fa-chevron-right chev"></i></summary>' +
          t.ops.map(function (o) {
            var label = o.op.summary || o.path;
            var badge = o.webhook ? '<span class="method m-event">evt</span>' : '<span class="method m-' + o.method + '">' + (o.method === "delete" ? "del" : o.method) + "</span>";
            return '<a class="nav-link" href="#' + o.id + '" data-search="' + esc((label + " " + o.path + " " + o.method + " " + t.name).toLowerCase()) + '">' +
              badge + '<span class="label">' + esc(label) + "</span></a>";
          }).join("") + "</details>";
      });
      html += "</div>";
    });
    return html + '<div class="nav-empty" hidden>Nothing matches that. Try a path like <code>/bookings</code>.</div>';
  }

  function render() {
    var model = buildModel();
    var intro = introSections();
    var info = spec.info || {};
    baseUrl = (spec.servers && spec.servers[0] && spec.servers[0].url) || "";
    lazy = [];
    fillCode.ops = model.ops;

    document.title = (info.title || "Jammed API") + " — Docs";
    document.getElementById("version").textContent = "v" + (info.version || "");

    var content = document.getElementById("content");
    var contact = info.contact || {};
    var html = '<header class="hero"><div class="hero-panel"><div class="eyebrow">Jammed developer docs · v' + esc(info.version || "") + "</div>" +
      "<h1>" + esc(info.title || "Jammed API") + "</h1>" +
      '<div class="hero-lede">' + md(intro.lede) + "</div></div>" +
      '<div class="facts">' +
      '<div class="fact"><div class="eyebrow"><i class="fa-solid fa-server"></i>Base URL</div><div class="fact-value"><span>' + esc(baseUrl) +
      '</span><button class="copy-btn" data-copy="' + esc(baseUrl) + '" title="Copy base URL" aria-label="Copy base URL"><i class="fa-regular fa-copy"></i></button></div></div>' +
      '<div class="fact"><div class="eyebrow"><i class="fa-solid fa-key"></i>Auth header</div><div class="fact-value"><span>Authorization: Bearer &lt;api_key&gt;</span></div></div>' +
      '<div class="fact"><div class="eyebrow"><i class="fa-solid fa-download"></i>Grab the spec</div><div class="fact-links">' +
      '<a class="btn dark" href="' + esc(SPEC_URL) + '" download><i class="fa-solid fa-file-code"></i>OpenAPI</a>' +
      '<a class="btn" href="' + esc(POSTMAN_URL) + '" download><i class="fa-solid fa-paper-plane"></i>Postman</a></div></div>' +
      "</div></header>";

    html += '<main class="doc">';
    intro.sections.forEach(function (s) {
      var body = s.body.replace(/<SecurityDefinitions\s*\/>/g, "\n\n<div data-security></div>\n\n");
      html += '<section class="prose-section" id="' + s.id + '"><div class="prose"><h1>' + esc(s.title) + "</h1>" + md(body) + "</div><div></div></section>";
    });

    model.groups.forEach(function (g) {
      var icon = /webhook/i.test(g.name) ? "fa-bolt" : /model/i.test(g.name) ? "fa-cube" : "fa-plug";
      html += '<div class="group-head" id="' + g.id + '"><span class="bolt"><i class="fa-solid ' + icon + '"></i></span><h2>' + esc(g.name) + "</h2></div>";
      g.tags.forEach(function (t) {
        if (t.schemaRef && !t.ops.length) { html += modelHTML(t); return; }
        html += '<div class="tag-head" id="' + t.id + '"><h3>' + esc(t.display) + "</h3>" + (t.description ? "<p>" + md(t.description, true) + "</p>" : "") + "</div>";
        t.ops.forEach(function (o) { html += opHTML(o); });
      });
    });
    html += "</main>";
    html += '<footer class="page-foot"><img src="viewer/img/jammed-shadow.svg" alt="Jammed">' +
      "<span>© " + new Date().getFullYear() + " Jammed Bookings Ltd</span>" +
      (contact.email ? '<a href="mailto:' + esc(contact.email) + '">' + esc(contact.email) + "</a>" : "") +
      (contact.url ? '<a href="' + esc(contact.url) + '">Support</a>' : "") +
      '<a href="https://github.com/jammed-org/api">GitHub</a></footer>';

    content.innerHTML = html;
    content.querySelectorAll("[data-security]").forEach(function (n) { n.outerHTML = securityHTML(); });
    content.querySelectorAll(".prose a[href^='http']").forEach(function (a) { a.target = "_blank"; a.rel = "noopener"; });

    document.getElementById("nav").innerHTML = navHTML(model, intro);
    if (contact.email) document.getElementById("contact-link").href = "mailto:" + contact.email;

    fillCode(content);
    wire(model);
    jumpToHash();
  }

  function fillCode(root) {
    var byId = {};
    (fillCode.ops || []).forEach(function (o) { byId[o.id] = o; });
    root.querySelectorAll(".code-card[data-req]").forEach(function (card) {
      var o = byId[card.getAttribute("data-req")];
      if (!o) return;
      card.querySelector(".req-code").innerHTML = highlightCode(codeSample(o, lang), lang);
      card.querySelectorAll(".tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.getAttribute("data-lang") === lang)); });
    });
  }

  // ---------- interaction ----------

  function copy(text, btn) {
    function done() {
      if (!btn) return;
      var icon = btn.querySelector("i");
      btn.classList.add("done");
      if (icon) icon.className = "fa-solid fa-check";
      setTimeout(function () {
        btn.classList.remove("done");
        if (icon) icon.className = "fa-regular fa-copy";
      }, 1400);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () {});
    else {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      ta.remove();
    }
  }

  function wire(model) {
    var content = document.getElementById("content");
    var nav = document.getElementById("nav");

    content.addEventListener("click", function (e) {
      var tab = e.target.closest(".tab");
      if (tab) {
        lang = tab.getAttribute("data-lang");
        store("jammed-api-lang", lang);
        fillCode(content);
        return;
      }
      var btn = e.target.closest(".copy-btn");
      if (btn) {
        var text = btn.getAttribute("data-copy");
        if (text == null) {
          var card = btn.closest(".code-card");
          var pre = card && (card.querySelector("pre:not([hidden])") || card.querySelector("pre"));
          text = pre ? pre.textContent : "";
        }
        copy(text, btn);
      }
    });

    content.addEventListener("change", function (e) {
      if (e.target.matches(".code-card select")) {
        var card = e.target.closest(".code-card");
        card.querySelectorAll("pre[data-ex]").forEach(function (p) { p.hidden = p.getAttribute("data-ex") !== e.target.value; });
      }
    });

    // Lazy nested schema rendering.
    content.addEventListener("toggle", function (e) {
      var d = e.target;
      if (!d.matches || !d.matches("details[data-lazy]") || !d.open) return;
      var body = d.querySelector(":scope > .nested-body");
      if (body.childElementCount) return;
      var item = lazy[+d.getAttribute("data-lazy")];
      body.innerHTML = propsHTML(item.schema, item.ancestry);
    }, true);

    // Search filter
    var input = document.getElementById("search");
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      var any = false;
      nav.querySelectorAll(".nav-group").forEach(function (g) {
        var groupHit = false;
        g.querySelectorAll(":scope > .nav-link").forEach(function (a) {
          var hit = !q || a.getAttribute("data-search").indexOf(q) !== -1;
          a.hidden = !hit;
          groupHit = groupHit || hit;
        });
        g.querySelectorAll(".nav-tag").forEach(function (d) {
          var tagHit = false;
          d.querySelectorAll(".nav-link").forEach(function (a) {
            var hit = !q || a.getAttribute("data-search").indexOf(q) !== -1;
            a.hidden = !hit;
            tagHit = tagHit || hit;
          });
          d.hidden = !tagHit;
          if (q) d.open = tagHit;
          groupHit = groupHit || tagHit;
        });
        g.hidden = !groupHit;
        any = any || groupHit;
      });
      nav.querySelector(".nav-empty").hidden = any;
      if (!q) syncActive(true);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = nav.querySelector(".nav-link:not([hidden])");
        if (first && first.closest(".nav-tag:not([hidden]), .nav-group:not([hidden])")) { first.click(); input.blur(); }
      } else if (e.key === "Escape") {
        input.value = "";
        input.dispatchEvent(new Event("input"));
        input.blur();
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== input && !/input|textarea|select/i.test(document.activeElement.tagName)) {
        e.preventDefault();
        input.focus();
      }
    });

    // Mobile nav
    document.getElementById("menu-btn").addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      this.setAttribute("aria-expanded", String(open));
    });
    document.getElementById("scrim").addEventListener("click", closeNav);
    nav.addEventListener("click", function (e) { if (e.target.closest(".nav-link")) closeNav(); });

    // Scroll spy
    var links = {};
    nav.querySelectorAll(".nav-link").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
    var targets = Object.keys(links).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var current = null;
    var ticking = false;
    function syncActive(force) {
      ticking = false;
      var y = window.scrollY + parseInt(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h"), 10) + 40;
      var found = null;
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].offsetTop <= y) found = targets[i];
        else break;
      }
      if (!found || (found === current && !force)) return;
      if (current && links[current.id]) links[current.id].classList.remove("active");
      current = found;
      var a = links[found.id];
      a.classList.add("active");
      var tag = a.closest(".nav-tag");
      if (tag && !tag.open && !input.value) tag.open = true;
      var nr = nav.getBoundingClientRect();
      var ar = a.getBoundingClientRect();
      if (ar.top < nr.top + 20 || ar.bottom > nr.bottom - 20) nav.scrollTop += ar.top - nr.top - nr.height / 3;
    }
    syncActive.targets = targets;
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(function () { syncActive(false); }); }
    }, { passive: true });
    wire.syncActive = syncActive;
    syncActive(true);
  }

  function syncActive(force) { if (wire.syncActive) wire.syncActive(force); }

  function closeNav() {
    document.body.classList.remove("nav-open");
    document.getElementById("menu-btn").setAttribute("aria-expanded", "false");
  }

  function jumpToHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    var target = document.getElementById(id);
    if (target) target.scrollIntoView();
  }

  function showError(err) {
    document.getElementById("content").innerHTML =
      '<div class="state"><div><div class="loader" style="animation:none;background:var(--jam-black)"><i class="fa-solid fa-plug-circle-xmark"></i></div>' +
      "<h2>Couldn’t load the API spec</h2><p>" + esc(err && err.message ? err.message : err) +
      '</p><p style="margin-top:12px"><a href="' + esc(SPEC_URL) + '">Open the raw OpenAPI file</a></p></div></div>';
  }

  // ---------- boot ----------

  window.marked.setOptions({ gfm: true, breaks: false });

  fetch(SPEC_URL, { cache: "no-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error(res.status + " " + res.statusText + " fetching " + SPEC_URL);
      return res.text();
    })
    .then(function (text) {
      spec = window.jsyaml.load(text);
      if (!spec || !spec.paths) throw new Error("That file doesn’t look like an OpenAPI spec.");
      render();
    })
    .catch(function (err) {
      console.error(err);
      showError(err);
    });
})();
