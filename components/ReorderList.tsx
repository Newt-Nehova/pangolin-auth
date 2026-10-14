"use client";

/**
 * Drag to reorder. Drag by the grip; the row follows the finger and swaps
 * with a neighbour once it passes the neighbour's midpoint.
 *
 * - Pinned accounts always sit on top, so a row only moves within its own
 *   section (pinned or not) -- dragging across would just snap back.
 * - The grip is also a keyboard control: arrow keys move the row.
 * - Pointer moves are followed on window, not via pointer capture, so a
 *   finger sliding off the grip keeps dragging.
 * - Nothing is saved until Done, which saves once.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { displayName } from "@/lib/entries";
import type { Entry } from "@/lib/types";
import { Icon } from "./ui";

const GAP = 8;

export function ReorderList({ entries, onChange }: { entries: Entry[]; onChange: (ids: string[]) => void }) {
  const [order, setOrder] = useState(() => entries.map((e) => e.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const byId = new Map(entries.map((e) => [e.id, e]));

  function commit(next: string[]) {
    setOrder(next);
    onChange(next);
  }

  /** Moves `id` one place up/down if the neighbour is in the same section. Returns the neighbour's height, or 0. */
  function step(list: string[], id: string, delta: -1 | 1): { list: string[]; height: number } {
    const i = list.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= list.length) return { list, height: 0 };
    if (!!byId.get(list[j])?.pinned !== !!byId.get(id)?.pinned) return { list, height: 0 };
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    const height = (rows.current.get(list[j])?.getBoundingClientRect().height ?? 0) + GAP;
    return { list: next, height };
  }

  function start(e: ReactPointerEvent, id: string) {
    e.preventDefault();
    let origin = e.clientY;
    let current = order;
    setDragging(id);
    setOffset(0);

    const move = (ev: PointerEvent) => {
      let dy = ev.clientY - origin;
      // Swap past each neighbour whose midpoint we've crossed (fast drags can cross several).
      for (;;) {
        const dir = dy > 0 ? 1 : -1;
        const i = current.indexOf(id);
        const neighbour = current[i + dir];
        const h = neighbour ? (rows.current.get(neighbour)?.getBoundingClientRect().height ?? 0) : 0;
        if (!neighbour || Math.abs(dy) < h / 2 + GAP / 2) break;
        const swapped = step(current, id, dir as -1 | 1);
        if (!swapped.height) break;
        current = swapped.list;
        origin += dir * swapped.height;
        dy = ev.clientY - origin;
      }
      setOrder(current);
      setOffset(dy);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setDragging(null);
      setOffset(0);
      commit(current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function key(e: KeyboardEvent, id: string) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const { list, height } = step(order, id, e.key === "ArrowUp" ? -1 : 1);
    if (height) commit(list);
  }

  return (
    <ul className="space-y-2" aria-label="Accounts, in order">
      {order.map((id, index) => {
        const entry = byId.get(id);
        if (!entry) return null;
        const active = dragging === id;
        return (
          <li
            key={id}
            ref={(el) => {
              if (el) rows.current.set(id, el);
              else rows.current.delete(id);
            }}
            className={`flex min-h-14 items-center gap-3 rounded-2xl border bg-surface py-1 pl-4 pr-1 ${
              active ? "relative z-10 border-accent shadow-lg" : "border-line shadow-sm transition-transform"
            }`}
            style={active ? { transform: `translateY(${offset}px) scale(1.02)` } : undefined}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold">{displayName(entry)}</span>
                {entry.pinned && <Icon name="star" size={14} className="shrink-0 fill-accent text-accent" />}
              </div>
              {entry.issuer && entry.account && <div className="truncate text-sm text-muted">{entry.account}</div>}
            </div>
            <button
              type="button"
              onPointerDown={(e) => start(e, id)}
              onKeyDown={(e) => key(e, id)}
              className="inline-flex h-12 w-12 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl text-muted active:cursor-grabbing"
              aria-label={`Move ${displayName(entry)}, position ${index + 1} of ${order.length}. Drag, or use the arrow keys.`}
            >
              <Icon name="grip" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
