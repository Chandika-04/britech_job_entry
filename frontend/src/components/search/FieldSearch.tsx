import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { FieldSpec } from "@/lib/useFieldQuery";
import { cn } from "@/lib/utils";

export function FieldSearch({
  fields,
  values,
  onChange,
  onClearAll,
}: {
  fields: FieldSpec[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClearAll: () => void;
}) {
  const anyFilled = fields.some((field) => (values[field.key] ?? "").trim());
  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end" data-list-search>
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-end">
        {fields.map((field) => {
          const value = values[field.key] ?? "";
          return (
            <div key={field.key} className={cn("relative", field.wide ? "w-full md:w-[180px]" : "w-full md:w-[150px]")}>
              <Input
                className="pr-7"
                placeholder={field.placeholder}
                value={value}
                aria-label={field.placeholder}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
              {value ? (
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-ink"
                  aria-label={`Clear ${field.placeholder}`}
                  onClick={() => onChange(field.key, "")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {anyFilled ? (
        <button type="button" className="self-end text-xs font-semibold text-accent hover:underline" onClick={onClearAll}>
          Clear all
        </button>
      ) : null}
    </div>
  );
}
