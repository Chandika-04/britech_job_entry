import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { applyTheme, readStoredThemeHex, THEME_PRESETS } from "@/lib/theme";

export function SettingsPage() {
  const [selected, setSelected] = useState(() => readStoredThemeHex().toLowerCase());
  const selectedIndex = Math.max(
    0,
    THEME_PRESETS.findIndex((preset) => preset.hex.toLowerCase() === selected),
  );

  const choose = (hex: string) => {
    applyTheme(hex);
    setSelected(hex.toLowerCase());
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-[13px] text-muted">This browser keeps these choices on this computer.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Color theme</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[13px] text-muted">
            Sets the color of the app header, buttons and section headers. Section headers use a softer shade, and text
            switches between black and white for whichever is easier to read.
          </p>
          <div
            role="radiogroup"
            aria-label="Color theme"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            onKeyDown={(event) => {
              if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
              event.preventDefault();
              const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
              const nextIndex = (selectedIndex + delta + THEME_PRESETS.length) % THEME_PRESETS.length;
              choose(THEME_PRESETS[nextIndex].hex);
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
            }}
          >
            {THEME_PRESETS.map((preset) => {
              const checked = THEME_PRESETS[selectedIndex].hex.toLowerCase() === preset.hex.toLowerCase();
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  className={cn(
                    "flex min-h-11 flex-col items-center gap-2 rounded-lg border p-3 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                    checked ? "border-accent ring-2 ring-accent/40" : "border-rule hover:border-accent/50",
                  )}
                  onClick={() => choose(preset.hex)}
                >
                  <span className="h-12 w-full rounded-md border border-black/10" style={{ background: preset.hex }} aria-hidden />
                  <span className="text-sm font-semibold">{preset.name}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-3 rounded-lg border border-rule p-4">
            <p className="field-label">Preview</p>
            <div className="card-header rounded-md px-4 py-2.5">
              <p className="text-[13px] font-semibold uppercase tracking-[0.06em]">Section header</p>
            </div>
            <div className="overflow-hidden rounded-md border border-rule">
              <div className="bg-card-header px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-card-header-ink">
                Ln · Part · Qty
              </div>
              <div className="bg-accent-soft px-3 py-2 text-sm">Selected row</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button">Primary</Button>
              <Button type="button" variant="outline">
                Outline
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
