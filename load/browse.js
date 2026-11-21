// Signed-out learners browsing ML Arena: catalog pages, an item, its runner kit
// (what "Run in the browser" downloads) and the problem list. Read-only, so it
// can run against production too (with care), and it shows what a CDN saves.
//
//   k6 run -e BASE_URL=https://staging.example.com -e PROFILE=2k load/browse.js
import http from "k6/http";
import { check, sleep } from "k6";
import { API, API_P95_MS, MAX_ERROR_RATE, pick, stagesFor, think } from "./lib/config.js";

export const options = {
  scenarios: { browse: stagesFor() },
  thresholds: {
    http_req_failed: [`rate<${MAX_ERROR_RATE}`],
    "http_req_duration{kind:api}": [`p(95)<${API_P95_MS}`],
  },
};

const get = (url, name) => http.get(url, { tags: { name, kind: "api" } });

/** Collects item and topic ids once, so virtual users browse real pages. */
export function setup() {
  const tracks = get(`${API.arena}/tracks?area=ml`, "tracks").json("data");
  const items = [];
  const topics = [];
  for (const t of tracks.slice(0, 6)) {
    const track = get(`${API.arena}/tracks/${t.id}`, "track").json("data");
    for (const topic of track.topics.slice(0, 4)) {
      topics.push(topic.id);
      const detail = get(`${API.arena}/topics/${topic.id}`, "topic").json("data");
      for (const item of detail.items ?? []) items.push({ id: item.id, type: item.type });
    }
  }
  if (!items.length) throw new Error("no items found: check ARENA_API / BASE_URL");
  return { trackIds: tracks.map((t) => t.id), topics, items };
}

export default function (data) {
  check(get(`${API.arena}/tracks?area=ml`, "tracks"), { "tracks 200": (r) => r.status === 200 });
  sleep(think(1, 3));

  check(get(`${API.arena}/tracks/${pick(data.trackIds)}`, "track"), { "track 200": (r) => r.status === 200 });
  sleep(think(1, 3));

  check(get(`${API.arena}/topics/${pick(data.topics)}`, "topic"), { "topic 200": (r) => r.status === 200 });
  sleep(think());

  const item = pick(data.items);
  const view = get(`${API.arena}/items/${item.id}`, "item");
  check(view, { "item 200 or Pro-locked": (r) => r.status === 200 || r.status === 403 });
  if (view.status === 200 && view.json("data.runIn") === "browser") {
    // The page fetches the runner kit when the learner starts typing.
    check(get(`${API.arena}/items/${item.id}/runner`, "runner"), { "runner 200": (r) => r.status === 200 });
  }
  sleep(think(5, 15));

  check(get(`${API.arena}/problems?limit=50`, "problems"), { "problems 200": (r) => r.status === 200 });
  sleep(think());
}
