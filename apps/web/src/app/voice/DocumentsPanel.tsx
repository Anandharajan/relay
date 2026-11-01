import { api } from "../../lib/api";
import type { Client, Doc } from "./model";
export function DocumentsPanel({
  clientId,
  client,
  docs,
  busy,
  readOnly,
  canDeleteClient,
  act,
  clientDeleted,
}: {
  clientId: string;
  client: Client | undefined;
  docs: Doc[] | null;
  busy: boolean;
  readOnly: boolean;
  canDeleteClient: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  clientDeleted: () => Promise<void>;
}) {
  return (
    <>
    <h3>Client documents</h3>
    <p className="vd-muted">
      Only this client’s files are searched. PDF, DOCX, text, Markdown,
      CSV or JSON. 20 MB each.
    </p>
    <label className="vd-upload">
      ＋ Add documents
      <input
        type="file"
        accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json"
        disabled={!clientId || busy || readOnly}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            void act(async () => {
              const form = new FormData();
              form.set("file", f);
              await api(`/api/voice/clients/${clientId}/documents`, {
                form,
              });
            });
          e.target.value = "";
        }}
      />
    </label>
    <div aria-live="polite">
      {docs?.map((d) => (
        <div className="vd-doc" key={d.id}>
          <div>
            <strong>{d.name}</strong>
            <small>
              {d.status === "ready"
                ? `${d.chunks} indexed passages`
                : d.status}
            </small>
            {d.error && <small className="vd-error">{d.error}</small>}
          </div>
          <button
            aria-label={`Delete ${d.name}`}
            disabled={readOnly || busy}
            onClick={() =>
              void act(() =>
                api(`/api/voice/documents/${d.id}`, { method: "DELETE" }),
              )
            }
          >
            ×
          </button>
        </div>
      ))}
    </div>
    {!docs?.length && (
      <p className="vd-empty">
        Add a guide, lesson, policy or client brief to give your agent
        context.
      </p>
    )}
    {client && canDeleteClient && (
      <button
        className="vd-text-button"
        onClick={() => {
          if (
            window.confirm(
              `Delete ${client.name}, all their files and replies?`,
            )
          )
            void act(async () => {
              await api(`/api/voice/clients/${clientId}`, {
                method: "DELETE",
              });
              await clientDeleted();
            });
        }}
      >
        Delete client and files
      </button>
    )}
    </>
  );
}
