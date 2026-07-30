import {
  createDoc,
  Editor,
  type DocumentAutosave,
  type LocalDocumentMetadata,
} from "@atelier/core";
import type { PackagingProject } from "@packcad/format";
import { createCommandRegistry } from "../model/commands";

export const PROJECT_AUTOSAVE_DEBOUNCE_MS = 800;

export type ProjectSaveState = "saved" | "saving" | "error";

export interface ProjectDocumentStore {
  save(
    id: string,
    name: string,
    snapshot: PackagingProject,
  ): Promise<LocalDocumentMetadata>;
  load(id: string): Promise<PackagingProject | null>;
  list(): Promise<LocalDocumentMetadata[]>;
  delete(id: string): Promise<void>;
  autosave(
    documentId: string,
    getSnapshot: () => PackagingProject,
    options: { debounceMs: number },
  ): DocumentAutosave;
}

export type ProjectDocumentIdentity = {
  id: string;
  name: string;
};

export type ProjectSnapshot = Omit<PackagingProject, "projection"> & {
  projection?: unknown;
};

export function normalizeProjectSnapshot(
  content: ProjectSnapshot,
): PackagingProject {
  return {
    ...content,
    projection: content.projection === "orthographic"
      ? "orthographic"
      : "perspective",
  };
}

export function createProjectEditor(
  content: ProjectSnapshot,
  identity: Partial<ProjectDocumentIdentity> = {},
): Editor<PackagingProject> {
  return new Editor(
    createDoc(normalizeProjectSnapshot(content), identity),
    { registry: createCommandRegistry(), history: { limit: 100 } },
  );
}

export interface ProjectAutosaveBinding {
  flush(): Promise<void>;
  dispose(): void;
}

/**
 * Connects document changes to LocalDocumentStore's debounced autosave.
 *
 * The status timer is registered before `schedule()`, so at the end of the
 * debounce window `flush()` cancels the store timer and awaits the one save
 * that makes the "Saved" indicator truthful.
 */
export function bindProjectAutosave(
  editor: Editor<PackagingProject>,
  store: ProjectDocumentStore,
  documentId: string,
  onStateChange: (state: ProjectSaveState) => void,
  debounceMs = PROJECT_AUTOSAVE_DEBOUNCE_MS,
): ProjectAutosaveBinding {
  const autosave = store.autosave(
    documentId,
    () => editor.content,
    { debounceMs },
  );
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = async (): Promise<void> => {
    if (disposed) return;
    if (statusTimer !== null) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    try {
      await autosave.flush();
      if (!disposed) onStateChange("saved");
    } catch {
      if (!disposed) onStateChange("error");
      throw new Error("Could not save the current draft.");
    }
  };

  const unsubscribe = editor.on("doc", () => {
    if (disposed) return;
    onStateChange("saving");
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusTimer = null;
      void flush().catch(() => {
        // The status callback exposes the failure without creating an
        // unhandled rejection from a timer-driven save.
      });
    }, Math.max(0, debounceMs));
    autosave.schedule();
  });

  return {
    flush,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      if (statusTimer !== null) clearTimeout(statusTimer);
      statusTimer = null;
      autosave.dispose();
    },
  };
}
