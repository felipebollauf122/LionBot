"use client";

import { useCallback, useState, useRef, useMemo, type DragEvent } from "react";
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { NodePalette } from "./node-palette";
import { NodeConfigPanel } from "./node-config-panel";
import { TriggerNode } from "./nodes/trigger-node";
import { TextNode } from "./nodes/text-node";
import { ImageNode } from "./nodes/image-node";
import { ButtonNode } from "./nodes/button-node";
import { DelayNode } from "./nodes/delay-node";
import { ConditionNode } from "./nodes/condition-node";
import { InputNode } from "./nodes/input-node";
import { ActionNode } from "./nodes/action-node";
import { VideoNode } from "./nodes/video-node";
import { PaymentButtonNode } from "./nodes/payment-button-node";
import { saveFlow } from "@/lib/actions/flow-actions";
import { LionMark } from "@/components/brand/lion-mark";
import type { FlowData, FlowNode, NodeType } from "@/lib/types/database";

export interface BundleOption {
  id: string;
  name: string;
}

interface FlowEditorProps {
  flowId: string;
  flowName: string;
  initialData: FlowData;
  botId: string;
  bundles: BundleOption[];
  saveAction?: (flowId: string, flowData: FlowData) => Promise<{ success: boolean }>;
  backUrl?: string;
}

const nodeTypeComponents = {
  trigger: TriggerNode,
  text: TextNode,
  image: ImageNode,
  button: ButtonNode,
  delay: DelayNode,
  condition: ConditionNode,
  input: InputNode,
  action: ActionNode,
  video: VideoNode,
  payment_button: PaymentButtonNode,
};

const defaultNodeData: Record<string, Record<string, unknown>> = {
  trigger: { trigger: "command", command: "/start" },
  text: { text: "Mensagem aqui..." },
  image: { image_url: "", caption: "" },
  button: { text: "Escolha uma opção:", buttons: [] },
  delay: { amount: 5, unit: "seconds" },
  condition: { field: "", operator: "equals", value: "" },
  input: { prompt: "Qual seu email?", variable: "email" },
  action: { action_type: "set_variable", variable: "", value: "" },
  video: { video_url: "", caption: "" },
  payment_button: { bundle_id: "", payment_timeout_minutes: 15 },
};

let nodeIdCounter = 0;
function generateNodeId(type: string) {
  nodeIdCounter++;
  return `${type}-${Date.now()}-${nodeIdCounter}`;
}

export function FlowEditor({ flowId, flowName, initialData, botId, bundles, saveAction, backUrl }: FlowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialData.edges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const nodeTypes = useMemo(() => nodeTypeComponents, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, id: `e-${Date.now()}` }, eds));
    },
    [setEdges],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node);
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");
      if (!type || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };

      const newNode: FlowNode = {
        id: generateNodeId(type),
        type: type as NodeType,
        position,
        data: { ...defaultNodeData[type] },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
  );

  const handleUpdateNode = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...data } } : n)),
      );
      setSelectedNode((prev) =>
        prev && prev.id === nodeId ? { ...prev, data: { ...data } } : prev,
      );
    },
    [setNodes],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
    },
    [setNodes, setEdges],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const flowData: FlowData = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type as FlowData["nodes"][0]["type"],
          data: n.data,
          position: n.position,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
        })),
      };
      const saveFn = saveAction ?? saveFlow;
      await saveFn(flowId, flowData);
      setLastSaved(new Date().toLocaleTimeString("pt-BR"));
    } catch (error) {
      console.error("Failed to save flow:", error);
      setSaveError("Erro ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }, [flowId, nodes, edges, saveAction]);

  return (
    <div className="flex h-screen" style={{ background: "var(--bg-root)" }}>
      <NodePalette />

      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div
          className="h-14 flex items-center justify-between px-5 relative"
          style={{
            background: "linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-root) 100%)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {/* Ambient glow line */}
          <div className="absolute top-0 left-[20%] right-[20%] h-px bg-linear-to-r from-transparent via-(--accent)/20 to-transparent" />

          <div className="flex items-center gap-3">
            <a
              href={backUrl ?? `/dashboard/bots/${botId}/flows`}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/6"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-subtle)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </a>
            <div className="flex items-center gap-2.5">
              <LionMark size={24} glow={false} />
              <h2 className="text-foreground font-semibold text-sm tracking-tight">{flowName}</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saveError && (
              <span className="text-(--red) text-xs font-medium flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {saveError}
              </span>
            )}
            {lastSaved && !saveError && (
              <span className="text-(--text-ghost) text-xs flex items-center gap-1.5 stat-value">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                Salvo as {lastSaved}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary py-2! px-4! text-xs!"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin">
                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                  </svg>
                  Salvando...
                </span>
              ) : "Salvar"}
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div ref={reactFlowWrapper} className="flex-1 flow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            fitView
            style={{ background: "var(--bg-root)" }}
            defaultEdgeOptions={{
              style: { stroke: "var(--accent)", strokeWidth: 2 },
              animated: true,
            }}
          >
            <Controls className="rounded-xl! border-0! overflow-hidden! shadow-lg! [&>button]:border-0! [&>button]:text-(--text-muted)! [&>button:hover]:text-foreground!" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-md)" }} />
            <MiniMap
              className="rounded-xl! border-0! overflow-hidden!"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-md)" }}
              nodeColor="var(--accent)"
              maskColor="rgba(7,4,13,0.78)"
            />
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="rgba(255,255,255,0.035)"
            />
          </ReactFlow>
        </div>
      </div>

      <NodeConfigPanel
        node={selectedNode}
        onUpdate={handleUpdateNode}
        onClose={() => setSelectedNode(null)}
        onDelete={handleDeleteNode}
        bundles={bundles}
      />
    </div>
  );
}
