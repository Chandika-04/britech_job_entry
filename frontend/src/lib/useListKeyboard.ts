import { useCallback, useEffect, useRef, useState } from "react";

function isTypingTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset"].includes(target.type);
  }
  return false;
}

function dialogOpen(): boolean {
  // Print boxes, Prepared-by box, etc. are full-screen overlays.
  return Boolean(document.querySelector("div.fixed.inset-0"));
}

/**
 * Keyboard control for a list page: Up/Down moves a highlighted row, Enter opens it.
 *
 * - Down from the page's search boxes (marked data-list-search) jumps into the list; Up from
 *   the first row goes back to the first search box.
 * - Keys are ignored while typing in other fields or while a dialog is open.
 * - Hovering a row also highlights it, so Enter and the part preview follow the mouse too.
 * `resetKey` clears the highlight when the list is replaced (new search or page).
 */
export function useListKeyboard(count: number, onOpen: (index: number) => void, resetKey = "") {
  const [active, setActive] = useState(-1);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => setActive(-1), [resetKey]);
  useEffect(() => {
    setActive((current) => (current >= count ? count - 1 : current));
  }, [count]);

  useEffect(() => {
    if (active < 0) return;
    // One keyboard list per page, so the row can be found on the whole page.
    document.querySelector<HTMLElement>(`[data-list-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
      if (count === 0 || dialogOpen()) return;
      const target = event.target;
      if (isTypingTarget(target)) {
        if (event.key === "ArrowDown" && target.closest("[data-list-search]")) {
          event.preventDefault();
          target.blur();
          setActive(0);
        }
        return;
      }
      // A focused link or button keeps its own Enter.
      if (event.key === "Enter" && target instanceof HTMLElement && target.closest("a, button")) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((current) => Math.min(count - 1, current + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((current) => {
          if (current <= 0) {
            document.querySelector<HTMLInputElement>("[data-list-search] input")?.focus();
            return -1;
          }
          return current - 1;
        });
      } else if (active >= 0) {
        event.preventDefault();
        openRef.current(active);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, active]);

  /** Spread on each <tr>; add `rowClass(index)` to its className for the highlight. */
  const rowProps = useCallback(
    (index: number) => ({
      "data-list-row": index,
      onMouseEnter: () => setActive(index),
    }),
    [],
  );
  const rowClass = (index: number) => (index === active ? "is-active" : undefined);

  return { active, setActive, rowProps, rowClass };
}
