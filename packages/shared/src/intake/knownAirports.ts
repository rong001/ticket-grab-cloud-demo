/**
 * Domestic + common international airports for flight intake disambiguation.
 * City-only answers with multiple airports must clarify (no confirm until IATA/name resolved).
 */

export type AirportInfo = {
  iata: string;
  /** Display name, e.g. 深圳宝安 */
  name: string;
  city: string;
};

export const KNOWN_AIRPORTS: readonly AirportInfo[] = [
  { iata: "PEK", name: "北京首都", city: "北京" },
  { iata: "PKX", name: "北京大兴", city: "北京" },
  { iata: "PVG", name: "上海浦东", city: "上海" },
  { iata: "SHA", name: "上海虹桥", city: "上海" },
  { iata: "CAN", name: "广州白云", city: "广州" },
  { iata: "SZX", name: "深圳宝安", city: "深圳" },
  { iata: "CTU", name: "成都双流", city: "成都" },
  { iata: "TFU", name: "成都天府", city: "成都" },
  { iata: "CKG", name: "重庆江北", city: "重庆" },
  { iata: "XIY", name: "西安咸阳", city: "西安" },
  { iata: "HGH", name: "杭州萧山", city: "杭州" },
  { iata: "NKG", name: "南京禄口", city: "南京" },
  { iata: "WUH", name: "武汉天河", city: "武汉" },
  { iata: "CSX", name: "长沙黄花", city: "长沙" },
  { iata: "KMG", name: "昆明长水", city: "昆明" },
  { iata: "XMN", name: "厦门高崎", city: "厦门" },
  { iata: "TAO", name: "青岛胶东", city: "青岛" },
  { iata: "SYX", name: "三亚凤凰", city: "三亚" },
  { iata: "HAK", name: "海口美兰", city: "海口" },
  { iata: "URC", name: "乌鲁木齐地窝堡", city: "乌鲁木齐" },
  { iata: "SHE", name: "沈阳桃仙", city: "沈阳" },
  { iata: "DLC", name: "大连周水子", city: "大连" },
  { iata: "TSN", name: "天津滨海", city: "天津" },
  { iata: "CGO", name: "郑州新郑", city: "郑州" },
  { iata: "FOC", name: "福州长乐", city: "福州" },
  { iata: "NGB", name: "宁波栎社", city: "宁波" },
  { iata: "HFE", name: "合肥新桥", city: "合肥" },
  { iata: "NNG", name: "南宁吴圩", city: "南宁" },
  { iata: "KWE", name: "贵阳龙洞堡", city: "贵阳" },
  { iata: "LHW", name: "兰州中川", city: "兰州" },
  { iata: "HRB", name: "哈尔滨太平", city: "哈尔滨" },
  { iata: "CGQ", name: "长春龙嘉", city: "长春" },
  { iata: "TNA", name: "济南遥墙", city: "济南" },
  { iata: "WNZ", name: "温州龙湾", city: "温州" },
  { iata: "JJN", name: "泉州晋江", city: "泉州" },
  { iata: "KHN", name: "南昌昌北", city: "南昌" },
  { iata: "TYN", name: "太原武宿", city: "太原" },
  { iata: "SJW", name: "石家庄正定", city: "石家庄" },
  { iata: "INC", name: "银川河东", city: "银川" },
  { iata: "XNN", name: "西宁曹家堡", city: "西宁" },
  { iata: "KWL", name: "桂林两江", city: "桂林" },
  { iata: "LJG", name: "丽江三义", city: "丽江" },
  { iata: "DLU", name: "大理", city: "大理" },
  { iata: "HKG", name: "香港国际", city: "香港" },
  { iata: "MFM", name: "澳门国际", city: "澳门" },
  { iata: "TPE", name: "台北桃园", city: "台北" },
] as const;

const BY_IATA = new Map(KNOWN_AIRPORTS.map((a) => [a.iata, a]));
const BY_CITY = new Map<string, AirportInfo[]>();
for (const a of KNOWN_AIRPORTS) {
  const list = BY_CITY.get(a.city) ?? [];
  list.push(a);
  BY_CITY.set(a.city, list);
}

export type AirportResolve =
  | { kind: "exact"; airport: AirportInfo; label: string }
  | { kind: "ambiguous"; city: string; candidates: AirportInfo[] }
  | { kind: "unknown"; query: string };

function formatAirport(a: AirportInfo): string {
  return `${a.name} ${a.iata}`;
}

/**
 * Resolve city / IATA / Chinese airport name to a concrete airport.
 * Multi-airport cities (北京/上海/成都) → ambiguous until user picks.
 */
export function resolveAirport(raw: string): AirportResolve {
  const t = raw.trim().replace(/机场$/u, "").replace(/国际$/u, "");
  if (!t || t.length < 2) return { kind: "unknown", query: raw.trim() };
  if (/\d|[./]|到|去|至/.test(t) && !/^[A-Za-z]{3}$/.test(t)) {
    return { kind: "unknown", query: raw.trim() };
  }

  const iata = t.toUpperCase();
  if (/^[A-Z]{3}$/.test(iata) && BY_IATA.has(iata)) {
    const a = BY_IATA.get(iata)!;
    return { kind: "exact", airport: a, label: formatAirport(a) };
  }

  // Exact city with single airport → auto
  const cityKey = t.replace(/市$/u, "");
  const cityHits = BY_CITY.get(cityKey);
  if (cityHits) {
    if (cityHits.length === 1) {
      const a = cityHits[0]!;
      return { kind: "exact", airport: a, label: formatAirport(a) };
    }
    return { kind: "ambiguous", city: cityKey, candidates: cityHits };
  }

  // Match by Chinese name fragment (宝安 / 浦东 / 首都 / 天府 …)
  const nameHits = KNOWN_AIRPORTS.filter(
    (a) =>
      a.name === t ||
      a.name.includes(t) ||
      t.includes(a.name) ||
      `${a.city}${a.name}`.includes(t) ||
      t.includes(a.iata)
  );
  const uniq = [...new Map(nameHits.map((a) => [a.iata, a])).values()];
  if (uniq.length === 1) {
    const a = uniq[0]!;
    return { kind: "exact", airport: a, label: formatAirport(a) };
  }
  if (uniq.length > 1) {
    return {
      kind: "ambiguous",
      city: uniq[0]!.city,
      candidates: uniq,
    };
  }

  return { kind: "unknown", query: raw.trim() };
}

export function isConcreteAirportLabel(place?: string): boolean {
  if (!place) return false;
  const r = resolveAirport(place);
  return r.kind === "exact";
}

export function formatAirportChoices(list: AirportInfo[]): string {
  return list.map((a) => `「${a.name} ${a.iata}」`).join(" / ");
}
