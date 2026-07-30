import type {
  DocumentAutosave,
  LocalDocumentMetadata,
} from "@atelier/core";
import { createMailerBoxProject } from "@packcad/fold-solver";
import type { PackagingProject } from "@packcad/format";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindProjectAutosave,
  createProjectEditor,
  type ProjectDocumentStore,
  type ProjectSnapshot,
} from "./projectDocuments";

class MemoryProjectStore implements ProjectDocumentStore {
  readonly documents = new Map<string, {
    metadata: LocalDocumentMetadata;
    snapshot: PackagingProject;
  }>();
  readonly autosaveWrites: PackagingProject[] = [];

  async save(
    id: string,
    name: string,
    snapshot: PackagingProject,
  ): Promise<LocalDocumentMetadata> {
    const metadata = { id, name, updatedAt: new Date().toISOString() };
    this.documents.set(id, {
      metadata,
      snapshot: JSON.parse(JSON.stringify(snapshot)) as PackagingProject,
    });
    return metadata;
  }

  async load(id: string): Promise<PackagingProject | null> {
    return this.documents.get(id)?.snapshot ?? null;
  }

  async list(): Promise<LocalDocumentMetadata[]> {
    return [...this.documents.values()].map(({ metadata }) => metadata);
  }

  async delete(id: string): Promise<void> {
    this.documents.delete(id);
  }

  autosave(
    documentId: string,
    getSnapshot: () => PackagingProject,
    { debounceMs }: { debounceMs: number },
  ): DocumentAutosave {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const flush = async (): Promise<void> => {
      if (disposed) return;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const snapshot = getSnapshot();
      this.autosaveWrites.push(snapshot);
      const existing = this.documents.get(documentId);
      await this.save(
        documentId,
        existing?.metadata.name ?? documentId,
        snapshot,
      );
    };
    const schedule = (): void => {
      if (disposed) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void flush(), debounceMs);
    };
    schedule();
    return {
      schedule,
      flush,
      dispose: () => {
        disposed = true;
        if (timer !== null) clearTimeout(timer);
        timer = null;
      },
    };
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("project document persistence", () => {
  it("debounces editor changes and saves the latest project snapshot", async () => {
    vi.useFakeTimers();
    const store = new MemoryProjectStore();
    const editor = createProjectEditor(createMailerBoxProject(), {
      id: "draft-1",
      name: "Mailer",
    });
    await store.save("draft-1", "Mailer", editor.content);
    const states: string[] = [];
    const binding = bindProjectAutosave(
      editor,
      store,
      "draft-1",
      (state) => states.push(state),
      180,
    );

    await vi.advanceTimersByTimeAsync(180);
    store.autosaveWrites.length = 0;
    editor.execute("material.setThickness", { thicknessMm: 2 });
    await vi.advanceTimersByTimeAsync(100);
    editor.execute("view.setProjection", { projection: "perspective" });
    await vi.advanceTimersByTimeAsync(179);
    expect(store.autosaveWrites).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(store.autosaveWrites).toHaveLength(1);
    expect(store.autosaveWrites[0]).toMatchObject({
      thicknessMm: 2,
      projection: "perspective",
    });
    expect(states).toEqual(["saving", "saving", "saved"]);

    binding.dispose();
    editor.dispose();
  });

  it("loads a draft into a fresh editor with empty undo and redo history", async () => {
    const store = new MemoryProjectStore();
    const edited = createProjectEditor(createMailerBoxProject());
    edited.execute("material.setThickness", { thicknessMm: 3 });
    edited.execute("view.setProjection", { projection: "orthographic" });
    expect(edited.canUndo).toBe(true);
    await store.save("draft-loaded", "Loaded draft", edited.content);

    const snapshot = await store.load("draft-loaded");
    if (!snapshot) throw new Error("Test draft was not saved");
    const loaded = createProjectEditor(snapshot, {
      id: "draft-loaded",
      name: "Loaded draft",
    });

    expect(loaded.content.thicknessMm).toBe(3);
    expect(loaded.content.projection).toBe("orthographic");
    expect(loaded.canUndo).toBe(false);
    expect(loaded.canRedo).toBe(false);
    expect(loaded.undo()).toBe(false);
    expect(loaded.content.thicknessMm).toBe(3);

    edited.dispose();
    loaded.dispose();
  });

  it("defaults legacy draft snapshots to perspective projection", () => {
    const oldSnapshot: ProjectSnapshot = { ...createMailerBoxProject() };
    delete oldSnapshot.projection;

    const loaded = createProjectEditor(oldSnapshot);

    expect(loaded.content.projection).toBe("perspective");
    expect(loaded.canUndo).toBe(false);
    loaded.dispose();
  });

  it("round-trips the complete Mailer Box project through JSON", () => {
    const project = {
      ...createMailerBoxProject(),
      projection: "orthographic" as const,
      artwork: {
        ...createMailerBoxProject().artwork,
        imageDataUrl: "data:image/png;base64,cGVyc2lzdGVkLWFydHdvcms=",
        imageName: "persisted-artwork.png",
        backImageDataUrl: "data:image/png;base64,aW50ZXJpb3ItYXJ0d29yaw==",
        backImageName: "persisted-interior.png",
        panelIndex: 1,
      },
    };
    const roundTripped = JSON.parse(JSON.stringify(project)) as PackagingProject;

    expect(roundTripped).toEqual(project);
    expect(roundTripped.projection).toBe("orthographic");
    expect(roundTripped.artwork).toMatchObject({
      imageDataUrl: "data:image/png;base64,cGVyc2lzdGVkLWFydHdvcms=",
      imageName: "persisted-artwork.png",
      backImageDataUrl: "data:image/png;base64,aW50ZXJpb3ItYXJ0d29yaw==",
      backImageName: "persisted-interior.png",
      panelIndex: 1,
    });
    expect(roundTripped.foldModel?.verticesCoords.length).toBeGreaterThan(0);
    expect(roundTripped.design?.operations.length).toBeGreaterThan(0);
  });
});
