import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function parseMoney(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).replace(/[$,\s]/g, "").trim();
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(2);
}

export function formatQty(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const amount = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return text;
  return String(amount);
}

export function formatDueDisplay(value: string | null | undefined): string {
  const iso = (value || "").trim();
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[2]}/${match[3]}/${match[1].slice(2)}`;
}

export function parseDueInput(value: string): string | null {
  const text = value.trim();
  if (!text) return "";
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const usLong = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  const usShort = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(text);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (usLong) {
    month = Number(usLong[1]);
    day = Number(usLong[2]);
    year = Number(usLong[3]);
  } else if (usShort) {
    month = Number(usShort[1]);
    day = Number(usShort[2]);
    year = 2000 + Number(usShort[3]);
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatUsd(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const parsed = parseMoney(text);
  if (parsed == null) return text;
  return USD.format(Number(parsed));
}

function isFocusField(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && !el.disabled
  );
}

function isVisibleField(el: HTMLElement): boolean {
  return el.offsetParent !== null;
}

function fieldsFor(id: string): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> {
  const tagged = [...document.querySelectorAll(`[data-focus="${id}"]`)];
  const byId = document.getElementById(id);
  if (byId) tagged.push(byId);
  const visible = tagged.filter((el) => el instanceof HTMLElement && isVisibleField(el));
  return (visible.length ? visible : tagged).filter(isFocusField);
}

export function focusNextEmpty(ids: string[]): void {
  const run = () => {
    const nodes = ids.flatMap(fieldsFor);
    const empty = nodes.find((el) => !String(el.value).trim());
    const target = empty ?? nodes[0];
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement && target.type !== "checkbox" && target.type !== "radio") target.select();
  };
  window.requestAnimationFrame(run);
}

function skipEnterField(el: HTMLInputElement | HTMLSelectElement): boolean {
  if (el instanceof HTMLSelectElement) return false;
  return ["hidden", "checkbox", "radio", "button", "submit", "reset", "file"].includes(el.type);
}

function enterFields(root: ParentNode): Array<HTMLInputElement | HTMLSelectElement> {
  return [...root.querySelectorAll("input, select")].filter((el): el is HTMLInputElement | HTMLSelectElement => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement) || el.disabled) return false;
    if (skipEnterField(el)) return false;
    if (el.getAttribute("data-enter-skip") != null) return false;
    if (!isVisibleField(el)) return false;
    return true;
  });
}

export function focusNextField(from: HTMLElement): void {
  const root = from.closest("[data-enter-form]") ?? document.body;
  const fields = enterFields(root);
  const index = fields.indexOf(from as HTMLInputElement | HTMLSelectElement);
  const next = index >= 0 ? fields[index + 1] : undefined;
  if (!next) return;
  window.requestAnimationFrame(() => {
    next.focus();
    if (next instanceof HTMLInputElement && next.type !== "date" && next.type !== "checkbox" && next.type !== "radio") {
      next.select();
    }
  });
}

function commitMoneyInput(el: HTMLInputElement): void {
  const formatted = formatUsd(el.value);
  if (formatted === el.value) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, formatted);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function handleEnterAdvance(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.defaultPrevented) return;
  const el = event.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
  if (skipEnterField(el)) return;
  event.preventDefault();
  if (el instanceof HTMLInputElement && el.dataset.money === "usd") commitMoneyInput(el);
  focusNextField(el);
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
