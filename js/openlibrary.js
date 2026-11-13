window.RI = window.RI || {};

// Open Library client: query parsing, search, suggestions and cover
// download. No DOM. Classic script, not a module (file:// blocks ES module
// fetches).

RI.openlibrary = (function () {
  "use strict";

  const SITE_URL = "https://openlibrary.org";
  const SEARCH_URL = SITE_URL + "/search.json";
  const COVER_URL = "https://covers.openlibrary.org/b/id/";
  const MIN_QUERY_LENGTH = 3;
  const FETCH_LIMIT = 12;
  const RESULT_LIMIT = 8;
  const TRENDING_URL = SITE_URL + "/trending/monthly.json";
  const SUGGESTION_COUNT = 10;
  const SUGGESTION_AUTHORS = 3;
  const WORKS_PER_AUTHOR = 5;
  const TRENDING_LIMIT = 30;
  const SEARCH_TIMEOUT_MS = 8000;
  const COVER_TIMEOUT_MS = 15000;
  // anything smaller than this is a placeholder, not a real cover
  const MIN_COVER_BYTES = 1024;

  // work-level fields plus the edition that best matches the query
  const SEARCH_FIELDS = [
    "key",
    "title",
    "author_name",
    "cover_i",
    "first_publish_year",
    "number_of_pages_median",
    "editions",
    "editions.title",
    "editions.isbn",
    "editions.number_of_pages",
    "editions.cover_i",
    "editions.language",
  ].join(",");

  function makeError(code, status) {
    const err = new Error("Open Library: " + code);
    err.code = code;
    if (status) err.status = status;
    return err;
  }

  function isValidIsbn10(digits) {
    if (!/^\d{9}[\dX]$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      const ch = digits[i];
      sum += (10 - i) * (ch === "X" ? 10 : Number(ch));
    }
    return sum % 11 === 0;
  }

  function isValidIsbn13(digits) {
    if (!/^\d{13}$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i += 1) {
      sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return sum % 10 === 0;
  }

  // Returns { kind, value }:
  //   empty        nothing typed
  //   isbn         a valid ISBN-10/13, value is the compact form
  //   invalidIsbn  shaped like an ISBN but the checksum fails
  //   text         anything else, value is the trimmed text
  function classifyQuery(raw) {
    const text = String(raw || "").trim().replace(/\s+/g, " ");
    if (!text) return { kind: "empty", value: "" };
    const compact = text.replace(/^isbn[:\s]*/i, "").replace(/[\s-]/g, "").toUpperCase();
    if (/^\d{9}[\dX]$/.test(compact) || /^\d{13}$/.test(compact)) {
      const valid = compact.length === 10 ? isValidIsbn10(compact) : isValidIsbn13(compact);
      return valid ? { kind: "isbn", value: compact } : { kind: "invalidIsbn", value: compact };
    }
    return { kind: "text", value: text };
  }

  // params: plain object of search.json parameters (q, author, limit, ...)
  function buildSearchUrl(params, lang) {
    const query = new URLSearchParams();
    Object.keys(params).forEach((name) => query.set(name, params[name]));
    query.set("fields", SEARCH_FIELDS);
    if (lang) query.set("lang", lang);
    return SEARCH_URL + "?" + query.toString();
  }

  async function fetchDocs(params, { signal, lang } = {}) {
    return request(buildSearchUrl(params, lang), {
      signal,
      timeoutMs: SEARCH_TIMEOUT_MS,
      read: async (res) => {
        const body = await res.json();
        return Array.isArray(body.docs) ? body.docs : [];
      },
    });
  }

  // Runs fetch with a timeout and an optional outside abort signal, and maps
  // every failure to an Error carrying a code: offline, timeout, abort, http,
  // network.
  async function request(url, { signal, timeoutMs, read }) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw makeError("offline");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOutsideAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onOutsideAbort);
    }
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw makeError("http", res.status);
      return await read(res);
    } catch (err) {
      if (timedOut) throw makeError("timeout");
      if (signal && signal.aborted) throw makeError("abort");
      if (err && err.code) throw err;
      throw makeError("network");
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onOutsideAbort);
    }
  }

  function cleanText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function positiveInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  // prefers the ISBN the user typed, then an ISBN-13, then whatever is there
  function pickIsbn(list, typed) {
    if (typed) return typed;
    if (!Array.isArray(list) || list.length === 0) return "";
    const isbn13 = list.find((v) => /^97[89]\d{10}$/.test(v));
    return isbn13 || list[0];
  }

  // Edition-level data (title, cover, ISBN, pages) is preferred because it
  // describes one real book; the work-level values are the fallback.
  function normalizeDoc(doc, typedIsbn) {
    if (!doc) return null;
    const edition = doc.editions && Array.isArray(doc.editions.docs) ? doc.editions.docs[0] : null;
    const title = cleanText((edition && edition.title) || doc.title, 200);
    if (!title) return null;
    const authors = Array.isArray(doc.author_name) ? doc.author_name.slice(0, 3) : [];
    return {
      workKey: doc.key || "",
      title,
      // the work's own title, which can differ from the edition title above
      workTitle: cleanText(doc.title, 200),
      author: cleanText(authors.join(", "), 200),
      year: positiveInt(doc.first_publish_year),
      pages: positiveInt(edition && edition.number_of_pages) || positiveInt(doc.number_of_pages_median),
      coverId: positiveInt(edition && edition.cover_i) || positiveInt(doc.cover_i),
      isbn: cleanText(pickIsbn(edition && edition.isbn, typedIsbn), 32),
    };
  }

  // drops repeated work records and moves bare records (no author, no cover)
  // behind the complete ones, keeping Open Library's relevance order otherwise
  function tidyResults(results) {
    const seen = new Set();
    const unique = results.filter((r) => {
      const key = (r.title + "|" + r.author).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const complete = unique.filter((r) => r.author || r.coverId);
    const bare = unique.filter((r) => !r.author && !r.coverId);
    return complete.concat(bare).slice(0, RESULT_LIMIT);
  }

  // query comes from classifyQuery; kind must be "isbn" or "text"
  async function search(query, { signal, lang } = {}) {
    if (!query || (query.kind !== "isbn" && query.kind !== "text")) return [];
    const typedIsbn = query.kind === "isbn" ? query.value : "";
    const params = { q: query.kind === "isbn" ? "isbn:" + query.value : query.value, limit: String(FETCH_LIMIT) };
    const docs = await fetchDocs(params, { signal, lang });
    return tidyResults(docs.map((d) => normalizeDoc(d, typedIsbn)).filter(Boolean));
  }

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = copy[i];
      copy[i] = copy[j];
      copy[j] = swap;
    }
    return copy;
  }

  // The best known works of one author, cover required
  async function authorWorks(name, lang) {
    const docs = await fetchDocs({ author: name, limit: String(FETCH_LIMIT) }, { lang });
    const results = docs.map((d) => normalizeDoc(d, "")).filter((r) => r && r.coverId);
    return tidyResults(results).slice(0, WORKS_PER_AUTHOR);
  }

  // Trending works carry no page count or ISBN, so they are looked up again
  // by key in a single query that does. Falls back to the bare trending data.
  async function trendingWorks(lang) {
    const works = await request(TRENDING_URL + "?limit=" + TRENDING_LIMIT, {
      timeoutMs: SEARCH_TIMEOUT_MS,
      read: async (res) => {
        const body = await res.json();
        return Array.isArray(body.works) ? body.works : [];
      },
    });
    const keys = works.map((w) => w.key).filter((key) => /^\/works\/OL\d+W$/.test(key || ""));
    let detailed = new Map();
    if (keys.length > 0) {
      try {
        const query = "key:(" + keys.map((key) => '"' + key + '"').join(" OR ") + ")";
        const docs = await fetchDocs({ q: query, limit: String(keys.length) }, { lang });
        detailed = new Map(docs.map((d) => [d.key, normalizeDoc(d, "")]));
      } catch (err) {
        detailed = new Map();
      }
    }
    return works
      .map((w) => detailed.get(w.key) || normalizeDoc(w, ""))
      .filter((r) => r && r.coverId);
  }

  // one request set per page load: later calls reuse the same promise
  const poolCache = new Map();

  function cachedOnce(key, load) {
    if (!poolCache.has(key)) {
      const promise = load().catch((err) => {
        poolCache.delete(key);
        throw err;
      });
      poolCache.set(key, promise);
    }
    return poolCache.get(key);
  }

  // Book suggestions for the Add Book modal: other works by the given
  // authors first, then trending books to fill the rest. isOwned(result)
  // drops what the library already has. The pools are cached, the pick from
  // them is reshuffled on every call.
  async function suggestions({ authors, isOwned, lang, count } = {}) {
    const wanted = count || SUGGESTION_COUNT;
    const owned = typeof isOwned === "function" ? isOwned : () => false;
    const names = (authors || []).slice(0, SUGGESTION_AUTHORS);
    let picks = [];
    if (names.length > 0) {
      const personal = await cachedOnce("authors:" + lang + ":" + names.join("|"), async () => {
        const lists = await Promise.all(names.map((name) => authorWorks(name, lang).catch(() => [])));
        return [].concat(...lists);
      });
      picks = shuffle(personal.filter((r) => !owned(r))).slice(0, wanted);
    }
    if (picks.length < wanted) {
      let trending = [];
      try {
        trending = await cachedOnce("trending:" + lang, () => trendingWorks(lang));
      } catch (err) {
        trending = [];
      }
      const taken = new Set(picks.map((r) => r.workKey));
      const extra = shuffle(trending.filter((r) => !owned(r) && !taken.has(r.workKey)));
      picks = picks.concat(extra.slice(0, wanted - picks.length));
    }
    return picks;
  }

  // size: S for the result list, M for the suggestion covers
  function thumbUrl(coverId, size) {
    return COVER_URL + coverId + "-" + (size || "S") + ".jpg?default=false";
  }

  const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

  // Downloads the large cover as a File, so it goes through the same
  // fs.saveCover path as an uploaded one. default=false makes a missing
  // cover a 404 instead of a blank 1x1 image.
  async function fetchCover(coverId, { signal } = {}) {
    if (!coverId) throw makeError("nocover");
    let blob;
    try {
      blob = await request(COVER_URL + coverId + "-L.jpg?default=false", {
        signal,
        timeoutMs: COVER_TIMEOUT_MS,
        read: (res) => res.blob(),
      });
    } catch (err) {
      if (err && err.code === "http" && err.status === 404) throw makeError("nocover");
      throw err;
    }
    if (!blob.type.startsWith("image/") || blob.size < MIN_COVER_BYTES) throw makeError("nocover");
    const ext = EXTENSIONS[blob.type] || "jpg";
    return new File([blob], "cover." + ext, { type: blob.type });
  }

  return {
    SITE_URL,
    MIN_QUERY_LENGTH,
    classifyQuery,
    search,
    suggestions,
    fetchCover,
    thumbUrl,
  };
})();
