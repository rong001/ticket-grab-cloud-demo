"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";
import {
  FLIGHT_AIRPORTS,
  FLIGHT_CABINS,
  SEAT_CLASSES,
  SHOW_CITIES,
  SHOW_VENUES,
  TRAIN_CITIES,
  TRAIN_STATIONS,
  toCabinCode,
  todayISO,
  plusDaysISO,
  nextSaturdayISO,
  type SelectOption,
} from "@/lib/options/catalog";
import { useDamaiTheme } from "@/components/DamaiTheme";
import FlowStepper, { TRAIN_FLOW_STEPS, SHOW_FLOW_STEPS, FLIGHT_FLOW_STEPS } from "@/components/FlowStepper";
import DateStrip from "@/components/DateStrip";
import TrainResultsTable, { type TrainResultItem } from "@/components/TrainResultsTable";
import ShowResultsList, { type ShowResultItem } from "@/components/ShowResultsList";
import {
  REQUEST_TEMPLATES,
  resolveTemplateFields,
  templatesForChannel,
  type Channel,
  type RequestTemplate,
} from "@/lib/options/templates";

type FormState = {
  fromCity: string;
  toCity: string;
  from: string;
  to: string;
  date: string;
  seatClass: string;
  passengers: string;
  eventName: string;
  city: string;
  venue: string;
  quantity: string;
  performanceId: string;
  detailUrl: string;
  cabin: string;
};

const HOT_SHOW_CITIES = ["北京", "上海", "广州", "深圳", "成都", "杭州", "武汉", "西安"];
const HOT_TRAIN_CITIES = ["北京", "上海", "广州", "深圳", "杭州", "南京", "武汉", "成都", "西安", "长沙"];
const SHOW_CATEGORIES = ["演唱会", "音乐剧", "话剧", "体育", "演唱会巡演", "脱口秀", "展览"];

const emptyForm: FormState = {
  fromCity: "",
  toCity: "",
  from: "",
  to: "",
  date: "",
  seatClass: "",
  passengers: "1",
  eventName: "",
  city: "",
  venue: "",
  quantity: "1",
  performanceId: "",
  detailUrl: "",
  cabin: "",
};

