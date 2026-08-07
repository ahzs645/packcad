import { useEffect, useState } from "react";
import type { LocalDocumentMetadata } from "@atelier/core";
import type { CameraProjection } from "@packcad/format";
import type {
  UiPreferences,
  ViewLayout,
} from "../model/uiPreferences";
import type { ProjectSaveState } from "../persistence/projectDocuments";
import { guestAvatar } from "../assets/sourceChrome";
import {
  edgeColorModeOptions,
  panelColorModeOptions,
} from "../render/foldViewSettings";
import { Icon } from "./Icon";

export type OpenMenu = "file" | "view" | null;

interface TopbarProps {
  openMenu: OpenMenu;
  inspectorOpen: boolean;
  saveState: ProjectSaveState;
  drafts: LocalDocumentMetadata[];
  activeDocumentId: string;
  preferences: UiPreferences;
  projection: CameraProjection;
  onSetOpenMenu: (menu: OpenMenu) => void;
  onOpenPreferences: () => void;
  onToggleInspector: () => void;
  onNewProject: () => void;
  onOpenSampleLibrary: () => void;
  onOpenProject: () => void;
  onImportDieline: () => void;
  onSaveProject: () => void;
  onSaveDraft: () => void;
  onCopyProjectUrl: () => void;
  onOpenDraft: (draft: LocalDocumentMetadata) => void;
  onDeleteDraft: (draft: LocalDocumentMetadata) => void;
  onExport: (
    format: "svg" | "gltf" | "dxf" | "hpgl" | "pdf" | "png",
  ) => void;
  onSetViewLayout: (layout: ViewLayout) => void;
  onUpdatePreferences: (patch: Partial<UiPreferences>) => void;
  onSetProjection: (projection: CameraProjection) => void;
}

