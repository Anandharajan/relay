import { ctx } from "../../ctx.ts";
import { voiceChanged } from "./catalog.ts";
type AgentId = "listen" | "plan" | "research" | "write" | "verify" | "speak";
type AgentStatus = "waiting" | "working" | "done" | "failed" | "skipped";
interface AgentStep {
  id: AgentId;
  role: string;
  action: string;
  stage: number;
  status: AgentStatus;
  ms?: number;
  result?: string;
  startedAt?: number;
}
const team: [AgentId, string, string][] = [
  ["listen", "Transcriber", "Turning your recording into text"],
  ["plan", "Planner", "Deciding what to read and whether anything is unclear"],
  ["research", "Researcher", "Searching only this client’s documents"],
  ["write", "Writer", "Drafting a sourced reply"],
  ["verify", "Verifier", "Checking every claim against its source"],
  ["speak", "Voice", "Generating speech in your authorized voice"],
];
function freshBoard(): AgentStep[] {
  return team.map(([id, role, action], stage) => ({
    id,
    role,
    action,
    stage,
    status: "waiting",
  }));
}
/** The run's agent board, saved on each change so the desk can show it live. */
export function boardFor(runId: string, orgId: string, steps: AgentStep[]) {
  const board: AgentStep[] = steps?.some((s) => s.id) ? steps : freshBoard();
  const agent = (id: AgentId) => board.find((a) => a.id === id)!;
  const save = async (status?: string) => {
    await ctx.db.query(
      "update voice_runs set status=coalesce($3,status),steps=$4::jsonb,updated_at=now() where id=$1 and org_id=$2",
      [runId, orgId, status ?? null, board],
    );
    voiceChanged(orgId);
  };
  const settle = (id: AgentId, result: string, status: AgentStatus) => {
    const a = agent(id);
    a.status = status;
    a.result = result;
    if (a.startedAt) a.ms = Date.now() - a.startedAt;
  };
  return {
    board,
    save,
    settle,
    async start(id: AgentId, status: string, action?: string) {
      const a = agent(id);
      a.status = "working";
      a.startedAt = Date.now();
      if (action) a.action = action;
      await save(status);
    },
    async finish(id: AgentId, result: string, status: AgentStatus = "done") {
      settle(id, result, status);
      await save();
    },
    /** Marks whichever agent was working as failed; the caller records the error. */
    async fail(message: string) {
      for (const a of board)
        if (a.status === "working") settle(a.id, message.slice(0, 200), "failed");
      await save();
    },
  };
}
