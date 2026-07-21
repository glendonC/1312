import { useEffect, useRef } from "react";

import { agentIdentityStyle, type AgentIdentity } from "./agentIdentity";
import {
  isAgentThinking,
  mountAgentMesh,
  type AgentMeshHandle,
} from "./agentMeshRenderer";
import type { AgentStatus } from "./types";

interface AgentMarkProps {
  identity: AgentIdentity;
  status: AgentStatus;
  className?: string;
  fieldMotion?: "auto" | "still";
}

/**
 * The agent's identity surface. Its palette and topology come from lineage; status only changes
 * how that surface behaves. The surrounding node remains responsible for labels, selection,
 * focus, and every other semantic or interactive concern.
 */
export default function AgentMark({
  identity,
  status,
  className,
  fieldMotion = "auto",
}: AgentMarkProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mesh = useRef<AgentMeshHandle | null>(null);
  const initialRenderState = useRef({ status, fieldMotion });
  initialRenderState.current = { status, fieldMotion };
  const thinking = isAgentThinking(status);
  const moving = thinking && fieldMotion === "auto";

  useEffect(() => {
    if (!canvas.current) return undefined;
    const handle = mountAgentMesh(
      canvas.current,
      identity,
      initialRenderState.current.status,
      initialRenderState.current.fieldMotion,
    );
    mesh.current = handle;
    return () => {
      handle.dispose();
      if (mesh.current === handle) mesh.current = null;
    };
  }, []);

  useEffect(() => {
    mesh.current?.updateIdentity(identity);
  }, [identity]);

  return (
    <span
      className={`agent-mark${className ? ` ${className}` : ""}`}
      data-agent-identity={identity.key}
      data-relation={identity.relation}
      data-role={identity.role}
      data-topology={identity.topology}
      data-status={status}
      data-field-motion={moving ? "thinking" : "still"}
      style={agentIdentityStyle(identity)}
      aria-hidden="true"
    >
      <span className="agent-mark-fallback" />
      <canvas
        ref={canvas}
        className="agent-mark-mesh"
        data-agent-status={status}
        data-motion-policy={fieldMotion}
      />
      <span className="agent-mark-grain" />
    </span>
  );
}
