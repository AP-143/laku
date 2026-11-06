import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deleteSession,
  describeSession,
  loadWorkspace,
  saveWorkspace,
  selectSession,
  setActiveItems,
  startSession,
  storyboardFor,
  type ChatSession,
  type Workspace,
} from "./saved-conversation";
import { SCENE_REPLACED_MESSAGE, SCENES_PROPOSED_MESSAGE } from "../../shared/chat-messages";
import type { ThreadItem } from "./thread";

/** The chat sessions the seller sees in the sidebar, kept in the browser's storage across reloads. */

/** A stand-in for the browser's localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("chat sessions", () => {
  it("starts with one empty session when nothing was saved", () => {
    const workspace = loadWorkspace(memoryStorage());

    assert.equal(workspace.sessions.length, 1);
    assert.equal(workspace.activeId, workspace.sessions[0].id);
    assert.deepEqual(workspace.sessions[0].items, []);
  });

  it("brings the messages back after a reload", () => {
    const storage = memoryStorage();
    const items: ThreadItem[] = [
      { id: "a", kind: "user", text: "foto studio dong" },
      { id: "b", kind: "bot", text: "Siap, ini hasilnya." },
    ];

    saveWorkspace(storage, setActiveItems(loadWorkspace(storage), items));
    const reloaded = loadWorkspace(storage);

    assert.deepEqual(reloaded.sessions.length, 1);
    assert.deepEqual(reloaded.sessions[0].items, items);
  });

  it("starts a new session on top of the list and keeps the old one as it was", () => {
    const items: ThreadItem[] = [{ id: "a", kind: "user", text: "foto studio dong" }];
    const first = setActiveItems(loadWorkspace(memoryStorage()), items);

    const second = startSession(first);

    assert.equal(second.sessions.length, 2);
    assert.equal(second.activeId, second.sessions[0].id);
    assert.deepEqual(second.sessions[0].items, []);
    assert.deepEqual(second.sessions[1].items, items);
    assert.equal(second.sessions[1].id, first.activeId);
  });

  it("does not pile up empty sessions when the one on screen is still empty", () => {
    const empty = loadWorkspace(memoryStorage());

    const again = startSession(startSession(empty));

    assert.deepEqual(again, empty);
  });

  it("shows the empty session that is already in the list instead of adding another one", () => {
    const used: ChatSession = { id: "used", items: [{ id: "m", kind: "user", text: "foto studio dong" }] };
    const blank: ChatSession = { id: "blank", items: [] };
    const workspace: Workspace = { sessions: [used, blank], activeId: "used" };

    const next = startSession(workspace);

    assert.deepEqual(next.sessions, workspace.sessions);
    assert.equal(next.activeId, "blank");
  });

  it("switches to an older session and adds new messages to that session only", () => {
    const studio: ThreadItem[] = [{ id: "a", kind: "user", text: "foto studio dong" }];
    const video: ThreadItem[] = [{ id: "b", kind: "user", text: "bikin video" }];
    const first = setActiveItems(loadWorkspace(memoryStorage()), studio);
    const second = setActiveItems(startSession(first), video);

    const back = selectSession(second, first.activeId);
    const edited = setActiveItems(back, [...studio, { id: "c", kind: "bot", text: "Ini hasilnya." }]);

    assert.equal(back.activeId, first.activeId);
    assert.equal(edited.sessions[0].items, second.sessions[0].items);
    assert.equal(edited.sessions[1].items.length, 2);
    assert.equal(selectSession(second, "no-such-session"), second);
  });

  describe("deleting a session", () => {
    const chat = (id: string, text: string): ChatSession => ({ id, items: [{ id: `m-${id}`, kind: "user", text }] });
    const idsOf = (workspace: Workspace) => workspace.sessions.map((session) => session.id);

    it("removes that session and keeps the one on screen", () => {
      const workspace: Workspace = { sessions: [chat("a", "satu"), chat("b", "dua"), chat("c", "tiga")], activeId: "a" };

      const after = deleteSession(workspace, "b");

      assert.deepEqual(idsOf(after), ["a", "c"]);
      assert.equal(after.activeId, "a");
    });

    it("shows the next older session when the one on screen is deleted, or the one above it when it was the oldest", () => {
      const workspace: Workspace = { sessions: [chat("a", "satu"), chat("b", "dua"), chat("c", "tiga")], activeId: "b" };

      const middle = deleteSession(workspace, "b");
      assert.deepEqual(idsOf(middle), ["a", "c"]);
      assert.equal(middle.activeId, "c");

      const oldest = deleteSession(selectSession(workspace, "c"), "c");
      assert.deepEqual(idsOf(oldest), ["a", "b"]);
      assert.equal(oldest.activeId, "b");
    });

    it("leaves one fresh empty session when the last one is deleted", () => {
      const only: Workspace = { sessions: [chat("a", "satu")], activeId: "a" };

      const after = deleteSession(only, "a");

      assert.equal(after.sessions.length, 1);
      assert.notEqual(after.sessions[0].id, "a");
      assert.deepEqual(after.sessions[0].items, []);
      assert.equal(after.activeId, after.sessions[0].id);
    });

    it("changes nothing for a session that is not in the list", () => {
      const workspace: Workspace = { sessions: [chat("a", "satu")], activeId: "a" };

      assert.equal(deleteSession(workspace, "no-such-session"), workspace);
    });
  });

  it("titles a session after the first message, shortened when it is long", () => {
    const titleOf = (items: ThreadItem[]) => describeSession({ id: "s", items }).title;

    assert.equal(titleOf([]), "Chat baru");
    assert.equal(titleOf([{ id: "a", kind: "user", text: "Foto studio latar putih" }]), "Foto studio latar putih");
    assert.equal(
      titleOf([{ id: "a", kind: "user", text: "Bikinin storyboard 4 scene untuk Reels jualan sepatu" }]),
      "Bikinin storyboard 4 scene untuk…",
    );
    assert.equal(titleOf([{ id: "a", kind: "user", text: "", photoAssetId: "p" }]), "Foto produk");
  });

  it("labels a session with the feature of its first result, where storyboard and video are one feature", () => {
    const user: ThreadItem = { id: "u", kind: "user", text: "tolong" };
    const studio: ThreadItem = { id: "s", kind: "studio", assetId: "x", sourceAssetId: "p", retry: {} };
    const scenes: ThreadItem = { id: "c", kind: "scenes", sourceAssetId: "p", scenes: ["a", "b", "c", "d", "e", "f"], approved: false };
    const video: ThreadItem = { id: "v", kind: "video", assetId: "x", sourceAssetId: "p" };
    const partial: ThreadItem = { id: "t", kind: "partial", seconds: 16, clips: [4, 4, 4, 4], finished: {}, failedIndex: 0, voiceOver: false, sheet: "s", directions: [], narration: [], voice: "female", grade: { contrast: 1, saturation: 1, brightness: 0, warmth: 0, grain: 0, vignette: false } };
    const featureOf = (items: ThreadItem[]) => describeSession({ id: "s", items }).feature;

    assert.equal(featureOf([user]), undefined);
    assert.equal(featureOf([user, studio]), "studio_photo");
    assert.equal(featureOf([user, scenes]), "storyboard");
    // A video typed for in an old chat, or one that stopped part way, belongs to the same feature as its storyboard.
    assert.equal(featureOf([user, video]), "storyboard");
    assert.equal(featureOf([user, partial]), "storyboard");
    assert.equal(featureOf([user, studio, scenes, video]), "studio_photo");
  });

  it("brings the storyboard replies saved with older wording up to date, and leaves every other message alone", () => {
    const saved: ThreadItem[] = [
      { id: "a", kind: "user", text: "buat storyboard" },
      {
        id: "b",
        kind: "bot",
        text: "Ini usulan 4 scene storyboard-nya. Kamu bisa ubah teksnya atau minta aku ganti scene tertentu. Kalau sudah cocok, setujui dulu ya, baru aku buatkan gambarnya.",
      },
      { id: "c", kind: "bot", text: "Sudah kuganti. Kalau sudah cocok, setujui supaya aku buatkan gambarnya ya." },
      { id: "d", kind: "bot", text: "Halo! Ada yang bisa kubantu?" },
      // The seller's own words are never rewritten, even when they match.
      { id: "e", kind: "user", text: "Sudah kuganti. Kalau sudah cocok, setujui supaya aku buatkan gambarnya ya." },
    ];
    const storage = memoryStorage({ "laku:sessions:v1": JSON.stringify({ sessions: [{ id: "s", items: saved }], activeId: "s" }) });

    const { items } = loadWorkspace(storage).sessions[0];

    assert.deepEqual(
      items.map((item) => (item.kind === "user" || item.kind === "bot" ? item.text : "")),
      [
        "buat storyboard",
        SCENES_PROPOSED_MESSAGE,
        SCENE_REPLACED_MESSAGE,
        "Halo! Ada yang bisa kubantu?",
        "Sudah kuganti. Kalau sudah cocok, setujui supaya aku buatkan gambarnya ya.",
      ],
    );
  });

  it("keeps the single conversation saved before sessions existed as the first session", () => {
    const old: ThreadItem[] = [{ id: "a", kind: "user", text: "foto studio dong" }];
    const storage = memoryStorage({ "laku:conversation:v1": JSON.stringify(old) });

    const workspace = loadWorkspace(storage);

    assert.equal(workspace.sessions.length, 1);
    assert.deepEqual(workspace.sessions[0].items, old);
    assert.equal(workspace.activeId, workspace.sessions[0].id);
  });

  it("starts empty instead of failing when the saved data is broken", () => {
    for (const broken of ["{not json", "{}", '{"sessions":"x","activeId":1}', '{"sessions":[],"activeId":"a"}', "null"]) {
      const workspace = loadWorkspace(memoryStorage({ "laku:sessions:v1": broken }));

      assert.equal(workspace.sessions.length, 1, broken);
      assert.deepEqual(workspace.sessions[0].items, [], broken);
    }
    assert.equal(loadWorkspace(memoryStorage({ "laku:conversation:v1": "{not json" })).sessions.length, 1);
  });

  it("keeps working when the browser blocks or fills its storage", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };

    const workspace = loadWorkspace(blocked);
    assert.doesNotThrow(() => saveWorkspace(blocked, workspace));
    assert.doesNotThrow(() => saveWorkspace(undefined, workspace));
    assert.equal(loadWorkspace(undefined).sessions.length, 1);
  });

  it("forgets the oldest session once there are more than 30", () => {
    let workspace = loadWorkspace(memoryStorage());
    for (let n = 1; n <= 31; n++) {
      workspace = setActiveItems(workspace, [{ id: `m${n}`, kind: "user", text: `chat ${n}` }]);
      workspace = startSession(workspace);
    }

    assert.equal(workspace.sessions.length, 30);
    assert.equal(workspace.activeId, workspace.sessions[0].id);
    assert.deepEqual(workspace.sessions[0].items, []);
    assert.equal(describeSession(workspace.sessions[1]).title, "chat 31");
    assert.equal(describeSession(workspace.sessions[29]).title, "chat 3");
  });

  describe("storyboard shared between sessions", () => {
    const board = (id: string, sheet?: string, scenes = ["a", "b", "c", "d", "e", "f"], artDirection?: string): ThreadItem => ({
      id,
      kind: "scenes",
      sourceAssetId: "p",
      scenes,
      artDirection,
      sheet,
      approved: true,
    });
    const sessionWith = (id: string, ...items: ThreadItem[]): ChatSession => ({ id, items });

    it("lets a new session make a video from the newest storyboard of another session", () => {
      const workspace: Workspace = {
        sessions: [
          sessionWith("video", { id: "u", kind: "user", text: "video 10 detik" }),
          sessionWith("new", board("b2", "new-sheet", ["n-a", "n-b", "n-c", "n-d", "n-e", "n-f"], "neon look")),
          sessionWith("old", board("b1", "old-sheet")),
        ],
        activeId: "video",
      };

      // The look travels with the storyboard, so a video made in another chat is edited in the same style.
      assert.deepEqual(storyboardFor(workspace), {
        sheet: "new-sheet",
        scenes: ["n-a", "n-b", "n-c", "n-d", "n-e", "n-f"],
        artDirection: "neon look",
      });
    });

    it("prefers the storyboard of the session on screen", () => {
      const workspace: Workspace = {
        sessions: [sessionWith("here", board("b1", "mine")), sessionWith("other", board("b2", "theirs"))],
        activeId: "here",
      };

      assert.equal(storyboardFor(workspace).sheet, "mine");
    });

    it("ignores storyboards of other sessions that have no picture yet", () => {
      const workspace: Workspace = {
        sessions: [sessionWith("video"), sessionWith("draft", board("b1"))],
        activeId: "video",
      };

      assert.deepEqual(storyboardFor(workspace), { sheet: undefined, scenes: [], artDirection: undefined });
    });
  });

  it("does not save that the picture was still being drawn", () => {
    const storage = memoryStorage();
    const scenes: ThreadItem = { id: "c", kind: "scenes", sourceAssetId: "p", scenes: ["a", "b", "c", "d", "e", "f"], sheet: "f", busy: true, approved: true };

    saveWorkspace(storage, setActiveItems(loadWorkspace(storage), [scenes]));

    const [saved] = loadWorkspace(storage).sessions[0].items;
    assert.equal(saved.kind === "scenes" && saved.busy, undefined);
    assert.equal(saved.kind === "scenes" && saved.sheet, "f");
  });
});
