export const styles = `
:host { all: initial; --brand: #4f46e5; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", "Noto Sans Kannada", sans-serif; }
* { box-sizing: border-box; }
.launcher { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; width: 58px; height: 58px; border-radius: 50%; border: 0; cursor: pointer;
  background: var(--brand); color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.22); display: grid; place-items: center; transition: transform .15s; }
.launcher:hover { transform: scale(1.05); }
.launcher.left, .panel.left { right: auto; left: 20px; }
.launcher .i-close, .launcher.open .i-chat { display: none; }
.launcher.open .i-close { display: block; }
.launcher.unread::after { content: ''; position: absolute; top: 4px; right: 4px; width: 12px; height: 12px; border-radius: 50%; background: #ef4444; border: 2px solid #fff; }
.panel { position: fixed; right: 20px; bottom: 90px; z-index: 2147483000; width: 380px; height: min(620px, calc(100vh - 110px)); background: #fff; color: #111827;
  border-radius: 18px; box-shadow: 0 16px 48px rgba(0,0,0,.24); display: flex; flex-direction: column; overflow: hidden;
  opacity: 0; pointer-events: none; transform: translateY(12px) scale(.98); transition: opacity .18s, transform .18s; font-size: 14px; line-height: 1.45; }
.panel.open { opacity: 1; pointer-events: auto; transform: none; }
header { background: var(--brand); color: #fff; padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
.avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,.22); display: grid; place-items: center; font-weight: 700; font-size: 12px; }
.titles { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.titles .sub { font-size: 12px; opacity: .85; }
.close { background: none; border: 0; color: #fff; font-size: 26px; cursor: pointer; line-height: 1; padding: 0 4px; }
.status { background: #fef3c7; color: #92400e; font-size: 12.5px; padding: 8px 14px; }
.log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: #f9fafb; }
.consent { font-size: 11.5px; color: #6b7280; text-align: center; margin: 2px 12px; }
.msg { display: flex; flex-direction: column; max-width: 85%; align-self: flex-start; }
.msg.customer { align-self: flex-end; align-items: flex-end; }
.bubble { padding: 9px 13px; border-radius: 16px; background: #fff; border: 1px solid #e5e7eb; word-wrap: break-word; overflow-wrap: anywhere; }
.msg.customer .bubble { background: var(--brand); color: #fff; border-color: transparent; border-bottom-right-radius: 4px; }
.msg.ai .bubble, .msg.agent .bubble { border-bottom-left-radius: 4px; }
.msg.agent .bubble { border-color: var(--brand); }
.bubble a { color: inherit; }
.who { font-size: 11px; color: #6b7280; margin: 0 0 3px 4px; }
.cites { font-size: 11.5px; color: #6b7280; margin: 5px 0 0 4px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.cite { background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 1px 8px; text-decoration: none; }
.feedback { font-size: 12px; color: #6b7280; margin: 6px 0 0 4px; display: flex; gap: 6px; align-items: center; }
.feedback button { border: 1px solid #e5e7eb; background: #fff; border-radius: 999px; padding: 2px 9px; cursor: pointer; font-size: 12px; }
.feedback button:hover { border-color: var(--brand); }
.typing { display: flex; gap: 4px; padding: 13px 14px; }
.typing i { width: 7px; height: 7px; border-radius: 50%; background: #9ca3af; animation: b 1.2s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
@keyframes b { 0%, 60%, 100% { transform: none; opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
.error { background: #fee2e2; color: #991b1b; font-size: 12.5px; padding: 8px 14px; }
.composer { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #e5e7eb; background: #fff; align-items: flex-end; }
textarea { flex: 1; resize: none; border: 1px solid #d1d5db; border-radius: 12px; padding: 9px 12px; font: inherit; outline: none; max-height: 120px; color: #111827; background: #fff; }
textarea:focus { border-color: var(--brand); }
.composer button { width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--brand); color: #fff; cursor: pointer; display: grid; place-items: center; flex: none; }
footer { display: flex; justify-content: center; gap: 6px; font-size: 11.5px; color: #9ca3af; padding: 6px 0 9px; background: #fff; }
footer button { background: none; border: 0; color: #4b5563; cursor: pointer; font: inherit; text-decoration: underline; padding: 0; }
footer a { color: #9ca3af; text-decoration: none; }
@media (max-width: 480px) {
  .panel { right: 0; left: 0; bottom: 0; width: 100%; height: 100%; border-radius: 0; }
  .panel.left { left: 0; }
  .launcher.open { display: none; }
}
`;
