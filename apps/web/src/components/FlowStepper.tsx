"use client";

export type FlowStep = { id: string; label: string };

export const TRAIN_FLOW_STEPS: FlowStep[] = [
  { id: "query", label: "查询" },
  { id: "trains", label: "车次" },
  { id: "seat", label: "选座/席别" },
  { id: "passengers", label: "乘客" },
  { id: "confirm", label: "提交订单" },
  { id: "pay", label: "网上支付" },
];

export const SHOW_FLOW_STEPS: FlowStep[] = [
  { id: "search", label: "搜索" },
  { id: "session", label: "选场次" },
  { id: "tier", label: "选票档" },
  { id: "grab", label: "预约抢票/立即购买" },
  { id: "confirm", label: "确认" },
  { id: "pay", label: "支付" },
];

export const FLIGHT_FLOW_STEPS: FlowStep[] = [
  { id: "query", label: "查询" },
  { id: "flights", label: "航班" },
  { id: "cabin", label: "舱位" },
  { id: "passengers", label: "乘机人" },
  { id: "confirm", label: "提交" },
  { id: "pay", label: "支付" },
];

type Props = {
  steps: FlowStep[];
  /** Current step id; steps before it are "done" */
  current: string;
  variant?: "train" | "show" | "flight";
  className?: string;
};

export default function FlowStepper({ steps, current, variant = "train", className }: Props) {
  const idx = Math.max(0, steps.findIndex((s) => s.id === current));
  return (
    <nav
      className={`flow-stepper flow-stepper-${variant}${className ? ` ${className}` : ""}`}
      aria-label="购票流程"
    >
      <ol className="flow-stepper-list">
        {steps.map((s, i) => {
          const state = i < idx ? "done" : i === idx ? "current" : "todo";
          return (
            <li key={s.id} className={`flow-step flow-step-${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="flow-step-num">{i + 1}</span>
              <span className="flow-step-label">{s.label}</span>
              {i < steps.length - 1 && <span className="flow-step-arrow" aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function stepsForChannel(channel: string): FlowStep[] {
  if (channel === "show") return SHOW_FLOW_STEPS;
  if (channel === "flight") return FLIGHT_FLOW_STEPS;
  return TRAIN_FLOW_STEPS;
}
