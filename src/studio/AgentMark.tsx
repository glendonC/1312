import { useEffect, useRef } from "react";

import { agentIdentityStyle, type AgentIdentity } from "./agentIdentity";
import { isAgentThinking, mountAgentMesh } from "./agentMeshRenderer";
import type { AgentStatus } from "./types";

interface AgentMarkProps {
  identity: AgentIdentity;
  status: AgentStatus;
  className?: string;
}

/**
 * The agent's identity surface. Its palette and topology come from lineage; status only changes
 * how that surface behaves. The surrounding node remains responsible for labels, selection,
 * focus, and every other semantic or interactive concern.
 */
export default function AgentMark({ identity, status, className }: AgentMarkProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const thinking = isAgentThinking(status);

  useEffect(() => {
    if (!canvas.current) return undefined;
    return mountAgentMesh(canvas.current, identity, status);
  }, [identity, status]);

  return (
    <span
      className={`agent-mark${className ? ` ${className}` : ""}`}
      data-agent-identity={identity.key}
      data-relation={identity.relation}
      data-role={identity.role}
      data-status={status}
      data-field-motion={thinking ? "thinking" : "still"}
      style={agentIdentityStyle(identity)}
      aria-hidden="true"
    >
      <span className="agent-mark-fallback" />
      <canvas ref={canvas} className="agent-mark-mesh" />
      <span className="agent-mark-grain" />
    </span>
  );
}
