import type { ChatIntent } from "../../shared/chat-events";
import { describeSession, type Workspace } from "./saved-conversation";

const FEATURE_LABELS: Record<ChatIntent, string> = {
  studio_photo: "Foto Studio",
  storyboard: "Storyboard",
  video: "Video",
};

interface Props {
  workspace: Workspace;
  /** On narrow screens the list is a drawer; this says whether it is slid in. */
  open: boolean;
  /** Switching chats waits while a request is running. */
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

/** The sidebar: every saved chat, newest first, each labelled with the feature it was used for. */
export function SessionList({ workspace, open, disabled, onSelect, onNew, onClose }: Props) {
  return (
    <>
      {open && <button type="button" className="sessions-scrim" aria-label="Tutup riwayat" onClick={onClose} />}
      <aside className={`sessions${open ? " is-open" : ""}`} aria-label="Riwayat chat">
        <div className="sessions-head">
          <h2>Riwayat</h2>
          <button type="button" className="sessions-new" onClick={onNew} disabled={disabled}>
            + Sesi baru
          </button>
        </div>
        <ul>
          {workspace.sessions.map((session) => {
            const { title, feature } = describeSession(session);
            const current = session.id === workspace.activeId;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  className={`session${current ? " is-current" : ""}`}
                  aria-current={current ? "true" : undefined}
                  disabled={disabled && !current}
                  onClick={() => onSelect(session.id)}
                >
                  <span className="session-title">{title}</span>
                  {feature && <span className="session-feature">{FEATURE_LABELS[feature]}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </>
  );
}
