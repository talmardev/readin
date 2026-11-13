window.RI = window.RI || {};

// Open Library client, classic script, no DOM

RI.openlibrary = (function () {
  "use strict";

  const SITE_URL = "https://openlibrary.org";
  const SEARCH_URL = SITE_URL + "/search.json";
  const COVER_URL = "https://covers.openlibrary.org/b/id/";
  const TRENDING_URL = SITE_URL + "/trending/monthly.json";
  const MIN_QUERY_LENGTH = 3;
  const FETCH_LIMIT = 12;
  const RESULT_LIMIT = 8;
  const SUGGESTION_COUNT = 10;
  const SUGGESTION_GENRES = 3;
  const GENRE_PAGE_SIZE = 12;
  const MAX_GENRE_PAGES = 3;
  const TRENDING_LIMIT = 30;
  const SEARCH_TIMEOUT_MS = 8000;
  const COVER_TIMEOUT_MS = 15000;
  // placeholder covers are smaller than this
  const MIN_COVER_BYTES = 1024;

  // the only genre keywords ever sent
  const GENRE_SUBJECTS = {
    "nf-finance-investing": "finance",
    "nf-business": "business",
    "nf-economics": "economics",
    "nf-self-help": "self-help",
    "nf-productivity": "time management",
    "nf-psychology": "psychology",
    "nf-philosophy": "philosophy",
    "nf-history": "world history",
    "nf-biography-memoir": "biography",
    "nf-politics": "political science",
    "nf-science": "popular science",
    "nf-technology": "technology",
    "nf-health-wellness": "health",
    "nf-parenting-family": "parenting",
    "nf-travel": "travel",
    "nf-true-crime": "true crime",
    "nf-religion-spirituality": "religion",
    "nf-sociology": "sociology",
    "nf-nature-environment": "nature",
    "nf-art-design": "art",
    "nf-cooking-food": "cooking",
    "nf-sports": "athletes",
    "nf-essays-journalism": "essays",
    "nf-law": "constitutional law",
    "nf-education": "learning",
    "nf-reference": "reference",
    "fic-literary-fiction": "literary fiction",
    "fic-fantasy": "fantasy",
    "fic-science-fiction": "science fiction",
    "fic-mystery": "mystery",
    "fic-thriller": "thriller",
    "fic-horror": "horror",
    "fic-romance": "romance",
    "fic-historical-fiction": "historical fiction",
    "fic-crime": "crime",
    "fic-classics": "classics",
    "fic-young-adult": "young adult",
    "fic-short-stories": "short stories",
    "fic-poetry": "poetry",
    "fic-graphic-novels-comics": "graphic novels",
    "fic-adventure": "adventure",
    "fic-dystopian": "dystopia",
    "fic-satire": "satire",
  };

  // work fields plus the best edition
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

  // kinds: empty, isbn, invalidIsbn, text
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

  // params are plain search.json parameters
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

  // fetch with timeout, errors carry a code
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

  // typed ISBN first, then ISBN-13
  function pickIsbn(list, typed) {
    if (typed) return typed;
    if (!Array.isArray(list) || list.length === 0) return "";
    const isbn13 = list.find((v) => /^97[89]\d{10}$/.test(v));
    return isbn13 || list[0];
  }

  // edition data wins over work data
  function normalizeDoc(doc, typedIsbn) {
    if (!doc) return null;
    const edition = doc.editions && Array.isArray(doc.editions.docs) ? doc.editions.docs[0] : null;
    const title = cleanText((edition && edition.title) || doc.title, 200);
    if (!title) return null;
    const authors = Array.isArray(doc.author_name) ? doc.author_name.slice(0, 3) : [];
    return {
      workKey: doc.key || "",
      title,
      // the work's own title
      workTitle: cleanText(doc.title, 200),
      author: cleanText(authors.join(", "), 200),
      year: positiveInt(doc.first_publish_year),
      pages: positiveInt(edition && edition.number_of_pages) || positiveInt(doc.number_of_pages_median),
      coverId: positiveInt(edition && edition.cover_i) || positiveInt(doc.cover_i),
      isbn: cleanText(pickIsbn(edition && edition.isbn, typedIsbn), 32),
    };
  }

  // drops repeats, bare records go last
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

  // query comes from classifyQuery
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

  // one page of works for a subject
  async function genrePage(term, page, lang) {
    const params = { subject: term, limit: String(GENRE_PAGE_SIZE), offset: String(page * GENRE_PAGE_SIZE) };
    const docs = await fetchDocs(params, { lang });
    return docs.map((d) => normalizeDoc(d, "")).filter((r) => r && r.coverId);
  }

  // trending lacks pages, so look up keys
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

  // one request per key and page load
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

  // random genres, weighted by book count
  function chooseGenres(genres) {
    const pool = (genres || [])
      .filter((g) => g && GENRE_SUBJECTS[g.id])
      .map((g) => ({ term: GENRE_SUBJECTS[g.id], weight: Math.max(1, Number(g.weight) || 1) }));
    const chosen = [];
    while (chosen.length < SUGGESTION_GENRES && pool.length > 0) {
      const total = pool.reduce((sum, g) => sum + g.weight, 0);
      let roll = Math.random() * total;
      let idx = 0;
      while (idx < pool.length - 1 && roll >= pool[idx].weight) {
        roll -= pool[idx].weight;
        idx += 1;
      }
      chosen.push(pool.splice(idx, 1)[0].term);
    }
    return chosen;
  }

  // round robin, skipping owned and repeats
  function pickFromPools(pools, owned, wanted) {
    const queues = pools.map((pool) => shuffle(pool.filter((r) => !owned(r))));
    const taken = new Set();
    const picks = [];
    let progressed = true;
    while (picks.length < wanted && progressed) {
      progressed = false;
      for (const queue of queues) {
        while (queue.length > 0 && picks.length < wanted) {
          const next = queue.shift();
          if (taken.has(next.workKey)) continue;
          taken.add(next.workKey);
          picks.push(next);
          progressed = true;
          break;
        }
      }
    }
    return picks;
  }

  // only genre keywords leave, owned dropped locally
  async function suggestions({ genres, isOwned, lang, count } = {}) {
    const wanted = count || SUGGESTION_COUNT;
    const owned = typeof isOwned === "function" ? isOwned : () => false;
    const terms = chooseGenres(genres);
    let picks = [];
    if (terms.length > 0) {
      const pools = terms.map(() => []);
      // next pages fill the owned gaps
      for (let page = 0; page < MAX_GENRE_PAGES && picks.length < wanted; page += 1) {
        const lists = await Promise.all(
          terms.map((term) => cachedOnce("genre:" + lang + ":" + term + ":" + page, () => genrePage(term, page, lang)).catch(() => []))
        );
        lists.forEach((list, i) => {
          pools[i] = pools[i].concat(list);
        });
        picks = pickFromPools(pools, owned, wanted);
        if (lists.every((list) => list.length === 0)) break;
      }
    }
    // trending fills what is still missing
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

  // S for lists, M for suggestions
  function thumbUrl(coverId, size) {
    return COVER_URL + coverId + "-" + (size || "S") + ".jpg?default=false";
  }

  const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

  // downloads a File, missing covers 404
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
