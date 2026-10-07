"use client";

import * as React from "react";
import {
  Copy,
  GalleryHorizontal,
  GripVertical,
  Heading2,
  ImagePlus,
  LayoutPanelTop,
  MousePointerClick,
  MoveVertical,
  Plus,
  TextIcon,
  Trash2,
} from "lucide-react";

/** Where an element lands: inside a container, or before/after an element.
 * "canvas" (inside) means the top level of a free block / div. */
export type DropTarget = { element: string; where: "inside" | "before" | "after" };
/** What is being dragged: an existing element (move) or a new one (add). */
export type BuilderDrag = { move?: string; add?: string; section?: string };
/** Shared by the palette, the structure tree and the page overlay. */
export const dragState: { current: BuilderDrag | null } = { current: null };

export const INSERT_TYPES = [
  ["group", LayoutPanelTop, "Div (conteneur)", "Div (container)"],
  ["heading", Heading2, "Titre", "Heading"],
  ["text", TextIcon, "Texte", "Text"],
  ["image", ImagePlus, "Image", "Image"],
  ["button", MousePointerClick, "Bouton", "Button"],
  ["slider", GalleryHorizontal, "Carrousel", "Carousel"],
  ["spacer", MoveVertical, "Espace", "Spacer"],
] as const;

type Box = { top: number; left: number; width: number; height: number };
type PlusButton = { key: string; x: number; y: number; section: string; target: DropTarget; small: boolean; title: string };
type Hint = { section: string; target: DropTarget; box: Box; horizontal: boolean };
type Menu = { section: string; target: DropTarget; x: number; y: number };

export type ElementInfo = { label: string; movable: boolean; duplicable: boolean; deletable: boolean; container: boolean };

const isGroup = (node: Element | null) => node?.getAttribute("data-el-kind") === "group";

/**
 * Editing tools drawn over the live preview (inside its iframe): the selected
 * element's toolbar, "+" buttons in containers and between elements, and the
 * drop indicator while dragging. Only the builder renders it, so the
 * published site's markup never changes.
 */