export default function NewRequestPage() {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("train");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notifyOnly, setNotifyOnly] = useState(true);
  const [showCategory, setShowCategory] = useState<string>("");
  const [fromStationOpts, setFromStationOpts] = useState<SelectOption[]>([]);
  const [toStationOpts, setToStationOpts] = useState<SelectOption[]>([]);
  const [venueOpts, setVenueOpts] = useState<SelectOption[]>(SHOW_VENUES);
  const [stationsSource, setStationsSource] = useState<string>("");
  const [venuesLive, setVenuesLive] = useState(false);
  const [fromStationsLoading, setFromStationsLoading] = useState(false);
  const [toStationsLoading, setToStationsLoading] = useState(false);
  const [stationsError, setStationsError] = useState("");
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [venuesError, setVenuesError] = useState("");
  const [venueCount, setVenueCount] = useState(0);
  const [venuesSparse, setVenuesSparse] = useState(false);
  const [publicItems, setPublicItems] = useState<Array<TrainResultItem & ShowResultItem & { channel?: string }>>([]);
  const [publicMeta, setPublicMeta] = useState<{
    liveOk: boolean;
    notes: string | null;
    queriedAt: string;
    mode?: string;
    provider?: string;
  } | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  useDamaiTheme(channel === "show");

  useEffect(() => {
    setLoggedIn(!!getToken());
  }, []);

  const minDate = todayISO();

  function setDateChip(iso: string) {
    setField("date", iso);
  }

  const searchCities = useCallback(async (q: string): Promise<SelectOption[]> => {
    try {
      const res = await api<{ items: { value: string; label: string; category: string }[] }>(
        `/meta/cities?q=${encodeURIComponent(q)}&limit=60`,
        { auth: false },
      );
      return (res.items ?? []).map((i) => ({
        value: i.value,
        label: i.label,
        category: i.category || "城市",
      }));
    } catch {
      return [];
    }
  }, []);

  const searchStations = useCallback(async (q: string): Promise<SelectOption[]> => {
    try {
      const res = await api<{ items: { value: string; label: string; category: string }[] }>(
        `/meta/stations?q=${encodeURIComponent(q)}&limit=40`,
        { auth: false },
      );
      return (res.items ?? []).map((i) => ({
        value: i.value,
        label: i.label,
        category: i.category || "12306",
      }));
    } catch {
      return [];
    }
  }, []);

  const loadStationsForCity = useCallback(async (city: string): Promise<SelectOption[]> => {
    if (!city.trim()) return [];
    try {
      const res = await api<{
        items: { value: string; label: string; category: string; cityName?: string }[];
        source?: string;
        totalInCity?: number;
        error?: string;
        cache?: { error?: string | null };
      }>(`/meta/stations?city=${encodeURIComponent(city)}&limit=500`, { auth: false });
      if (res.source) setStationsSource(res.source);
      if (res.error || res.cache?.error) {
        setStationsError(String(res.error || res.cache?.error));
      } else {
        setStationsError("");
      }
      return (res.items ?? []).map((i) => ({
        value: i.value,
        label: i.label,
        category: i.cityName || i.category || city,
      }));
    } catch (e) {
      setStationsError(e instanceof Error ? e.message : "车站列表加载失败");
      return TRAIN_STATIONS.filter(
        (s) => s.value === city || s.value.startsWith(city) || s.category.includes(city),
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!form.fromCity) {
      setFromStationOpts([]);
      setFromStationsLoading(false);
      return;
    }
    setFromStationsLoading(true);
    loadStationsForCity(form.fromCity).then((opts) => {
      if (!cancelled) {
        setFromStationOpts(opts);
        setFromStationsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [form.fromCity, loadStationsForCity]);

  useEffect(() => {
    let cancelled = false;
    if (!form.toCity) {
      setToStationOpts([]);
      setToStationsLoading(false);
      return;
    }
    setToStationsLoading(true);
    loadStationsForCity(form.toCity).then((opts) => {
      if (!cancelled) {
        setToStationOpts(opts);
        setToStationsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [form.toCity, loadStationsForCity]);

  useEffect(() => {
    let cancelled = false;
    if (!form.city.trim()) {
      setVenueOpts(SHOW_VENUES);
      setVenuesLive(false);
      setVenueCount(0);
      setVenuesSparse(false);
      setVenuesError("");
      setVenuesLoading(false);
      return;
    }
    setVenuesLoading(true);
    setVenuesError("");
    const timer = window.setTimeout(() => {
      const q = form.eventName.trim();
      const qs = q ? `&q=${encodeURIComponent(q)}` : "";
      api<{
        items: { value: string; label: string; category: string; source?: string }[];
        liveOk?: boolean;
        venueCount?: number;
        sparse?: boolean;
        error?: string;
        liveCount?: number;
        curatedCount?: number;
      }>(`/meta/venues?city=${encodeURIComponent(form.city)}&limit=50${qs}`, { auth: false })
        .then((res) => {
          if (cancelled) return;
          const live = (res.items ?? []).map((i) => ({
            value: i.value,
            label: i.label,
            category: i.category || form.city,
          }));
          if (live.length) {
            const curated = SHOW_VENUES.filter((v) => v.category === form.city || v.value.includes(form.city));
            const seen = new Set(live.map((l) => l.value));
            const merged = [...live, ...curated.filter((c) => !seen.has(c.value))];
            setVenueOpts(merged);
            setVenueCount(res.venueCount ?? merged.length);
            setVenuesLive(!!res.liveOk);
            setVenuesSparse(!!res.sparse);
            setVenuesError(res.error ? String(res.error) : "");
          } else {
            const fallback = SHOW_VENUES.filter((v) => v.category === form.city || !form.city);
            setVenueOpts(fallback);
            setVenueCount(fallback.length);
            setVenuesLive(false);
            setVenuesSparse(true);
            setVenuesError(res.error ? String(res.error) : "暂无公开场馆，已显示常用场馆");
          }
          setVenuesLoading(false);
        })
        .catch((e) => {
          if (!cancelled) {
            const fallback = SHOW_VENUES.filter((v) => v.category === form.city);
            setVenueOpts(fallback);
            setVenueCount(fallback.length);
            setVenuesLive(false);
            setVenuesSparse(true);
            setVenuesError(e instanceof Error ? e.message : "场馆加载失败");
            setVenuesLoading(false);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.city, form.eventName]);

  const channelTemplates = useMemo(() => templatesForChannel(channel), [channel]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setActiveTemplate(null);
  }

  function setFromCity(city: string) {
    setForm((prev) => ({
      ...prev,
      fromCity: city,
      from: prev.fromCity === city ? prev.from : "",
    }));
    setActiveTemplate(null);
  }

  function setToCity(city: string) {
    setForm((prev) => ({
      ...prev,
      toCity: city,
      to: prev.toCity === city ? prev.to : "",
    }));
    setActiveTemplate(null);
  }

  function swapCities() {
    setForm((prev) => ({
      ...prev,
      fromCity: prev.toCity,
      toCity: prev.fromCity,
      from: prev.to,
      to: prev.from,
    }));
    setActiveTemplate(null);
  }

  function setShowCity(city: string) {
    setForm((prev) => ({
      ...prev,
      city,
      venue: prev.city === city ? prev.venue : "",
    }));
    setActiveTemplate(null);
  }

  function applyTemplate(t: RequestTemplate) {
    const fields = resolveTemplateFields(t);
    setChannel(t.channel);
    setForm((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(fields)) {
        if (k in next) {
          (next as Record<string, string>)[k] = String(v);
        }
      }
      // Infer cities from station names when templates only set from/to
      if (t.channel === "train") {
        if (!next.fromCity && next.from) {
          next.fromCity = next.from.replace(/(东|西|南|北|站)$/g, "") || next.from;
        }
        if (!next.toCity && next.to) {
          next.toCity = next.to.replace(/(东|西|南|北|站)$/g, "") || next.to;
        }
      }
      return next;
    });
    setActiveTemplate(t.id);
    setError("");
  }

  function switchChannel(id: Channel) {
    setChannel(id);
    setActiveTemplate(null);
  }

  function buildFields(): Record<string, unknown> | null {
    if (channel === "train") {
      if (!form.from || !form.to) {
        setError("请先选择城市，再选择具体车站");
        return null;
      }
      return {
        from: form.from,
        to: form.to,
        fromCity: form.fromCity || undefined,
        toCity: form.toCity || undefined,
        date: form.date,
        seatClass: form.seatClass || undefined,
        passengers: Number(form.passengers || 1),
      };
    }
    if (channel === "show") {
      const q = form.eventName.trim();
      const withCat =
        showCategory && q && !q.includes(showCategory) ? `${q} ${showCategory}` : q || showCategory;
      return {
        eventName: withCat || form.eventName,
        city: form.city || undefined,
        venue: form.venue || undefined,
        date: form.date || undefined,
        quantity: Number(form.quantity || 1),
        performanceId: form.performanceId || undefined,
        detailUrl: form.detailUrl || undefined,
        category: showCategory || undefined,
      };
    }
    return {
      from: form.from,
      to: form.to,
      date: form.date,
      cabin: toCabinCode(form.cabin),
      passengers: Number(form.passengers || 1),
    };
  }

  /** Guest + logged-in: public search on this page — never redirect to login for 查询. */
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setPublicItems([]);
    setPublicMeta(null);
    const fields = buildFields();
    if (!fields) {
      setLoading(false);
      return;
    }
    if (channel === "train" && !form.date) {
      setError("请选择出发日");
      setLoading(false);
      return;
    }
    if (channel === "flight" && (!form.from || !form.to || !form.date)) {
      setError("请填写出发、到达与日期");
      setLoading(false);
      return;
    }
    if (channel === "show" && !form.eventName.trim() && !showCategory) {
      setError("请填写演出关键词或选择分类");
      setLoading(false);
      return;
    }
    try {
      const res = await api<{
        items: Array<TrainResultItem & ShowResultItem>;
        liveOk: boolean;
        notes: string | null;
        queriedAt: string;
        mode?: string;
        provider?: string;
      }>("/public/search", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ channel, fields }),
      });
      setPublicItems(res.items ?? []);
      setPublicMeta({
        liveOk: res.liveOk === true,
        notes: res.notes ?? null,
        queriedAt: res.queriedAt,
        mode: res.mode,
        provider: res.provider,
      });
      if (!(res.items ?? []).length) {
        setError("未查到结果，可调整条件后重试");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }

  async function createWatchRequest() {
    if (!getToken()) {
      const returnUrl = encodeURIComponent("/requests/new");
      router.push(`/login?returnUrl=${returnUrl}`);
      return;
    }
    setLoading(true);
    setError("");
    const fields = buildFields();
    if (!fields) {
      setLoading(false);
      return;
    }
    try {
      const created = await api<{ id: string }>("/requests", {
        method: "POST",
        body: JSON.stringify({ channel, fields, notifyOnly }),
      });
      router.push(`/requests/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  function goLoginForWatch() {
    const returnUrl = encodeURIComponent("/requests/new");
    router.push(`/login?returnUrl=${returnUrl}`);
  }

  return (

    <div className={channel === "show" ? "show-chrome" : channel === "train" ? "train-chrome" : ""}>
      {channel === "train" && (
        <FlowStepper steps={TRAIN_FLOW_STEPS} current="query" variant="train" />
      )}
      {channel === "show" && (
        <FlowStepper steps={SHOW_FLOW_STEPS} current="search" variant="show" />
      )}
      <div className={channel === "show" ? "booking-panel show-skin" : "booking-panel"}>
        <div className="booking-panel-hd">
          {channel === "show" ? "演出票" : channel === "flight" ? "机票预订" : "车票预订"}
        </div>
        <div className="booking-panel-bd">
        <div className="channel-tabs" role="tablist">
          {(
            [
              ["train", "火车"],
              ["show", "演出"],
              ["flight", "机票"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={channel === id}
              className={channel === id ? "active" : ""}
              onClick={() => switchChannel(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="tpl-section">
          <div className="tpl-label">默认模板</div>
          <div className="tpl-row" role="list">
            {channelTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                role="listitem"
                className={activeTemplate === t.id ? "tpl-card active" : "tpl-card"}
                onClick={() => applyTemplate(t)}
              >
                <span className="tpl-title">{t.title}</span>
                {t.description && <span className="tpl-desc">{t.description}</span>}
              </button>
            ))}
            {REQUEST_TEMPLATES.filter((t) => t.channel !== channel).length > 0 && (
              <div className="tpl-other">
                {REQUEST_TEMPLATES.filter((t) => t.channel !== channel).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="tpl-chip"
                    onClick={() => applyTemplate(t)}
                    title={t.description}
                  >
                    {t.channel === "train" ? "火车" : t.channel === "show" ? "演出" : "机票"}
                    · {t.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <form className="stack" onSubmit={onSubmit}>
          {channel === "train" && (
            <>
              <p className="show-hint">
                先选<strong>城市</strong>，再选该城全部车站（来自 12306 station_name.js 完整索引
                {stationsSource ? ` · 当前源 ${stationsSource}` : ""}）。例如深圳 → 深圳 / 深圳北 / 深圳东 / 深圳西 / 福田…
              </p>
              <div className="muted" style={{ fontWeight: 600, marginBottom: 4 }}>热门出发城市</div>
              <div className="show-hot-cities" role="group" aria-label="热门出发城市">
                {HOT_TRAIN_CITIES.map((c) => (
                  <button
                    key={`from-${c}`}
                    type="button"
                    className={form.fromCity === c ? "show-hot-chip active" : "show-hot-chip"}
                    onClick={() => setFromCity(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="row">
                <SearchableSelect
                  label="出发城市"
                  name="fromCity"
                  required
                  placeholder="先选城市，如 深圳"
                  value={form.fromCity}
                  onChange={setFromCity}
                  options={TRAIN_CITIES}
                  remoteSearch={searchCities}
                />
                <SearchableSelect
                  label="出发车站"
                  name="from"
                  required
                  placeholder={form.fromCity ? `${form.fromCity}全部车站` : "请先选出发城市"}
                  value={form.from}
                  onChange={(v) => setField("from", v)}
                  options={fromStationOpts.length ? fromStationOpts : TRAIN_STATIONS}
                  remoteSearch={form.fromCity ? undefined : searchStations}
                  showCategoryChips={false}
                />
              </div>
              <div className="city-swap-row">
                <button type="button" className="secondary city-swap-btn" onClick={swapCities} disabled={!form.fromCity && !form.toCity}>
                  ⇅ 互换城市 / 车站
                </button>
                {fromStationsLoading || toStationsLoading ? (
                  <span className="muted">车站加载中…</span>
                ) : null}
                {stationsError ? (
                  <span className="error" style={{ fontSize: "0.85rem" }}>车站索引：{stationsError}</span>
                ) : null}
              </div>
              {!form.fromCity && !form.toCity && (
                <p className="muted empty-city-hint">请先选择出发/到达城市，再加载该城全部车站。</p>
              )}
              <div className="muted" style={{ fontWeight: 600, marginBottom: 4 }}>热门到达城市</div>
              <div className="show-hot-cities" role="group" aria-label="热门到达城市">
                {HOT_TRAIN_CITIES.map((c) => (
                  <button
                    key={`to-${c}`}
                    type="button"
                    className={form.toCity === c ? "show-hot-chip active" : "show-hot-chip"}
                    onClick={() => setToCity(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="row">
                <SearchableSelect
                  label="到达城市"
                  name="toCity"
                  required
                  placeholder="先选城市，如 汕尾"
                  value={form.toCity}
                  onChange={setToCity}
                  options={TRAIN_CITIES}
                  remoteSearch={searchCities}
                />
                <SearchableSelect
                  label="到达车站"
                  name="to"
                  required
                  placeholder={form.toCity ? `${form.toCity}全部车站` : "请先选到达城市"}
                  value={form.to}
                  onChange={(v) => setField("to", v)}
                  options={toStationOpts.length ? toStationOpts : TRAIN_STATIONS}
                  remoteSearch={form.toCity ? undefined : searchStations}
                  showCategoryChips={false}
                />
              </div>
              {(fromStationOpts.length > 0 || toStationOpts.length > 0 || fromStationsLoading || toStationsLoading) && (
                <p className="muted" style={{ margin: 0 }}>
                  {fromStationsLoading
                    ? `出发 ${form.fromCity}：加载中…`
                    : form.fromCity && fromStationOpts.length > 0
                      ? `出发 ${form.fromCity}：${fromStationOpts.length} 个车站（完整列表）`
                      : form.fromCity
                        ? `出发 ${form.fromCity}：暂无车站（请检查城市名）`
                        : null}
                  {form.fromCity && form.toCity ? " · " : null}
                  {toStationsLoading
                    ? `到达 ${form.toCity}：加载中…`
                    : form.toCity && toStationOpts.length > 0
                      ? `到达 ${form.toCity}：${toStationOpts.length} 个车站（完整列表）`
                      : form.toCity
                        ? `到达 ${form.toCity}：暂无车站（请检查城市名）`
                        : null}
                </p>
              )}
              <div className="row">
                <div>
                  <label htmlFor="train-date">出发日 <span className="req-star">*</span></label>
                  <input
                    id="train-date"
                    name="date"
                    type="date"
                    min={minDate}
                    required
                    value={form.date}
                    onChange={(e) => setField("date", e.target.value)}
                  />
                  <DateStrip value={form.date} onChange={(iso) => setField("date", iso)} minDate={minDate} days={15} />
                  <div className="date-chips" role="group" aria-label="日期快捷">
                    <button type="button" className={form.date === minDate ? "date-chip active" : "date-chip"} onClick={() => setDateChip(minDate)}>今天</button>
                    <button type="button" className={form.date === plusDaysISO(1) ? "date-chip active" : "date-chip"} onClick={() => setDateChip(plusDaysISO(1))}>明天</button>
                    <button type="button" className={form.date === nextSaturdayISO() ? "date-chip active" : "date-chip"} onClick={() => setDateChip(nextSaturdayISO())}>周末</button>
                    <button type="button" className={form.date === plusDaysISO(3) ? "date-chip active" : "date-chip"} onClick={() => setDateChip(plusDaysISO(3))}>+3天</button>
                    <button type="button" className={form.date === plusDaysISO(7) ? "date-chip active" : "date-chip"} onClick={() => setDateChip(plusDaysISO(7))}>+7天</button>
                  </div>
                  <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                    日期条对齐 12306；查询结果页标注「实时」余票来源。
                  </p>
                </div>
                <SearchableSelect
                  label="席别"
                  name="seatClass"
                  placeholder="二等座（可选）"
                  value={form.seatClass}
                  onChange={(v) => setField("seatClass", v)}
                  options={SEAT_CLASSES}
                  showCategoryChips={false}
                />
              </div>
              <div>
                <label htmlFor="train-passengers">人数</label>
                <input
                  id="train-passengers"
                  name="passengers"
                  type="number"
                  min={1}
                  value={form.passengers}
                  onChange={(e) => setField("passengers", e.target.value)}
                />
              </div>
            </>
          )}

          {channel === "show" && (
            <>
              <p className="show-hint">
                城市 → 场馆/关键词 → 场次。场馆列表来自点评/格瓦拉公开检索
                {venuesLive ? "（实时）" : venuesSparse ? "（稀疏·已合并常用场馆）" : ""}。布局为大麦风格参考（无官方商标）。不做验证码/队列绕过；下单为大麦/猫眼站内协助登录手递。
              </p>
              <div className="show-search-home">
                <div className="muted" style={{ fontWeight: 600, marginBottom: 4 }}>热门城市</div>
                <div className="show-hot-cities" role="group" aria-label="热门城市">
                  {HOT_SHOW_CITIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={form.city === c ? "show-hot-chip active" : "show-hot-chip"}
                      onClick={() => setShowCity(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="muted" style={{ fontWeight: 600, marginBottom: 4 }}>分类</div>
                <div className="show-category-chips" role="group" aria-label="演出分类">
                  {SHOW_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={showCategory === c ? "show-cat-chip active" : "show-cat-chip"}
                      onClick={() => setShowCategory((prev) => (prev === c ? "" : c))}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="row">
                <SearchableSelect
                  label="城市"
                  name="city"
                  required
                  placeholder="上海 / 北京 …"
                  value={form.city}
                  onChange={setShowCity}
                  options={SHOW_CITIES}
                />
                <SearchableSelect
                  label="场馆"
                  name="venue"
                  placeholder={
                    !form.city
                      ? "请先选城市"
                      : venuesLoading
                        ? "场馆加载中…"
                        : `${form.city}场馆${venuesLive ? "（实时）" : ""}`
                  }
                  value={form.venue}
                  onChange={(v) => setField("venue", v)}
                  options={venueOpts}
                  showCategoryChips={false}
                />
              </div>
              {!form.city && (
                <p className="muted empty-city-hint">请先选择城市以加载该城场馆列表。</p>
              )}
              {form.city && (
                <p className="muted" style={{ margin: 0 }}>
                  {venuesLoading
                    ? "场馆加载中…"
                    : `场馆 ${venueCount || venueOpts.length} 个${venuesLive ? " · 实时" : ""}${venuesSparse ? " · 已级联关键词并合并常用场馆" : ""}`}
                  {venuesError ? ` · ${venuesError}` : ""}
                </p>
              )}
              <div>
                <label htmlFor="show-event">搜索 <span className="req-star">*</span></label>
                <input
                  id="show-event"
                  name="eventName"
                  required
                  placeholder="搜索明星、演出；可与场馆组合"
                  value={form.eventName}
                  onChange={(e) => setField("eventName", e.target.value)}
                />
              </div>
              <div className="row">
                <div>
                  <label htmlFor="show-date">日期（可选）</label>
                  <input
                    id="show-date"
                    name="date"
                    type="date"
                    min={minDate}
                    value={form.date}
                    onChange={(e) => setField("date", e.target.value)}
                  />
                  <div className="date-chips" role="group" aria-label="日期快捷">
                    <button type="button" className={form.date === minDate ? "date-chip active" : "date-chip"} onClick={() => setDateChip(minDate)}>今天</button>
                    <button type="button" className={form.date === plusDaysISO(1) ? "date-chip active" : "date-chip"} onClick={() => setDateChip(plusDaysISO(1))}>明天</button>
                    <button type="button" className={form.date === nextSaturdayISO() ? "date-chip active" : "date-chip"} onClick={() => setDateChip(nextSaturdayISO())}>周末</button>
                    <button type="button" className={form.date === plusDaysISO(7) ? "date-chip active" : "date-chip"} onClick={() => setDateChip(plusDaysISO(7))}>+7天</button>
                    <button type="button" className={!form.date ? "date-chip active" : "date-chip"} onClick={() => setField("date", "")}>不限</button>
                  </div>
                </div>
                <div>
                  <label htmlFor="show-qty">数量</label>
                  <input
                    id="show-qty"
                    name="quantity"
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={(e) => setField("quantity", e.target.value)}
                  />
                </div>
              </div>
              <details>
                <summary className="muted" style={{ cursor: "pointer" }}>高级：演出 ID / 详情链接</summary>
                <div className="stack" style={{ marginTop: "0.75rem" }}>
                  <div className="row">
                    <div>
                      <label htmlFor="show-pid">演出 ID（可选）</label>
                      <input
                        id="show-pid"
                        name="performanceId"
                        placeholder="如 498506"
                        value={form.performanceId}
                        onChange={(e) => setField("performanceId", e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="show-url">详情链接（可选）</label>
                      <input
                        id="show-url"
                        name="detailUrl"
                        placeholder="https://www.gewara.com/detail/…"
                        value={form.detailUrl}
                        onChange={(e) => setField("detailUrl", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </details>
            </>
          )}

          {channel === "flight" && (
            <>
              <FlowStepper steps={FLIGHT_FLOW_STEPS} current="query" variant="flight" />
              <p className="show-hint">
                航班实时依赖 Amadeus / Aviationstack 等公开 API；未配置时不会展示虚假可售票价。支付在航司/OTA 官方完成。
              </p>
              <div className="row">
                <SearchableSelect
                  label="出发"
                  name="from"
                  required
                  placeholder="SZX / 筛选或手输 IATA"
                  value={form.from}
                  onChange={(v) => setField("from", v)}
                  options={FLIGHT_AIRPORTS}
                />
                <SearchableSelect
                  label="到达"
                  name="to"
                  required
                  placeholder="PVG / 筛选或手输 IATA"
                  value={form.to}
                  onChange={(v) => setField("to", v)}
                  options={FLIGHT_AIRPORTS}
                />
              </div>
              <div className="row">
                <div>
                  <label htmlFor="flight-date">日期 <span className="req-star">*</span></label>
                  <input
                    id="flight-date"
                    name="date"
                    type="date"
                    min={minDate}
                    required
                    value={form.date}
                    onChange={(e) => setField("date", e.target.value)}
                  />
                  <div className="date-chips" role="group" aria-label="日期快捷">
                    <button type="button" className={form.date === minDate ? "date-chip active" : "date-chip"} onClick={() => setDateChip(minDate)}>今天</button>
                    <button type="button" className={form.date === plusDaysISO(1) ? "date-chip active" : "date-chip"} onClick={() => setDateChip(plusDaysISO(1))}>明天</button>
                    <button type="button" className={form.date === nextSaturdayISO() ? "date-chip active" : "date-chip"} onClick={() => setDateChip(nextSaturdayISO())}>周末</button>
                    <button type="button" className={form.date === plusDaysISO(3) ? "date-chip active" : "date-chip"} onClick={() => setDateChip(plusDaysISO(3))}>+3天</button>
                    <button type="button" className={form.date === plusDaysISO(7) ? "date-chip active" : "date-chip"} onClick={() => setDateChip(plusDaysISO(7))}>+7天</button>
                  </div>
                </div>
                <SearchableSelect
                  label="舱位"
                  name="cabin"
                  placeholder="经济舱（可选）"
                  value={form.cabin}
                  onChange={(v) => setField("cabin", v)}
                  options={FLIGHT_CABINS}
                  showCategoryChips={false}
                />
              </div>
              <div>
                <label htmlFor="flight-passengers">人数</label>
                <input
                  id="flight-passengers"
                  name="passengers"
                  type="number"
                  min={1}
                  value={form.passengers}
                  onChange={(e) => setField("passengers", e.target.value)}
                />
              </div>
            </>
          )}

          <div className="mode-toggle" role="radiogroup" aria-label="下单模式">
            <label className={notifyOnly ? "active" : ""}>
              <input
                type="radio"
                name="orderMode"
                checked={notifyOnly}
                onChange={() => setNotifyOnly(true)}
              />
              仅通知（有票时提醒，不下单）
            </label>
            <label className={!notifyOnly ? "active" : ""}>
              <input
                type="radio"
                name="orderMode"
                checked={!notifyOnly}
                onChange={() => setNotifyOnly(false)}
              />
              系统内下单协助（打开官方登录，不破解；支付跳转官方）
            </label>
          </div>

          {error && <p className="error">{error}</p>}
          <div className="btn-row">
            <button type="submit" className="btn-query" disabled={loading}>
              {loading ? "查询中…" : channel === "show" ? "搜演出" : "查询"}
            </button>
            <button type="button" className="secondary" onClick={() => router.back()}>
              取消
            </button>
          </div>
          <p className="meta" style={{ marginTop: "0.5rem" }}>
            查询对游客开放，结果留在本页；盯票 / 下单需登录。支付始终跳转官方。
          </p>
        </form>
        </div>
      </div>

      {publicMeta && (
        <div className="card stack" style={{ marginTop: "1.25rem" }}>
          <h2 className="section-title">
            查询结果
            <span className={`badge ${publicMeta.liveOk ? "available" : "limited"}`} style={{ marginLeft: 8 }}>
              {publicMeta.liveOk ? "实时" : "非实时/回退"}
            </span>
          </h2>
          <p className="meta">
            {publicMeta.queriedAt ? `查询时间 ${publicMeta.queriedAt}` : ""}
            {publicMeta.provider ? ` · ${publicMeta.provider}` : ""}
            {publicMeta.mode ? ` · mode=${publicMeta.mode}` : ""}
            {` · ${publicItems.length} 条`}
          </p>
          {publicMeta.notes && <p className="info-banner">{publicMeta.notes}</p>}
          {!publicMeta.liveOk && (
            <p className="info-banner live-fail-banner" role="status">
              当前非实时库存（fixture 或上游回退）。PROVIDER_MODE=live 也不等于已获官方代售授权。
            </p>
          )}

          {channel === "train" && publicItems.length > 0 && (
            <TrainResultsTable
              items={publicItems}
              onOrder={() => goLoginForWatch()}
              orderLabel={loggedIn ? "登录后下单" : "登录后盯票/下单"}
            />
          )}
          {channel === "show" && publicItems.length > 0 && (
            <ShowResultsList
              items={publicItems}
              onOrder={() => goLoginForWatch()}
              orderLabel={loggedIn ? "登录后下单" : "登录后盯票/下单"}
            />
          )}
          {channel === "flight" && publicItems.length > 0 && (
            <div className="stack">
              {publicItems.map((item) => (
                <div className="item" key={item.id}>
                  <div className="item-row">
                    <div>
                      <div className="item-title">{item.title}</div>
                      {item.subtitle && <div className="muted">{item.subtitle}</div>}
                      {item.price != null && (
                        <div className="price">
                          {item.currency ?? "CNY"} {item.price}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => goLoginForWatch()}>
                      {loggedIn ? "登录后下单" : "登录后盯票/下单"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {publicItems.length === 0 && (
            <p className="empty-desc">没有可展示的条目。</p>
          )}

          <div className="btn-row" style={{ marginTop: "1rem" }}>
            {loggedIn ? (
              <button type="button" className="btn-query" disabled={loading} onClick={() => createWatchRequest()}>
                创建需求并盯票
              </button>
            ) : (
              <button type="button" className="btn-query" onClick={() => goLoginForWatch()}>
                登录后盯票/下单
              </button>
            )}
            {!loggedIn && (
              <a href="/register">
                <button type="button" className="secondary">
                  注册账号
                </button>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
