"use strict";

const wco = require("./wco.js");

async function getStreams(inputId, mediaType, season, episode) {
  const type = String(mediaType || "").toLowerCase();
  if (type === "movie" || Number(season) !== 0) return [];

  const fallbackSeason = Number(episode || 0);
  if (!Number.isFinite(fallbackSeason) || fallbackSeason < 1) return [];

  try {
    const streams = await wco.getStreams(inputId, "tv", fallbackSeason, 0);
    return (streams || []).map(stream => ({
      ...stream,
      name: String(stream.name || "WCO").replace(/^WCO\s*•\s*/i, "WCO Episode 0 Test • ") + ` • S0E${fallbackSeason}→S${fallbackSeason}E0`,
      provider: "WCO Episode 0 Test"
    }));
  } catch (_) {
    return [];
  }
}

module.exports = { getStreams };
