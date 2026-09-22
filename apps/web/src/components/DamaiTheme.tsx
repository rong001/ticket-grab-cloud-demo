"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const DAMAI_CLASS = "theme-damai";

/** Toggle body.theme-damai for Damai-inspired chrome (train 12306 skin stays default). */
export function useDamaiTheme(enabled: boolean) {
  useEffect(() => {
    const body = document.body;
    if (enabled) body.classList.add(DAMAI_CLASS);
    else body.classList.remove(DAMAI_CLASS);
    return () => {
      body.classList.remove(DAMAI_CLASS);
    };
  }, [enabled]);
}

/**
 * Path-heuristic theme for pages that do not know channel yet.
 * Show-specific pages still call useDamaiTheme(true) explicitly.
 */
export function DamaiThemeFromPath() {
  const pathname = usePathname() ?? "";
  // Only force-on for dedicated show entry; request detail/checkout set via page hook.
  const pathHint =
    pathname.includes("/requests/new") === false &&
    (pathname.includes("show") || pathname.includes("演出"));
  useDamaiTheme(Boolean(pathHint));
  return null;
}

/** Updates sticky header brand subtitle when Damai theme is active. */
export function DamaiBrandSync() {
  useEffect(() => {
    const brandSub = document.querySelector(".brand-sub");
    const brand = document.querySelector(".brand");
    if (!brandSub || !brand) return;

    const defaultSub = brandSub.textContent;
    const apply = () => {
      const on = document.body.classList.contains(DAMAI_CLASS);
      brandSub.textContent = on ? "演出票" : defaultSub || "高铁票查询";
      brand.setAttribute("data-theme", on ? "damai" : "rail");
    };

    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => {
      obs.disconnect();
      if (defaultSub != null) brandSub.textContent = defaultSub;
    };
  }, []);
  return null;
}