export function BuilderCanvasOverlay({
  selectedId,
  selectedElement,
  fr,
  editable,
  describe,
  canDrop,
  onDrop,
  onInsert,
  onDuplicate,
  onDelete,
  onUndo,
  onRedo,
}: {
  selectedId: string | null;
  selectedElement: string | null;
  fr: boolean;
  /** Page blocks the overlay may change (global zones are edited in the panel). */
  editable: (section: string) => boolean;
  describe: (section: string, element: string) => ElementInfo | null;
  canDrop: (section: string, drag: BuilderDrag, target: DropTarget) => boolean;
  onDrop: (section: string, drag: BuilderDrag, target: DropTarget) => void;
  onInsert: (section: string, type: string, target: DropTarget) => void;
  onDuplicate: (section: string, element: string) => void;
  onDelete: (section: string, element: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = React.useState<{ section: string; element: string } | null>(null);
  const [menu, setMenu] = React.useState<Menu | null>(null);
  const [hint, setHint] = React.useState<Hint | null>(null);
  const [layout, setLayout] = React.useState<{ toolbar: (Box & { section: string; element: string }) | null; pluses: PlusButton[] }>({
    toolbar: null,
    pluses: [],
  });
  const [tick, setTick] = React.useState(0);
  const t = (french: string, english: string) => (fr ? french : english);

  // Latest callbacks, for native listeners registered once.
  const props = React.useRef({ editable, canDrop, onDrop, onUndo, onRedo });
  props.current = { editable, canDrop, onDrop, onUndo, onRedo };

  const doc = () => rootRef.current?.ownerDocument ?? null;
  const boxOf = (node: Element): Box => {
    const rect = node.getBoundingClientRect();
    const win = node.ownerDocument.defaultView;
    return { top: rect.top + (win?.scrollY ?? 0), left: rect.left + (win?.scrollX ?? 0), width: rect.width, height: rect.height };
  };
  const sectionNode = (section: string) =>
    doc()?.querySelector(`[data-builder-section="${CSS.escape(section)}"]`) ?? null;
  const elementNode = (section: string, element: string) =>
    sectionNode(section)?.querySelector(`[data-el="${CSS.escape(element)}"]`) ?? null;

  /** "+" buttons of one container: before each child, and at the end. */
  const plusesFor = (section: string, container: Element, out: PlusButton[], seen: Set<string>) => {
    const name = container.getAttribute("data-el");
    if (!name || seen.has(`${section}|${name}`)) return;
    seen.add(`${section}|${name}`);
    const box = boxOf(container);
    const children = Array.from(container.children).filter((child) => child.hasAttribute("data-el"));
    if (!children.length) {
      out.push({
        key: `${section}|${name}|empty`,
        x: box.left + box.width / 2,
        y: box.top + box.height / 2 + 16,
        section,
        target: { element: name, where: "inside" },
        small: false,
        title: t("Ajouter dans ce div", "Add inside this div"),
      });
      return;
    }
    children.forEach((child, index) => {
      const own = boxOf(child);
      const childName = child.getAttribute("data-el")!;
      let x: number;
      let y: number;
      if (index === 0) {
        x = own.left + own.width / 2;
        y = Math.max(box.top + 8, own.top - 9);
      } else {
        const previous = boxOf(children[index - 1]!);
        if (own.top >= previous.top + previous.height - 2) {
          x = own.left + own.width / 2;
          y = (previous.top + previous.height + own.top) / 2;
        } else {
          x = (previous.left + previous.width + own.left) / 2;
          y = own.top + own.height / 2;
        }
      }
      out.push({
        key: `${section}|${childName}|before`,
        x,
        y,
        section,
        target: { element: childName, where: "before" },
        small: true,
        title: t("Insérer ici", "Insert here"),
      });
    });
    out.push({
      key: `${section}|${name}|end`,
      x: box.left + box.width / 2,
      y: box.top + box.height - 13,
      section,
      target: { element: name, where: "inside" },
      small: false,
      title: t("Ajouter à la fin de ce div", "Add at the end of this div"),
    });
  };

  const computeLayout = () => {
    const document = doc();
    if (!document) return { toolbar: null, pluses: [] };
    let toolbar: (Box & { section: string; element: string }) | null = null;
    const pluses: PlusButton[] = [];
    const seen = new Set<string>();
    const active: Array<{ section: string; node: Element }> = [];
    if (selectedId && selectedElement && props.current.editable(selectedId)) {
      const node = elementNode(selectedId, selectedElement);
      if (node) {
        toolbar = { ...boxOf(node), section: selectedId, element: selectedElement };
        const container = isGroup(node) ? node : node.parentElement?.closest('[data-el-kind="group"]');
        if (container && sectionNode(selectedId)?.contains(container)) active.push({ section: selectedId, node: container });
        // A selected div also shows the "+" of its parent, to insert next to it.
        const parent = isGroup(node) ? node.parentElement?.closest('[data-el-kind="group"]') : null;
        if (parent && sectionNode(selectedId)?.contains(parent)) active.push({ section: selectedId, node: parent });
      }
    }
    if (hovered && props.current.editable(hovered.section)) {
      const node = elementNode(hovered.section, hovered.element);
      if (node) active.push({ section: hovered.section, node });
    }
    for (const { section, node } of active) plusesFor(section, node, pluses, seen);
    // Empty divs always offer their "+".
    document.querySelectorAll("[data-builder-section]").forEach((sectionElement) => {
      const section = sectionElement.getAttribute("data-builder-section")!;
      if (!props.current.editable(section)) return;
      sectionElement.querySelectorAll('[data-el-kind="group"]').forEach((group) => {
        if (!Array.from(group.children).some((child) => child.hasAttribute("data-el"))) plusesFor(section, group, pluses, seen);
      });
    });
    return { toolbar, pluses };
  };

  // Positions are read after the preview has rendered (never during render).
  React.useLayoutEffect(() => {
    const next = computeLayout();
    setLayout((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  });

  // Hover, scroll, resize, drag and drop, keyboard shortcuts.
  React.useEffect(() => {
    const document = doc();
    const win = document?.defaultView;
    if (!document || !win) return;
    const inOverlay = (target: EventTarget | null) =>
      target instanceof win.Node && Boolean(rootRef.current?.contains(target as Node));
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((value) => value + 1));
    };
    const onMove = (event: PointerEvent) => {
      if (inOverlay(event.target)) return;
      const target = event.target as Element | null;
      const group = target?.closest?.('[data-el-kind="group"]');
      const section = group?.closest("[data-builder-section]")?.getAttribute("data-builder-section");
      const element = group?.getAttribute("data-el");
      setHovered((current) =>
        section && element
          ? current?.section === section && current.element === element
            ? current
            : { section, element }
          : current && !target?.closest?.("[data-builder-section]")
            ? null
            : current,
      );
    };
    const targetAt = (event: DragEvent): Hint | null => {
      const drag = dragState.current;
      if (!drag || inOverlay(event.target)) return null;
      const node = (event.target as Element | null)?.closest?.("[data-el]");
      const sectionElement = node?.closest("[data-builder-section]");
      const section = sectionElement?.getAttribute("data-builder-section");
      if (!node || !section || !props.current.editable(section)) return null;
      if (drag.move && drag.section !== section) return null;
      const element = node.getAttribute("data-el")!;
      const box = boxOf(node);
      const parent = node.parentElement;
      const parentStyle = parent ? win.getComputedStyle(parent) : null;
      const horizontal = Boolean(
        parentStyle &&
          ((parentStyle.display.includes("flex") && parentStyle.flexDirection.startsWith("row")) ||
            parentStyle.display.includes("grid")),
      );
      const rect = node.getBoundingClientRect();
      const ratio = horizontal
        ? (event.clientX - rect.left) / Math.max(1, rect.width)
        : (event.clientY - rect.top) / Math.max(1, rect.height);
      let where: DropTarget["where"];
      if (element === "canvas") where = "inside";
      else if (isGroup(node)) where = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
      else where = ratio < 0.5 ? "before" : "after";
      const candidates: DropTarget[] = [{ element, where }];
      // Inside not allowed (too deep, itself…): try around the container.
      if (where === "inside" && element !== "canvas") candidates.push({ element, where: ratio < 0.5 ? "before" : "after" });
      for (const target of candidates)
        if (props.current.canDrop(section, drag, target)) return { section, target, box, horizontal };
      return null;
    };
    const onDragOver = (event: DragEvent) => {
      const next = targetAt(event);
      if (next) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = dragState.current?.move ? "move" : "copy";
      }
      setHint((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    const onDropEvent = (event: DragEvent) => {
      const next = targetAt(event);
      const drag = dragState.current;
      setHint(null);
      if (!next || !drag) return;
      event.preventDefault();
      dragState.current = null;
      props.current.onDrop(next.section, drag, next.target);
    };
    const onDragEnd = () => setHint(null);
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") setMenu(null);
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        props.current.onUndo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        props.current.onRedo();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!inOverlay(event.target)) setMenu(null);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDropEvent);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    win.addEventListener("scroll", bump, { passive: true });
    win.addEventListener("resize", bump);
    const observer = new ResizeObserver(bump);
    observer.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDropEvent);
      document.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      win.removeEventListener("scroll", bump);
      win.removeEventListener("resize", bump);
      observer.disconnect();
    };
  }, []);
  void tick;

  const toolbar = layout.toolbar;
  const info = toolbar ? describe(toolbar.section, toolbar.element) : null;
  const toolbarTop = toolbar ? (toolbar.top - 34 < (doc()?.defaultView?.scrollY ?? 0) + 4 ? toolbar.top + 4 : toolbar.top - 34) : 0;
  const openMenu = (section: string, target: DropTarget, x: number, y: number) => setMenu({ section, target, x, y });
  const button =
    "inline-flex size-7 items-center justify-center rounded-md text-white transition hover:bg-white/20 disabled:opacity-40";

  return (
    <div
      ref={rootRef}
      data-builder-overlay=""
      style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, zIndex: 2147483000, pointerEvents: "none" }}
    >
      {hint ? (
        hint.target.where === "inside" ? (
          <div
            style={{
              position: "absolute",
              top: hint.box.top,
              left: hint.box.left,
              width: hint.box.width,
              height: hint.box.height,
              outline: "3px solid #7c3aed",
              outlineOffset: -3,
              background: "rgba(124,58,237,.08)",
              borderRadius: 6,
            }}
          >
            <span className="absolute left-1 top-1 rounded bg-violet-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
              {t("Déposer dans ce div", "Drop inside this div")}
            </span>
          </div>
        ) : (
          <div
            style={{
              position: "absolute",
              background: "#7c3aed",
              borderRadius: 3,
              boxShadow: "0 0 0 2px #fff",
              ...(hint.horizontal
                ? {
                    top: hint.box.top,
                    height: hint.box.height,
                    width: 4,
                    left: (hint.target.where === "before" ? hint.box.left : hint.box.left + hint.box.width) - 2,
                  }
                : {
                    left: hint.box.left,
                    width: hint.box.width,
                    height: 4,
                    top: (hint.target.where === "before" ? hint.box.top : hint.box.top + hint.box.height) - 2,
                  }),
            }}
          >
            <span className="absolute -top-5 left-0 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {hint.target.where === "before" ? t("Insérer avant", "Insert before") : t("Insérer après", "Insert after")}
            </span>
          </div>
        )
      ) : null}

      {layout.pluses.map((plus) => (
        <button
          key={plus.key}
          type="button"
          data-builder-plus={plus.target.where}
          title={plus.title}
          aria-label={plus.title}
          onClick={(event) => {
            event.stopPropagation();
            openMenu(plus.section, plus.target, plus.x, plus.y + 14);
          }}
          style={{ position: "absolute", left: plus.x, top: plus.y, transform: "translate(-50%,-50%)", pointerEvents: "auto" }}
          className={`grid place-items-center rounded-full border-2 border-white bg-violet-600 text-white shadow-md transition hover:scale-110 hover:bg-violet-700 ${
            plus.small ? "size-5 opacity-70 hover:opacity-100" : "size-7"
          }`}
        >
          <Plus className={plus.small ? "size-3" : "size-4"} />
        </button>
      ))}

      {toolbar && info ? (
        <div
          data-builder-toolbar=""
          style={{ position: "absolute", left: Math.max(4, toolbar.left), top: toolbarTop, pointerEvents: "auto" }}
          className="flex items-center gap-0.5 rounded-lg bg-slate-900 px-1 py-0.5 text-white shadow-lg"
        >
          <span className="max-w-40 truncate px-1.5 text-[11px] font-semibold">{info.label}</span>
          {info.movable ? (
            <span
              draggable
              role="button"
              tabIndex={-1}
              title={t("Déplacer (glisser)", "Move (drag)")}
              aria-label={t("Déplacer", "Move")}
              onDragStart={(event) => {
                dragState.current = { move: toolbar.element, section: toolbar.section };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", toolbar.element);
                const node = elementNode(toolbar.section, toolbar.element);
                if (node instanceof HTMLElement) event.dataTransfer.setDragImage(node, 12, 12);
              }}
              onDragEnd={() => {
                dragState.current = null;
                setHint(null);
              }}
              className={`${button} cursor-grab active:cursor-grabbing`}
            >
              <GripVertical className="size-4" />
            </span>
          ) : null}
          <button
            type="button"
            className={button}
            title={t("Ajouter", "Add")}
            aria-label={t("Ajouter", "Add")}
            onClick={(event) => {
              event.stopPropagation();
              openMenu(
                toolbar.section,
                info.container
                  ? { element: toolbar.element, where: "inside" }
                  : { element: toolbar.element, where: "after" },
                toolbar.left + 40,
                toolbarTop + 32,
              );
            }}
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            className={button}
            disabled={!info.duplicable}
            title={t("Dupliquer", "Duplicate")}
            aria-label={t("Dupliquer", "Duplicate")}
            onClick={() => onDuplicate(toolbar.section, toolbar.element)}
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            className={`${button} hover:bg-red-500/80`}
            disabled={!info.deletable}
            title={t("Supprimer", "Delete")}
            aria-label={t("Supprimer", "Delete")}
            onClick={() => onDelete(toolbar.section, toolbar.element)}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ) : null}

      {menu ? (
        <div
          data-builder-menu=""
          role="menu"
          style={{ position: "absolute", left: menu.x, top: menu.y, transform: "translateX(-50%)", pointerEvents: "auto" }}
          className="grid w-48 gap-0.5 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-800 shadow-xl"
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {menu.target.where === "inside"
              ? t("Ajouter dans ce div", "Add inside this div")
              : menu.target.where === "before"
                ? t("Insérer ici", "Insert here")
                : t("Ajouter après", "Add after")}
          </p>
          {INSERT_TYPES.map(([type, Icon, french, english]) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              onClick={() => {
                const current = menu;
                setMenu(null);
                onInsert(current.section, type, current.target);
              }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-violet-50 hover:text-violet-700"
            >
              <Icon className="size-4" />
              {fr ? french : english}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
