"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GalleryHorizontal,
  GripVertical,
  Heading2,
  ImagePlus,
  LayoutPanelTop,
  MousePointerClick,
  MoveVertical,
  PencilLine,
  Plus,
  TextIcon,
  Trash2,
} from "lucide-react";

/** Where an element lands: inside a container, or before/after an element.
 * "canvas" (inside) means the top level of a free block / div. */
export type DropTarget = { element: string; where: "inside" | "before" | "after" };
/** What is being dragged: an existing element (move) or a new one (add). */
export type BuilderDrag = { move?: string; add?: string; section?: string; block?: string };
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
type Hint = { section: string; target: DropTarget; box: Box; horizontal: boolean; block?: boolean };
type Menu = { section: string; target: DropTarget; x: number; y: number };

export type ElementInfo = { label: string; movable: boolean; duplicable: boolean; deletable: boolean; container: boolean };
/** A text that can be written directly in the page. */
export type InlineText = { value: string; multiline: boolean };
type Editing = {
  section: string;
  element: string;
  language: "fr" | "en";
  original: string;
  multiline: boolean;
  box: Box;
  style: React.CSSProperties;
};

const isGroup = (node: Element | null) => node?.getAttribute("data-el-kind") === "group";
/** The preview is an iframe: its nodes fail `instanceof HTMLElement` of this window. */
const isHtml = (node: Element | null | undefined): node is HTMLElement =>
  Boolean(node && "style" in node && (node as HTMLElement).style);

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
  inlineText,
  onInlineText,
  onMoveBlock,
  blockLabel,
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
  /** The text of an element that can be written in the page (null: not a text). */
  inlineText: (section: string, element: string, language: "fr" | "en") => InlineText | null;
  onInlineText: (section: string, element: string, language: "fr" | "en", value: string) => void;
  /** Moves a whole block before or after another block of the page. */
  onMoveBlock: (block: string, target: string, where: "before" | "after") => void;
  blockLabel: (block: string) => string;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = React.useState<{ section: string; element: string } | null>(null);
  const [hoveredBlock, setHoveredBlock] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<Menu | null>(null);
  const [hint, setHint] = React.useState<Hint | null>(null);
  const [layout, setLayout] = React.useState<{
    toolbar: (Box & { section: string; element: string }) | null;
    pluses: PlusButton[];
    blockBar: (Box & { section: string; previous: string | null; next: string | null }) | null;
  }>({
    toolbar: null,
    pluses: [],
    blockBar: null,
  });
  const [tick, setTick] = React.useState(0);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  // While dragging: a small label as the drag image (never the whole block),
  // and the "+" buttons and bars are hidden so they don't get in the way.
  const [dragLabel, setDragLabel] = React.useState<string | null>(null);
  const ghostRef = React.useRef<HTMLDivElement>(null);
  const useGhost = (event: React.DragEvent, label: string) => {
    const ghost = ghostRef.current;
    if (ghost) {
      ghost.textContent = label;
      event.dataTransfer.setDragImage(ghost, 14, 14);
    }
    // Chrome cancels a drag whose source changes during "dragstart": the bars
    // fade out only once the drag has really begun.
    const win = ghost?.ownerDocument.defaultView ?? window;
    win.setTimeout(() => {
      if (dragState.current) setDragLabel(label);
    }, 0);
  };
  const editorRef = React.useRef<HTMLDivElement>(null);
  const t = (french: string, english: string) => (fr ? french : english);

  // Latest callbacks, for native listeners registered once.
  const props = React.useRef({ editable, canDrop, onDrop, onUndo, onRedo, inlineText, onMoveBlock });
  props.current = { editable, canDrop, onDrop, onUndo, onRedo, inlineText, onMoveBlock };

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
    if (!document) return { toolbar: null, pluses: [], blockBar: null };
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
    // The block bar: on the hovered block, else on the selected one.
    const blockIds = Array.from(document.querySelectorAll("[data-builder-section]"))
      .map((node) => node.getAttribute("data-builder-section")!)
      .filter((id) => props.current.editable(id));
    const barId = hoveredBlock && blockIds.includes(hoveredBlock) ? hoveredBlock : selectedId && blockIds.includes(selectedId) ? selectedId : null;
    const barNode = barId ? sectionNode(barId) : null;
    const position = barId ? blockIds.indexOf(barId) : -1;
    const blockBar = barNode && barId
      ? {
          ...boxOf(barNode),
          section: barId,
          previous: position > 0 ? blockIds[position - 1]! : null,
          next: position < blockIds.length - 1 ? blockIds[position + 1]! : null,
        }
      : null;
    return { toolbar, pluses, blockBar };
  };

  // Positions are read after the preview has rendered (never during render).
  React.useLayoutEffect(() => {
    const next = computeLayout();
    setLayout((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  });

  /** Writing in the page: the text is edited in place, over the element
   * (the element itself is hidden meanwhile, so React keeps owning it). */
  const startEditing = (section: string, element: string) => {
    const document = doc();
    const node = elementNode(section, element);
    if (!document || !isHtml(node)) return false;
    const language = document.querySelector("[data-wb-lang]")?.getAttribute("data-wb-lang") === "en" ? "en" : "fr";
    const info = props.current.inlineText(section, element, language);
    if (!info) return false;
    // Only one text at a time: the previous one is shown again.
    if (editing) {
      const previous = elementNode(editing.section, editing.element);
      if (isHtml(previous)) previous.style.visibility = "";
    }
    const css = document.defaultView!.getComputedStyle(node);
    node.style.visibility = "hidden";
    setMenu(null);
    setEditing({
      section,
      element,
      language,
      original: info.value,
      multiline: info.multiline,
      box: boxOf(node),
      style: {
        fontFamily: css.fontFamily,
        fontSize: css.fontSize,
        fontWeight: css.fontWeight as React.CSSProperties["fontWeight"],
        fontStyle: css.fontStyle,
        lineHeight: css.lineHeight,
        letterSpacing: css.letterSpacing,
        textTransform: css.textTransform as React.CSSProperties["textTransform"],
        textAlign: css.textAlign as React.CSSProperties["textAlign"],
        color: css.color,
        paddingTop: css.paddingTop,
        paddingRight: css.paddingRight,
        paddingBottom: css.paddingBottom,
        paddingLeft: css.paddingLeft,
      },
    });
    return true;
  };
  const stopEditing = (cancel = false) => {
    const current = editing;
    if (!current) return;
    if (cancel) onInlineText(current.section, current.element, current.language, current.original);
    const node = elementNode(current.section, current.element);
    if (isHtml(node)) node.style.visibility = "";
    setEditing(null);
  };
  const startRef = React.useRef(startEditing);
  startRef.current = startEditing;
  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editing || !editor) return;
    editor.textContent = editing.original;
    editor.focus();
    const selection = editor.ownerDocument.getSelection();
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Only when an edit starts: typing must never reset the text.
  }, [editing?.section, editing?.element]);

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
      const blockId = target?.closest?.("[data-builder-section]")?.getAttribute("data-builder-section") ?? null;
      const block = blockId && props.current.editable(blockId) ? blockId : null;
      setHoveredBlock((current) => (current === block ? current : block));
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
      if (!drag) return null;
      if (drag.block) {
        // A whole block: the gap between blocks nearest to the pointer,
        // wherever the pointer is (gaps, header, editor buttons included).
        const blocks = Array.from(document.querySelectorAll("[data-builder-section]")).filter((node) =>
          props.current.editable(node.getAttribute("data-builder-section")!),
        );
        if (!blocks.length) return null;
        let index = blocks.findIndex((node) => {
          const rect = node.getBoundingClientRect();
          return event.clientY < rect.top + rect.height / 2;
        });
        if (index < 0) index = blocks.length;
        const source = blocks.findIndex((node) => node.getAttribute("data-builder-section") === drag.block);
        // Dropping right before or after itself changes nothing.
        if (index === source || index === source + 1) return null;
        const anchor = index < blocks.length ? blocks[index]! : blocks[blocks.length - 1]!;
        const where = index < blocks.length ? "before" : "after";
        const section = anchor.getAttribute("data-builder-section")!;
        return { section, target: { element: section, where }, box: boxOf(anchor), horizontal: false, block: true };
      }
      if (inOverlay(event.target)) return null;
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
    // The mouse wheel does not scroll during a drag: near the top or bottom
    // edge of the preview, the page scrolls by itself (faster closer to it).
    let scrollSpeed = 0;
    let scrollFrame = 0;
    const scrollLoop = () => {
      if (!scrollSpeed || !dragState.current) {
        scrollFrame = 0;
        return;
      }
      win.scrollBy(0, scrollSpeed);
      scrollFrame = requestAnimationFrame(scrollLoop);
    };
    const autoScroll = (event: DragEvent) => {
      const edge = Math.min(120, win.innerHeight / 4);
      const fromTop = event.clientY;
      const fromBottom = win.innerHeight - event.clientY;
      scrollSpeed =
        fromTop < edge
          ? -Math.ceil(((edge - fromTop) / edge) * 24)
          : fromBottom < edge
            ? Math.ceil(((edge - fromBottom) / edge) * 24)
            : 0;
      if (scrollSpeed && !scrollFrame) scrollFrame = requestAnimationFrame(scrollLoop);
    };
    const stopScroll = () => {
      scrollSpeed = 0;
      cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
    };
    const onDragOver = (event: DragEvent) => {
      if (dragState.current) autoScroll(event);
      const next = targetAt(event);
      // A block being dragged can always be released: no "forbidden" cursor.
      if (dragState.current?.block) event.preventDefault();
      if (next) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = dragState.current?.move ? "move" : "copy";
      }
      setHint((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    const onDropEvent = (event: DragEvent) => {
      const next = targetAt(event);
      const drag = dragState.current;
      stopScroll();
      setHint(null);
      setDragLabel(null);
      if (drag?.block) event.preventDefault();
      if (!next || !drag) return;
      event.preventDefault();
      dragState.current = null;
      if (drag.block) {
        props.current.onMoveBlock(drag.block, next.section, next.target.where === "before" ? "before" : "after");
        return;
      }
      props.current.onDrop(next.section, drag, next.target);
    };
    const onDragEnd = () => {
      stopScroll();
      setHint(null);
      setDragLabel(null);
    };
    // Leaving the preview (pointer over the editor around it) stops scrolling.
    const onDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) stopScroll();
    };
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
    const onDoubleClick = (event: MouseEvent) => {
      if (inOverlay(event.target)) return;
      const node = (event.target as Element | null)?.closest?.("[data-el]");
      const section = node?.closest("[data-builder-section]")?.getAttribute("data-builder-section");
      const element = node?.getAttribute("data-el");
      if (!node || !section || !element || !props.current.editable(section)) return;
      if (startRef.current(section, element)) event.preventDefault();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDropEvent);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("dblclick", onDoubleClick);
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
      document.removeEventListener("dragleave", onDragLeave);
      stopScroll();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("dblclick", onDoubleClick);
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
      <div
        ref={ghostRef}
        aria-hidden="true"
        style={{ position: "fixed", left: 0, top: -120, pointerEvents: "none", zIndex: 2147483647 }}
        className="max-w-56 truncate rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
      />
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
              {hint.block
                ? hint.target.where === "before"
                  ? t("Déplacer le bloc ici (avant)", "Move the block here (before)")
                  : t("Déplacer le bloc ici (après)", "Move the block here (after)")
                : hint.target.where === "before"
                  ? t("Insérer avant", "Insert before")
                  : t("Insérer après", "Insert after")}
            </span>
          </div>
        )
      ) : null}

      {layout.blockBar && !editing ? (
        <div
          data-builder-blockbar=""
          style={{
            position: "absolute",
            top: layout.blockBar.top + 6,
            left: layout.blockBar.left + layout.blockBar.width - 8,
            transform: "translateX(-100%)",
            // Kept in the page while dragging (removing it would stop the drag).
            pointerEvents: dragLabel ? "none" : "auto",
            opacity: dragLabel ? 0 : 1,
          }}
          className="flex items-center gap-0.5 rounded-lg bg-sky-700 px-1 py-0.5 text-white shadow-lg"
        >
          <span
            draggable
            role="button"
            tabIndex={-1}
            title={t("Glisser pour déplacer le bloc", "Drag to move the block")}
            aria-label={t("Déplacer le bloc", "Move the block")}
            onDragStart={(event) => {
              const bar = layout.blockBar!;
              dragState.current = { block: bar.section };
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", bar.section);
              useGhost(event, blockLabel(bar.section));
            }}
            onDragEnd={() => {
              dragState.current = null;
              setHint(null);
              setDragLabel(null);
            }}
            className="inline-flex h-7 cursor-grab items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold hover:bg-white/20 active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
            <span className="max-w-36 truncate">{blockLabel(layout.blockBar.section)}</span>
          </span>
          <button
            type="button"
            className={button}
            disabled={!layout.blockBar.previous}
            title={t("Monter le bloc", "Move block up")}
            aria-label={t("Monter le bloc", "Move block up")}
            onClick={() => layout.blockBar?.previous && onMoveBlock(layout.blockBar.section, layout.blockBar.previous, "before")}
          >
            <ArrowUp className="size-4" />
          </button>
          <button
            type="button"
            className={button}
            disabled={!layout.blockBar.next}
            title={t("Descendre le bloc", "Move block down")}
            aria-label={t("Descendre le bloc", "Move block down")}
            onClick={() => layout.blockBar?.next && onMoveBlock(layout.blockBar.section, layout.blockBar.next, "after")}
          >
            <ArrowDown className="size-4" />
          </button>
        </div>
      ) : null}

      {(dragLabel ? [] : layout.pluses).map((plus) => (
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

      {toolbar && info && !editing ? (
        <div
          data-builder-toolbar=""
          style={{
            position: "absolute",
            left: Math.max(4, toolbar.left),
            top: toolbarTop,
            pointerEvents: dragLabel ? "none" : "auto",
            opacity: dragLabel ? 0 : 1,
          }}
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
                useGhost(event, info.label);
              }}
              onDragEnd={() => {
                dragState.current = null;
                setHint(null);
                setDragLabel(null);
              }}
              className={`${button} cursor-grab active:cursor-grabbing`}
            >
              <GripVertical className="size-4" />
            </span>
          ) : null}
          {inlineText(toolbar.section, toolbar.element, "fr") ? (
            <button
              type="button"
              className={button}
              title={t("Écrire dans la page (ou double-clic sur le texte)", "Write in the page (or double-click the text)")}
              aria-label={t("Modifier le texte", "Edit text")}
              onClick={() => startEditing(toolbar.section, toolbar.element)}
            >
              <PencilLine className="size-4" />
            </button>
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

      {editing ? (
        <div
          ref={editorRef}
          data-builder-inline=""
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          role="textbox"
          aria-multiline={editing.multiline}
          aria-label={t("Texte en cours d’écriture", "Text being written")}
          spellCheck
          onInput={(event) =>
            onInlineText(editing.section, editing.element, editing.language, (event.currentTarget.innerText ?? "").replace(/\n$/, ""))
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              stopEditing(true);
            } else if (event.key === "Enter" && (!editing.multiline || event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              stopEditing();
            }
          }}
          onBlur={() => stopEditing()}
          style={{
            ...editing.style,
            position: "absolute",
            top: editing.box.top,
            left: editing.box.left,
            width: Math.max(40, editing.box.width),
            minHeight: editing.box.height,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            outline: "2px solid #7c3aed",
            outlineOffset: 2,
            borderRadius: 4,
            background: "rgba(255,255,255,.04)",
            cursor: "text",
            pointerEvents: "auto",
            caretColor: "#7c3aed",
          }}
        />
      ) : null}
      {editing ? (
        <span
          style={{ position: "absolute", top: editing.box.top - 24, left: editing.box.left, pointerEvents: "none" }}
          className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
        >
          {editing.language.toUpperCase()} ·{" "}
          {editing.multiline
            ? t("Entrée : nouvelle ligne · Ctrl+Entrée ou clic ailleurs : terminer · Échap : annuler", "Enter: new line · Ctrl+Enter or click outside: done · Esc: cancel")
            : t("Entrée ou clic ailleurs : terminer · Échap : annuler", "Enter or click outside: done · Esc: cancel")}
        </span>
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
