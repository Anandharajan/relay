import { useState } from 'react';
import { PatientChat } from '../tour/PatientChat';

const suggestions = ['Book Dr. Narmadha tomorrow', '1', 'Priya Raman', 'Can I stop my BP tablet?', 'I have bleeding, 7 months pregnant'];

/**
 * A collapsible patient chatbot on the workspace, for demo and sandbox workspaces: type as a patient
 * and watch the doctor's agents work on the Live desk. Stays mounted while collapsed so the chat continues.
 */
export function ChatDock({ siteKey, defaultOpen = false }: { siteKey: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`chat-dock ${open ? 'open' : ''}`}>
      <div className="chat-dock-panel" hidden={!open}>
        <div className="row between chat-dock-bar">
          <span className="small"><strong>Patient chatbot</strong> · type as a patient (fictional)</span>
          <button className="btn sm ghost" onClick={() => setOpen(false)} aria-label="Collapse patient chat">▾</button>
        </div>
        <PatientChat siteKey={siteKey} suggestions={suggestions} title="Poonthalir Hospital" />
      </div>
      {!open && <button className="btn primary chat-dock-launch" onClick={() => setOpen(true)}>💬 Patient chatbot</button>}
    </div>
  );
}