export function Topbar({
  openMenu,
  inspectorOpen,
  saveState,
  drafts,
  activeDocumentId,
  preferences,
  projection,
  onSetOpenMenu,
  onOpenPreferences,
  onToggleInspector,
  onNewProject,
  onOpenSampleLibrary,
  onOpenProject,
  onImportDieline,
  onSaveProject,
  onSaveDraft,
  onCopyProjectUrl,
  onOpenDraft,
  onDeleteDraft,
  onExport,
  onSetViewLayout,
  onUpdatePreferences,
  onSetProjection,
}: TopbarProps) {
  type ViewSubmenu = "layout" | "panel-color" | "edge-color" | "projection";
  const [openSubmenu, setOpenSubmenu] = useState<ViewSubmenu | null>(null);
  useEffect(() => {
    if (openMenu !== "view") setOpenSubmenu(null);
  }, [openMenu]);

  const toggleMenu = (menu: Exclude<OpenMenu, null>): void => {
    onSetOpenMenu(openMenu === menu ? null : menu);
  };
  const choose = (run: () => void): void => {
    run();
    onSetOpenMenu(null);
  };
  const submenuClass = (submenu: ViewSubmenu): string =>
    openSubmenu === submenu ? "menu-submenu open" : "menu-submenu";
  const toggleSubmenu = (submenu: ViewSubmenu): void => {
    setOpenSubmenu((current) => (current === submenu ? null : submenu));
  };

  return (
    <header className="topbar">
      <div className="menu-group" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="icon-button"
          aria-label="Preferences"
          title="Preferences"
          onClick={onOpenPreferences}
        >
          <Icon name="settings-2" size={16} />
        </button>

        <div className="menu-host">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openMenu === "file"}
            onClick={() => toggleMenu("file")}
          >
            File
          </button>
          {openMenu === "file" ? (
            <div className="dropdown-menu file-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => choose(onNewProject)}>
                New Project
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onOpenSampleLibrary)}
              >
                <Icon name="box" size={15} />
                Sample Library...
              </button>
              <button type="button" role="menuitem" onClick={() => choose(onOpenProject)}>
                <Icon name="upload" size={15} />
                Open Project...
              </button>
              <button type="button" role="menuitem" onClick={() => choose(onImportDieline)}>
                <Icon name="file-up" size={15} />
                Import Dieline...
              </button>
              <button type="button" role="menuitem" onClick={() => choose(onSaveProject)}>
                <Icon name="save" size={15} />
                Save Project <kbd>⌘S</kbd>
              </button>
              <button type="button" role="menuitem" onClick={() => choose(onSaveDraft)}>
                <Icon name="save" size={15} />
                Save Draft
              </button>
              <button type="button" role="menuitem" onClick={() => choose(onCopyProjectUrl)}>
                <Icon name="share" size={15} />
                Copy Project URL
              </button>
              <span className="menu-label">
                LOCAL DRAFTS · {saveState === "saving" ? "SAVING…" : "SAVED"}
              </span>
              {drafts.length === 0 ? (
                <span className="menu-empty">No local drafts</span>
              ) : drafts.slice(0, 6).map((draft) => (
                <div className="menu-draft-row" key={draft.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className={draft.id === activeDocumentId ? "active" : ""}
                    onClick={() => choose(() => onOpenDraft(draft))}
                  >
                    <span>{draft.name}</span>
                    <small>{new Date(draft.updatedAt).toLocaleDateString()}</small>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${draft.name}`}
                    onClick={() => onDeleteDraft(draft)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
              <span className="menu-label">EXPORTS</span>
              <button type="button" role="menuitem" onClick={() => choose(() => onExport("gltf"))}>
                Export 3D Model...
              </button>
              {(["png", "svg", "dxf", "hpgl", "pdf"] as const).map((format) => (
                <button
                  type="button"
                  role="menuitem"
                  key={format}
                  onClick={() => choose(() => onExport(format))}
                >
                  Export {format.toUpperCase()}...
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="menu-host">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openMenu === "view"}
            onClick={() => toggleMenu("view")}
          >
            View
          </button>
          {openMenu === "view" ? (
            <div className="dropdown-menu view-settings-menu" role="menu">
              <div className={submenuClass("layout")}>
                <button
                  type="button"
                  className="menu-sub-trigger"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openSubmenu === "layout"}
                  onClick={() => toggleSubmenu("layout")}
                >
                  <Icon name="layout" size={16} />
                  <span>View Layout</span>
                  <Icon name="chevron-right" size={16} />
                </button>
                <div className="dropdown-menu menu-sub-content" role="menu">
                  {([
                    ["single-3d", "Folded Model", "package"],
                    ["single-2d", "Dieline", "stack"],
                    ["split-horizontal", "Split Horizontally", "columns"],
                    ["split-vertical", "Split Vertically", "rows"],
                  ] as const).map(([layout, label, icon]) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={layout}
                      onClick={() => choose(() => onSetViewLayout(layout))}
                    >
                      <Icon name={icon} size={16} />
                      <span>{label}</span>
                      {preferences.viewLayout === layout
                        ? <Icon name="check" size={16} />
                        : <span className="menu-check-slot" />}
                    </button>
                  ))}
                </div>
              </div>
              <span className="menu-separator" />
              <div className={submenuClass("panel-color")}>
                <button
                  type="button"
                  className="menu-sub-trigger"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openSubmenu === "panel-color"}
                  onClick={() => toggleSubmenu("panel-color")}
                >
                  <Icon name="triangle" size={16} />
                  <span>Panel Color Mode</span>
                  <Icon name="chevron-right" size={16} />
                </button>
                <div className="dropdown-menu menu-sub-content" role="menu">
                  {panelColorModeOptions.map((option) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={option.value}
                      onClick={() => choose(() => onUpdatePreferences({
                        panelColorMode: option.value,
                      }))}
                    >
                      <span>{option.label}</span>
                      {preferences.panelColorMode === option.value
                        ? <Icon name="check" size={16} />
                        : <span className="menu-check-slot" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className={submenuClass("edge-color")}>
                <button
                  type="button"
                  className="menu-sub-trigger"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openSubmenu === "edge-color"}
                  onClick={() => toggleSubmenu("edge-color")}
                >
                  <Icon name="minus" size={16} />
                  <span>Edge Color Mode</span>
                  <Icon name="chevron-right" size={16} />
                </button>
                <div className="dropdown-menu menu-sub-content" role="menu">
                  {edgeColorModeOptions.map((option) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={option.value}
                      onClick={() => choose(() => onUpdatePreferences({
                        edgeColorMode: option.value,
                      }))}
                    >
                      <span>{option.label}</span>
                      {preferences.edgeColorMode === option.value
                        ? <Icon name="check" size={16} />
                        : <span className="menu-check-slot" />}
                    </button>
                  ))}
                </div>
              </div>
              <span className="menu-separator" />
              <span className="menu-label">3D VIEW</span>
              {([
                ["groundPlane", "Ground Plane", "grid"],
                ["shadow", "Shadow", "monitor"],
                ["origin", "Origin", "move"],
              ] as const).map(([property, label, icon]) => (
                <button
                  type="button"
                  role="menuitem"
                  key={property}
                  onClick={() => onUpdatePreferences({
                    [property]: !preferences[property],
                  })}
                >
                  <Icon name={icon} size={16} />
                  <span>{label}</span>
                  {preferences[property] ? <Icon name="check" size={16} /> : null}
                </button>
              ))}
              <div className={submenuClass("projection")}>
                <button
                  type="button"
                  className="menu-sub-trigger"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={openSubmenu === "projection"}
                  onClick={() => toggleSubmenu("projection")}
                >
                  <Icon name="video" size={16} />
                  <span>Camera Projection</span>
                  <Icon name="chevron-right" size={16} />
                </button>
                <div className="dropdown-menu menu-sub-content" role="menu">
                  {(["orthographic", "perspective"] as const).map((kind) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={kind}
                      onClick={() => choose(() => onSetProjection(kind))}
                    >
                      <span>
                        {kind === "orthographic" ? "Orthographic" : "Perspective"}
                      </span>
                      {projection === kind ? <Icon name="check" size={16} /> : null}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onOpenPreferences)}
              >
                <Icon name="video" size={16} />
                <span>Camera Settings...</span>
              </button>
              <label className="menu-color-row" role="menuitem">
                <span
                  className="menu-color-swatch"
                  style={{ backgroundColor: preferences.backgroundColor }}
                />
                <span>Background Color...</span>
                <input
                  type="color"
                  value={preferences.backgroundColor}
                  onChange={(event) => onUpdatePreferences({
                    backgroundColor: event.target.value,
                  })}
                />
              </label>
              <span className="menu-separator" />
              <button
                type="button"
                role="menuitem"
                onClick={onToggleInspector}
              >
                <Icon name="panel-right" size={16} />
                <span>Inspector</span>
                {inspectorOpen ? <Icon name="check" size={16} /> : null}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onUpdatePreferences({
                  darkMode: !preferences.darkMode,
                })}
              >
                <Icon name="moon" size={16} />
                <span>Dark Mode</span>
                {preferences.darkMode ? <Icon name="check" size={16} /> : null}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <button type="button" className="upgrade" aria-label="Upgrade to Pro">
        <Icon name="square-plus" size={16} />
        <span className="upgrade-label">Upgrade to Pro</span>
        <span className="upgrade-label-compact" aria-hidden="true">Pro</span>
      </button>
      <div className="menu-group right">
        <button type="button" className="whats-new">
          <span className="whats-new-dot" aria-hidden="true" />
          What&apos;s New
        </button>
        <button type="button" className="docs">Docs</button>
        <button
          type="button"
          className="icon-button feedback"
          aria-label="Feedback"
          title="Feedback"
        >
          <Icon name="message-circle" size={16} />
        </button>
        <img className="guest-avatar" src={guestAvatar} alt="Guest Avatar" />
      </div>
    </header>
  );
}
