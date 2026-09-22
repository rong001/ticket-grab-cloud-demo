"use client";

import { useEffect, useMemo, useState } from "react";
import { formatShanghaiDateTime } from "@/lib/format";
import Link from "next/link";

export type TravelerOption = {
  id: string;
  name: string;
  idNumberHint?: string;
  relationship?: string;
  type?: string;
};

export type WatchJobRow = {
  id: string;
  status: string;
  intervalMinutes: number;
  endsAt?: string | null;
  startsAt?: string | null;
  autoOrder?: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  travelerIds?: string[];
  travelers?: TravelerOption[];
  preferences?: {
    preferredTrains?: string[];
    preferredSeats?: string[];
    preferredTiers?: string[];
    preferredSessions?: string[];
    notify?: boolean;
  } | null;
};

type Props = {
  channel: string;
  notifyOnly?: boolean;
  busy?: boolean;
  jobs: WatchJobRow[];
  intervalMinutes: number;
  onIntervalChange: (m: number) => void;
  startsAtLocal: string;
  onStartsAtChange: (v: string) => void;
  endsAtLocal: string;
  onEndsAtChange: (v: string) => void;
  autoOrder: boolean;
  onAutoOrderChange: (v: boolean) => void;
  /** Train prefs */
  preferredTrains?: string;
  onPreferredTrainsChange?: (v: string) => void;
  preferredSeats?: string;
  onPreferredSeatsChange?: (v: string) => void;
  /** Show prefs */
  preferredTiers?: string;
  onPreferredTiersChange?: (v: string) => void;
  watchHint?: string;
  /** Optional multi-select of saved travelers to bind on watch create */
  travelerOptions?: TravelerOption[];
  selectedTravelerIds?: string[];
  onToggleTraveler?: (id: string) => void;
  onStart: () => void;
  onSearch: () => void;
  onCancel?: (jobId: string) => void;
  /** Train + bound travelers: create draft order (no submit). */
  onCreateDraftOrder?: (jobId: string) => void;
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "即将执行";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}小时${String(m).padStart(2, "0")}分${String(sec).padStart(2, "0")}秒`;
  if (m > 0) return `${m}分${String(sec).padStart(2, "0")}秒`;
  return `${sec}秒`;
}

function useNow(tickMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(t);
  }, [tickMs]);
  return now;
}

export default function TimedGrabPanel(props: Props) {
  const isShow = props.channel === "show";
  const isTrain = props.channel === "train";
  const now = useNow();
  const activeJobs = useMemo(
    () => props.jobs.filter((j) => j.status === "active" || j.status === "pending"),
    [props.jobs]
  );
  const primary = activeJobs[0] ?? props.jobs[0];
  const nextMs = primary?.nextRunAt
    ? new Date(primary.nextRunAt).getTime() - now
    : primary?.startsAt
      ? new Date(primary.startsAt).getTime() - now
      : null;

  const title = isShow ? "定时抢票 / 开售自动抢" : "定时抢票";
  const tag = isShow ? "演出票" : isTrain ? "火车票" : "机票";

  return (
    <div className={`card timed-grab-card${isShow ? " damai-grab" : " train-grab"}`}>
      <div className="timed-grab-hd">
        <div>
          <h2 className="section-title" style={{ margin: 0, border: "none", padding: 0 }}>
            {title}
          </h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            监控余票 / 开售 → 通知您 → 可选协助建单（待登录）。验证码 / 短信 / 人脸 / 支付须本人在官方完成。
          </p>
        </div>
        <span className="timed-grab-tag">{tag}</span>
      </div>

      {props.watchHint && <p className="timed-grab-hint">{props.watchHint}</p>}

      <div className={`watch-panel${isShow ? " damai-watch" : ""}`}>
        <div>
          <label>{isShow ? "提醒 / 抢票间隔" : "抢票间隔"}</label>
          <div className="chip-row" role="group" aria-label="间隔">
            {[1, 5, 10, 15, 30].map((m) => (
              <button
                key={m}
                type="button"
                className={props.intervalMinutes === m ? "date-chip active" : "date-chip"}
                onClick={() => props.onIntervalChange(m)}
              >
                {m} 分钟
              </button>
            ))}
          </div>
        </div>

        <div className="btn-row" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 200 }}>
            <label htmlFor="grab-starts">
              {isShow ? "开售对齐 / 开始时间" : "开始时间（定时抢票）"}
            </label>
            <input
              id="grab-starts"
              type="datetime-local"
              value={props.startsAtLocal}
              onChange={(e) => props.onStartsAtChange(e.target.value)}
            />
          </div>
          <div style={{ minWidth: 200 }}>
            <label htmlFor="grab-ends">结束时间</label>
            <input
              id="grab-ends"
              type="datetime-local"
              value={props.endsAtLocal}
              onChange={(e) => props.onEndsAtChange(e.target.value)}
            />
          </div>
        </div>

        {isTrain && props.onPreferredTrainsChange && (
          <div className="row">
            <div>
              <label htmlFor="grab-trains">偏好车次（可选，逗号分隔）</label>
              <input
                id="grab-trains"
                placeholder="如 G102,D312"
                value={props.preferredTrains ?? ""}
                onChange={(e) => props.onPreferredTrainsChange?.(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="grab-seats">偏好席别（可选）</label>
              <input
                id="grab-seats"
                placeholder="如 二等座,一等座"
                value={props.preferredSeats ?? ""}
                onChange={(e) => props.onPreferredSeatsChange?.(e.target.value)}
              />
            </div>
          </div>
        )}

        {isShow && props.onPreferredTiersChange && (
          <div>
            <label htmlFor="grab-tiers">偏好票档（可选，逗号分隔）</label>
            <input
              id="grab-tiers"
              placeholder="如 看台680,内场980"
              value={props.preferredTiers ?? ""}
              onChange={(e) => props.onPreferredTiersChange?.(e.target.value)}
            />
          </div>
        )}

        {props.travelerOptions && props.onToggleTraveler && (
          <div>
            <label>绑定乘车人 / 观演人（可选，多选）</label>
            {!props.travelerOptions.length ? (
              <p className="muted" style={{ margin: "0.25rem 0" }}>
                暂无已保存人员 — <Link href="/travelers">去添加</Link>
              </p>
            ) : (
              <div className="chip-row" style={{ flexWrap: "wrap" }}>
                {props.travelerOptions.map((t) => {
                  const on = props.selectedTravelerIds?.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={on ? "date-chip active" : "date-chip"}
                      onClick={() => props.onToggleTraveler?.(t.id)}
                    >
                      {t.name}
                      {t.idNumberHint ? ` · ${t.idNumberHint}` : ""}
                      {t.relationship === "authorized" ? " · 代购" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <label className="check-row">
          <input
            type="checkbox"
            checked={props.autoOrder}
            onChange={(e) => props.onAutoOrderChange(e.target.checked)}
            disabled={props.notifyOnly !== false}
          />
          <span>
            {isShow
              ? "开售/有票时自动建单（仅创建待登录订单并通知；大麦/猫眼登录与支付须本人完成）"
              : "有票时自动建单（仅创建草稿/待登录订单并通知；12306 验证码/短信/人脸须本人完成）"}
            {props.notifyOnly !== false && (
              <span className="muted"> — 当前为「仅通知」，请新建需求并选「系统内下单」</span>
            )}
          </span>
        </label>
      </div>

      <div className="btn-row end" style={{ gap: "0.75rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
        <button type="button" onClick={props.onSearch} disabled={props.busy}>
          {isShow ? "刷新场次" : "立即查票"}
        </button>
        <button type="button" className="secondary timed-grab-start" onClick={props.onStart} disabled={props.busy}>
          {isShow ? "开启定时抢票 / 开售自动抢" : "开启定时抢票"}
        </button>
        <Link href="/grabs">
          <button type="button" className="ghost">
            我的定时抢票
          </button>
        </Link>
        {isTrain && (
          <Link href="/accounts?platform=12306">
            <button type="button" className="ghost">
              绑定 12306
            </button>
          </Link>
        )}
        {isShow && (
          <Link href="/accounts?platform=damai">
            <button type="button" className="ghost">
              绑定大麦/猫眼
            </button>
          </Link>
        )}
        <Link href="/travelers">
          <button type="button" className="ghost">
            {isShow ? "观演人" : "乘车人"}
          </button>
        </Link>
      </div>

      {primary && (primary.status === "active" || primary.status === "pending") && (
        <div className="timed-grab-countdown" aria-live="polite">
          <div>
            <span className={`badge ${primary.status === "active" ? "watching" : "info"}`}>
              {primary.status === "pending" ? "待开始" : "抢票中"}
            </span>{" "}
            每 {primary.intervalMinutes} 分钟
            {primary.autoOrder ? " · 自动建单 ON" : " · 仅通知"}
            {primary.endsAt ? ` · 至 ${formatShanghaiDateTime(primary.endsAt)}` : ""}
          </div>
          <div className="timed-grab-next">
            下次执行{" "}
            <strong>
              {nextMs == null
                ? "—"
                : nextMs > 0
                  ? formatCountdown(nextMs)
                  : "即将执行"}
            </strong>
            {primary.nextRunAt && (
              <span className="muted"> · {formatShanghaiDateTime(primary.nextRunAt)}</span>
            )}
          </div>
        </div>
      )}

      {props.jobs.length > 0 && (
        <div className="timed-grab-jobs">
          <h3 className="timed-grab-jobs-title">本需求的定时抢票任务</h3>
          <ul className="timed-grab-job-list">
            {props.jobs.map((j) => (
              <li key={j.id} className="timed-grab-job-row">
                <div>
                  <span className={`badge ${j.status === "active" ? "watching" : j.status === "cancelled" ? "sold_out" : "info"}`}>
                    {j.status}
                  </span>{" "}
                  每 {j.intervalMinutes} 分
                  {j.autoOrder ? " · 自动建单" : ""}
                  {j.preferences?.preferredTrains?.length
                    ? ` · 车次 ${j.preferences.preferredTrains.join(",")}`
                    : ""}
                  {j.preferences?.preferredSeats?.length
                    ? ` · 席别 ${j.preferences.preferredSeats.join(",")}`
                    : ""}
                  {j.preferences?.preferredTiers?.length
                    ? ` · 票档 ${j.preferences.preferredTiers.join(",")}`
                    : ""}
                  {j.travelers?.length
                    ? ` · 乘客 ${j.travelers.map((t) => t.name).join("、")}`
                    : j.travelerIds?.length
                      ? ` · ${j.travelerIds.length} 人`
                      : ""}
                  <div className="meta">
                    {j.startsAt ? `起 ${formatShanghaiDateTime(j.startsAt)} · ` : ""}
                    {j.nextRunAt ? `下次 ${formatShanghaiDateTime(j.nextRunAt)}` : ""}
                    {j.lastRunAt ? ` · 上次 ${formatShanghaiDateTime(j.lastRunAt)}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {isTrain && (j.travelerIds?.length ?? j.travelers?.length ?? 0) > 0 && props.onCreateDraftOrder && (
                    <button
                      type="button"
                      className="btn-query"
                      disabled={props.busy}
                      onClick={() => props.onCreateDraftOrder?.(j.id)}
                      title="用已选乘客创建草稿订单（不提交、不扣款）"
                    >
                      用已选乘客创建草稿订单
                    </button>
                  )}
                  {(j.status === "active" || j.status === "pending") && props.onCancel && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={props.busy}
                      onClick={() => props.onCancel?.(j.id)}
                    >
                      取消
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
