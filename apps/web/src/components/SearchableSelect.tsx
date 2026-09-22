"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { SelectOption } from "@/lib/options/catalog";
import { categoriesOf } from "@/lib/options/catalog";

type Props = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  required?: boolean;
  name?: string;
  /** Show category filter chips (All + each). Default true when >1 category. */
  showCategoryChips?: boolean;
  /** Optional remote search (debounced). Results merge ahead of local options. */
  remoteSearch?: (query: string) => Promise<SelectOption[]>;
  remoteDebounceMs?: number;
};

export default function SearchableSelect({
  id: idProp,
  label,
  value,
  onChange,
  options,
  placeholder,
  required,
  name,
  showCategoryChips,
  remoteSearch,
  remoteDebounceMs = 280,
}: Props) {
  const autoId = useId();
  const inputId = idProp ?? autoId;
  const listboxId = `${inputId}-listbox`;

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("all");
  const [highlight, setHighlight] = useState(0);
  const [remoteOptions, setRemoteOptions] = useState<SelectOption[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!remoteSearch) {
      setRemoteOptions([]);
      return;
    }
    const q = value.trim();
    if (q.length < 1) {
      setRemoteOptions([]);
      return;
    }
    let cancelled = false;
    setRemoteLoading(true);
    const timer = window.setTimeout(() => {
      remoteSearch(q)
        .then((rows) => {
          if (!cancelled) setRemoteOptions(rows);
        })
        .catch(() => {
          if (!cancelled) setRemoteOptions([]);
        })
        .finally(() => {
          if (!cancelled) setRemoteLoading(false);
        });
    }, remoteDebounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, remoteSearch, remoteDebounceMs]);

  const mergedOptions = useMemo(() => {
    if (!remoteOptions.length) return options;
    const seen = new Set(remoteOptions.map((o) => o.value));
    return [...remoteOptions, ...options.filter((o) => !seen.has(o.value))];
  }, [options, remoteOptions]);

  const cats = useMemo(() => categoriesOf(mergedOptions), [mergedOptions]);
  const enableChips = showCategoryChips ?? cats.length > 1;

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    return mergedOptions.filter((o) => {
      if (category !== "all" && o.category !== category) return false;
      if (!q) return true;
      return (
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q)
      );
    });
  }, [mergedOptions, value, category]);

  const grouped = useMemo(() => {
    const map = new Map<string, SelectOption[]>();
    for (const o of filtered) {
      const list = map.get(o.category) ?? [];
      list.push(o);
      map.set(o.category, list);
    }
    return map;
  }, [filtered]);

  const flatValues = useMemo(() => filtered.map((o) => o.value), [filtered]);

  useEffect(() => {
    setHighlight(0);
  }, [filtered]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
    },
    [onChange],
  );

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(flatValues.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter" && flatValues.length > 0) {
      e.preventDefault();
      const v = flatValues[highlight];
      if (v) pick(v);
    }
  }

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  let optionIndex = -1;

  return (
    <div className="ss-root" ref={rootRef}>
      <label htmlFor={inputId}>
        {label}
        {required ? <span className="req-star"> *</span> : null}
      </label>
      {enableChips && (
        <div className="ss-chips" role="group" aria-label="分类筛选">
          <button
            type="button"
            className={category === "all" ? "ss-chip active" : "ss-chip"}
            onClick={() => {
              setCategory("all");
              setOpen(true);
            }}
          >
            全部
          </button>
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              className={category === c ? "ss-chip active" : "ss-chip"}
              onClick={() => {
                setCategory(c);
                setOpen(true);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="ss-input-wrap">
        <input
          id={inputId}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && flatValues[highlight] ? `${inputId}-opt-${highlight}` : undefined
          }
          autoComplete="off"
          required={required}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul id={listboxId} className="ss-listbox" role="listbox" aria-label={label} ref={listRef}>
            {remoteLoading && (
              <li className="ss-empty" role="presentation">
                搜索站点中…
              </li>
            )}
            {!remoteLoading && filtered.length === 0 ? (
              <li className="ss-empty" role="presentation">
                无匹配选项，可直接使用自定义输入
              </li>
            ) : (
              Array.from(grouped.entries()).map(([cat, opts]) => (
                <li key={cat} role="presentation" className="ss-group">
                  {cats.length > 1 && <div className="ss-group-label">{cat}</div>}
                  <ul role="group" aria-label={cat} className="ss-group-list">
                    {opts.map((o) => {
                      optionIndex += 1;
                      const idx = optionIndex;
                      const selected = o.value === value;
                      return (
                        <li
                          key={`${o.category}-${o.value}`}
                          id={`${inputId}-opt-${idx}`}
                          role="option"
                          aria-selected={selected}
                          data-idx={idx}
                          className={
                            "ss-option" +
                            (idx === highlight ? " highlight" : "") +
                            (selected ? " selected" : "")
                          }
                          onMouseEnter={() => setHighlight(idx)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pick(o.value);
                          }}
                        >
                          <span className="ss-option-label">{o.label}</span>
                          {o.label !== o.value && (
                            <span className="ss-option-value">{o.value}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
