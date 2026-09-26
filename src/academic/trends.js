import dns from "node:dns";

// Ensure IPv4 first to avoid IPv6 connect timeouts on certain ISPs
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

// In-memory cache for Google Trends queries (1 hour TTL)
const trendsCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

// Cookie session cache (NID cookie remains valid for hours)
let cachedCookie = null;
let cookieExpiry = 0;

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Acquire NID cookie from Google Trends entry page to bypass 429 rate limiting
 */
async function getGoogleCookie(geo = "VN") {
  const now = Date.now();
  if (cachedCookie && now < cookieExpiry) {
    return cachedCookie;
  }

  try {
    const res = await fetch(`https://trends.google.com/trends/?geo=${geo}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi,en-US;q=0.9,en;q=0.8"
      }
    });

    const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
    const cookieStr = (rawCookies || [])
      .map(c => (c ? c.split(";")[0] : ""))
      .filter(Boolean)
      .join("; ");

    if (cookieStr) {
      cachedCookie = cookieStr;
      cookieExpiry = now + 4 * 60 * 60 * 1000; // Cache cookie for 4 hours
      return cachedCookie;
    }
  } catch (err) {
    console.error("[GoogleTrends] Cookie acquisition error:", err.message);
  }

  return cachedCookie || "";
}

/**
 * Helper to safely extract JSON after Google's security prefix )]}'
 */
function parseGoogleJson(text) {
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) {
    throw new Error("Invalid response format: JSON object not found");
  }
  return JSON.parse(text.slice(jsonStart));
}

/**
 * Main query function to fetch Google Trends data
 * 
 * @param {Object} options
 * @param {string} options.keyword - Search keyword/topic
 * @param {string} [options.geo="VN"] - ISO Country code ("VN", "US", "" for worldwide)
 * @param {string} [options.timeframe="today 12-m"] - Time range ("today 1-m", "today 3-m", "today 12-m", "today 5-y")
 * @param {string} [options.hl="vi"] - Host language
 * @returns {Promise<Object>} Formatted Trends analytical report
 */
export async function fetchTrendsData({
  keyword,
  geo = "VN",
  timeframe = "today 12-m",
  hl = "vi"
}) {
  if (!keyword || !keyword.trim()) {
    throw new Error("Keyword is required for Google Trends query");
  }

  const cleanKeyword = keyword.trim();
  const cacheKey = `${cleanKeyword.toLowerCase()}_${geo}_${timeframe}_${hl}`;
  const cached = trendsCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const cookie = await getGoogleCookie(geo);
  const tz = -420; // UTC+7 for Indochina Time

  // 1. Call Explore API
  const reqPayload = {
    comparisonItem: [{ keyword: cleanKeyword, geo: geo || "", time: timeframe }],
    category: 0,
    property: ""
  };

  const exploreUrl = `https://trends.google.com/trends/api/explore?hl=${hl}&tz=${tz}&req=${encodeURIComponent(JSON.stringify(reqPayload))}`;

  const exploreRes = await fetch(exploreUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
      ...(cookie ? { "Cookie": cookie } : {})
    }
  });

  if (!exploreRes.ok) {
    throw new Error(`Google Trends explore error (HTTP ${exploreRes.status})`);
  }

  const exploreRaw = await exploreRes.text();
  const exploreData = parseGoogleJson(exploreRaw);

  const widgets = exploreData.widgets || [];
  const tsWidget = widgets.find(w => w.id === "TIMESERIES");
  const relWidget = widgets.find(w => w.id === "RELATED_QUERIES");

  let timeline = [];
  let topQueries = [];
  let risingQueries = [];

  // 2. Fetch Timeseries data
  if (tsWidget && tsWidget.token) {
    try {
      const tsUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=${hl}&tz=${tz}&req=${encodeURIComponent(JSON.stringify(tsWidget.request))}&token=${encodeURIComponent(tsWidget.token)}`;
      const tsRes = await fetch(tsUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          ...(cookie ? { "Cookie": cookie } : {})
        }
      });

      if (tsRes.ok) {
        const tsRaw = await tsRes.text();
        const tsJson = parseGoogleJson(tsRaw);
        const points = tsJson.default?.timelineData || [];
        timeline = points.map(d => ({
          date: d.formattedTime || "",
          timestamp: d.time ? parseInt(d.time, 10) * 1000 : null,
          value: d.value ? d.value[0] : 0,
          formattedValue: d.formattedValue ? d.formattedValue[0] : "0"
        }));
      }
    } catch (tsErr) {
      console.error("[GoogleTrends] Timeseries fetch error:", tsErr.message);
    }
  }

  // 3. Fetch Related Queries
  if (relWidget && relWidget.token) {
    try {
      const relUrl = `https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=${hl}&tz=${tz}&req=${encodeURIComponent(JSON.stringify(relWidget.request))}&token=${encodeURIComponent(relWidget.token)}`;
      const relRes = await fetch(relUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          ...(cookie ? { "Cookie": cookie } : {})
        }
      });

      if (relRes.ok) {
        const relRaw = await relRes.text();
        const relJson = parseGoogleJson(relRaw);
        const rankedList = relJson.default?.rankedList || [];

        // Ranked list 0: Top searches (0-100)
        if (rankedList[0]?.rankedKeyword) {
          topQueries = rankedList[0].rankedKeyword.slice(0, 8).map(item => ({
            query: item.query,
            value: item.value
          }));
        }

        // Ranked list 1: Rising searches (+% or Breakout)
        if (rankedList[1]?.rankedKeyword) {
          risingQueries = rankedList[1].rankedKeyword.slice(0, 8).map(item => ({
            query: item.query,
            value: item.formattedValue || item.value
          }));
        }
      }
    } catch (relErr) {
      console.error("[GoogleTrends] Related queries fetch error:", relErr.message);
    }
  }

  // 4. Compute Statistical & Research Metrics
  const values = timeline.map(t => t.value).filter(v => typeof v === "number");
  const averageInterest = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  
  let peakInterest = { value: 0, date: "" };
  if (timeline.length > 0) {
    const peak = timeline.reduce((prev, curr) => (curr.value > prev.value ? curr : prev), timeline[0]);
    peakInterest = { value: peak.value, date: peak.date };
  }

  const currentInterest = timeline.length > 0 ? timeline[timeline.length - 1].value : 0;

  // Trend direction: Compare average of last 4 periods vs prior 4 periods
  let trendDirection = "stable";
  if (values.length >= 8) {
    const recentAvg = values.slice(-4).reduce((a, b) => a + b, 0) / 4;
    const priorAvg = values.slice(-8, -4).reduce((a, b) => a + b, 0) / 4;
    if (recentAvg > priorAvg * 1.15) {
      trendDirection = "increasing";
    } else if (recentAvg < priorAvg * 0.85) {
      trendDirection = "decreasing";
    }
  }

  // Suggested keywords for query expansion in Academic Search (from rising & top queries)
  const expansionKeywords = Array.from(
    new Set([
      ...risingQueries.slice(0, 4).map(r => r.query),
      ...topQueries.slice(0, 4).map(t => t.query)
    ])
  ).filter(q => q.toLowerCase() !== cleanKeyword.toLowerCase());

  const result = {
    keyword: cleanKeyword,
    geo: geo || "Worldwide",
    timeframe,
    metrics: {
      currentInterest,
      averageInterest,
      peakInterest,
      trendDirection,
      datapointsCount: timeline.length
    },
    expansionKeywords,
    topQueries,
    risingQueries,
    timeline,
    attribution: "Data source: Google Trends (Public Search Volume Index 0-100)",
    retrievedAt: new Date().toISOString()
  };

  trendsCache.set(cacheKey, {
    timestamp: Date.now(),
    data: result
  });

  return result;
}
