"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  reconnectEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { NodePalette } from "./node-palette";
import { MobileBlockSheet } from "./mobile-block-sheet";
import { NodeConfigPanel } from "./node-config-panel";
import { createDeletableEdge, type EdgeInteractionHandlers } from "./edges/deletable-edge";
import { TriggerNode } from "./nodes/trigger-node";
import { TextNode } from "./nodes/text-node";
import { ImageNode } from "./nodes/image-node";
import { ButtonNode } from "./nodes/button-node";
import { DelayNode } from "./nodes/delay-node";
import { ConditionNode } from "./nodes/condition-node";
import { InputNode } from "./nodes/input-node";
import { ActionNode } from "./nodes/action-node";
import { VideoNode } from "./nodes/video-node";
import { AudioNode } from "./nodes/audio-node";
import { PaymentButtonNode } from "./nodes/payment-button-node";
import { UnmappedNode } from "./nodes/unmapped-node";
import { nodeColor, edgeMetaForHandle, isNodeIncomplete, validSourceHandles, buttonHandleIds, type ButtonLike } from "./flow-utils";
import { saveFlow } from "@/lib/actions/flow-actions";
import { LionMark } from "@/components/brand/lion-mark";
import type { FlowData, FlowNode, NodeType } from "@/lib/types/database";

export interface BundleOption {
  id: string;
  name: string;
}

export interface ProductOption {
  id: string;
  name: string;
  price: number;
  currency: string;
}

export interface MediaAssetOption {
  id: string;
  url: string;
  kind: "image" | "video";
  label: string | null;
}

interface FlowEditorProps {
  flowId: string;
  flowName: string;
  initialData: FlowData;
  botId: string;
  bundles: BundleOption[];
  products: ProductOption[];
  /** Mídias cadastradas na Biblioteca de Mídia do bot — usadas nos seletores de randomização. */
  mediaAssets?: MediaAssetOption[];
  /** Gateways de pagamento ativos no bot — cada nó de pagamento escolhe um. */
  enabledGateways?: string[];
  /** Libera os controles de randomização (owner ou assinante Premium). */
  canRandomize?: boolean;
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
  audio: AudioNode,
  payment_button: PaymentButtonNode,
  unmapped: UnmappedNode,
};

const defaultNodeData: Record<string, Record<string, unknown>> = {
  trigger: { trigger: "command", command: "/start" },
  text: { text: "Mensagem aqui..." },
  image: { image_url: "", caption: "" },
  button: { text: "Escolha uma opção:", buttons: [] },
  delay: { amount: 5, unit: "seconds" },
  condition: { field: "", operator: "equals", value: "" },
  input: { prompt: "Qual seu email?", variable: "email", validation: "email" },
  action: { action_type: "set_variable", variable: "", value: "" },
  video: { video_url: "", caption: "" },
  audio: { audio_url: "", caption: "", simulate_recording: true, recording_seconds: 2 },
  payment_button: { bundle_id: "", payment_timeout_minutes: 15, sale_type: "main" },
  unmapped: { kind: "unmapped" },
};

function generateNodeId(type: string) {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

function generateEdgeId() {
  return `e-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Aplica (ou remove) a decoração visual de uma aresta derivada do sourceHandle
 * (Sim/Não, Pagou/Não pagou...). Idempotente: reconexão pode trocar o handle,
 * então quando não há semântica a decoração antiga é removida e a aresta volta
 * pro visual do defaultEdgeOptions. Decoração é só UI — nunca vai pro banco.
 */
function decorateEdge(edge: Edge): Edge {
  const meta = edgeMetaForHandle(edge.sourceHandle);
  if (!meta) {
    if (edge.label === undefined && edge.style === undefined) return edge;
    const rest = { ...edge };
    delete rest.label;
    delete rest.style;
    delete rest.labelStyle;
    delete rest.labelShowBg;
    delete rest.labelBgStyle;
    delete rest.labelBgPadding;
    delete rest.labelBgBorderRadius;
    return rest;
  }
  return {
    ...edge,
    label: meta.label,
    style: { stroke: meta.color, strokeWidth: 2 },
    labelStyle: { fill: meta.color, fontSize: 11, fontWeight: 600 },
    labelShowBg: true,
    labelBgStyle: { fill: "var(--bg-elevated)", fillOpacity: 0.9 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 6,
  };
}

/**
 * Projeção canônica do fluxo — EXATAMENTE o que vai pro banco. Serve pro save
 * e pra comparação de dirty (nunca comparar os objetos crus do React Flow, que
 * carregam measured/selected/dragging e decoração de aresta).
 */
function projectFlow(nodes: Node[], edges: Edge[]): FlowData {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as FlowNode["type"],
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
}

function serializeFlow(nodes: Node[], edges: Edge[]): string {
  return JSON.stringify(projectFlow(nodes, edges));
}

// Chaves conferidas em node_modules/@xyflow/system/dist/esm/constants.d.ts
const ariaLabelConfig = {
  "controls.zoomIn.ariaLabel": "Aumentar zoom",
  "controls.zoomOut.ariaLabel": "Diminuir zoom",
  "controls.fitView.ariaLabel": "Ajustar visualização",
  "controls.interactive.ariaLabel": "Alternar edição",
  "minimap.ariaLabel": "Minimapa do fluxo",
  "handle.ariaLabel": "Conector",
  "node.a11yDescription.default":
    "Pressione Enter ou Espaço para selecionar o bloco. Use as setas para mover. Esc para sair.",
  "edge.a11yDescription.default": "Pressione Delete para remover a conexão.",
};

const HISTORY_LIMIT = 100;

type FlowSnapshot = { nodes: Node[]; edges: Edge[] };

function FlowEditorInner({ flowId, flowName, initialData, botId, bundles, products, mediaAssets = [], enabledGateways = [], canRandomize = false, saveAction, backUrl }: FlowEditorProps) {
  const router = useRouter();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialData.edges.map(decorateEdge));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [incompleteWarning, setIncompleteWarning] = useState<{ count: number; title: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false); // bottom sheet de blocos (mobile)
  // Contador só pra re-renderizar os botões de desfazer/refazer (as pilhas vivem em refs).
  const [, setHistoryVersion] = useState(0);

  // Painel lateral deriva do id — nunca guarda snapshot do nó (evita painel
  // fantasma exibindo dados velhos depois de editar/deletar).
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const nodeTypes = useMemo(() => nodeTypeComponents, []);

  // Refs espelhando o último estado RENDERIZADO — dentro de um mesmo evento
  // ainda apontam pro estado pré-mutação, que é exatamente o que o snapshot
  // de undo precisa capturar.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const selectedNodeIdRef = useRef(selectedNodeId);
  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  // ===== Undo / Redo =====
  const past = useRef<FlowSnapshot[]>([]);
  const future = useRef<FlowSnapshot[]>([]);
  // Trava por microtask: deletar um nó dispara onNodesDelete E onEdgesDelete
  // no mesmo tick — sem a trava viraria dois snapshots (dois Ctrl+Z pra voltar).
  const snapshotLockRef = useRef(false);

  const takeSnapshot = useCallback(() => {
    if (snapshotLockRef.current) return;
    snapshotLockRef.current = true;
    queueMicrotask(() => {
      snapshotLockRef.current = false;
    });
    past.current.push({
      nodes: structuredClone(nodesRef.current),
      edges: structuredClone(edgesRef.current),
    });
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push({
      nodes: structuredClone(nodesRef.current),
      edges: structuredClone(edgesRef.current),
    });
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setHistoryVersion((v) => v + 1);
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push({
      nodes: structuredClone(nodesRef.current),
      edges: structuredClone(edgesRef.current),
    });
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistoryVersion((v) => v + 1);
  }, [setNodes, setEdges]);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  // ===== Dirty tracking =====
  // Init preguiçoso: serializar em toda renderização seria desperdício.
  // Projeta o initialData cru (nodes como vieram, edges SEM decoração).
  const lastSavedRef = useRef<string | null>(null);
  if (lastSavedRef.current === null) {
    lastSavedRef.current = serializeFlow(initialData.nodes, initialData.edges);
  }

  useEffect(() => {
    setIsDirty(serializeFlow(nodes, edges) !== lastSavedRef.current);
  }, [nodes, edges]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Compat: alguns navegadores só mostram o diálogo com returnValue setado.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ===== Conexões =====
  const onConnect = useCallback(
    (connection: Connection) => {
      takeSnapshot();
      setEdges((eds) => {
        // Semântica n8n: 1 saída por handle — a nova conexão substitui a antiga.
        const pruned = eds.filter(
          (e) =>
            !(
              e.source === connection.source &&
              (e.sourceHandle ?? null) === (connection.sourceHandle ?? null)
            ),
        );
        const newEdge: Edge = {
          id: generateEdgeId(),
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
        };
        return addEdge(decorateEdge(newEdge), pruned);
      });
    },
    [setEdges, takeSnapshot],
  );

  const isValidConnection = useCallback((connection: Edge | Connection) => {
    if (!connection.source || !connection.target) return false;
    if (connection.source === connection.target) return false; // self-loop
    // Ciclo: BFS a partir do target seguindo as arestas — se alcançar o source,
    // a conexão fecharia um loop.
    const visited = new Set<string>([connection.target]);
    const queue = [connection.target];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === connection.source) return false;
      for (const e of edgesRef.current) {
        if (e.source === current && !visited.has(e.target)) {
          visited.add(e.target);
          queue.push(e.target);
        }
      }
    }
    return true;
  }, []);

  // ===== Reconexão de aresta (padrão n8n: arrastar ponta solta = deletar) =====
  const reconnectSuccessful = useRef(true);

  const onReconnectStart = useCallback(() => {
    reconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      reconnectSuccessful.current = true;
      takeSnapshot();
      // Re-decora tudo: a reconexão pode ter trocado o sourceHandle (ex.: de
      // "true" pra "false") e o rótulo antigo ficaria mentindo.
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds).map(decorateEdge));
    },
    [setEdges, takeSnapshot],
  );

  const onReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge) => {
      if (!reconnectSuccessful.current) {
        takeSnapshot();
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      }
      reconnectSuccessful.current = true;
    },
    [setEdges, takeSnapshot],
  );

  // ===== Aresta: remover ao passar o mouse (estilo n8n) =====
  // Passar sobre a linha (ou selecioná-la, pra quem não tem hover) revela um
  // "x" no meio pra apagar a conexão — sem isso a única forma de remover uma
  // aresta era selecionar + apertar Delete, nada descoberta na UI.
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  // Timeout de saída: o botão flutuante fica numa camada ACIMA do path SVG,
  // então mover o mouse da linha pro botão dispara onEdgeMouseLeave antes do
  // clique registrar. Um pequeno atraso (cancelável por qualquer re-entrada,
  // na linha OU no botão) evita o "x" sumir debaixo do cursor.
  const edgeHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEdgeHideTimeout = useCallback(() => {
    if (edgeHideTimeoutRef.current) {
      clearTimeout(edgeHideTimeoutRef.current);
      edgeHideTimeoutRef.current = null;
    }
  }, []);

  // Sem isso, sair da tela com o "x" prestes a sumir deixava o timeout vivo:
  // ele disparava depois do unmount e chamava setHoveredEdgeId numa instância
  // já desmontada.
  useEffect(() => clearEdgeHideTimeout, [clearEdgeHideTimeout]);

  const scheduleEdgeHide = useCallback(() => {
    clearEdgeHideTimeout();
    edgeHideTimeoutRef.current = setTimeout(() => setHoveredEdgeId(null), 200);
  }, [clearEdgeHideTimeout]);

  const onEdgeMouseEnter = useCallback(
    (_event: ReactMouseEvent, edge: Edge) => {
      clearEdgeHideTimeout();
      setHoveredEdgeId(edge.id);
    },
    [clearEdgeHideTimeout],
  );

  const onEdgeMouseLeave = useCallback(() => {
    scheduleEdgeHide();
  }, [scheduleEdgeHide]);

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      takeSnapshot();
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setHoveredEdgeId(null);
    },
    [setEdges, takeSnapshot],
  );

  // Ref sempre-atual: edgeTypes precisa de referência ESTÁVEL (useMemo com
  // deps vazias) pro React Flow não recriar handles a cada render, então os
  // handlers de fato usados pelo botão viajam por aqui em vez de props.
  const edgeInteractionHandlersRef = useRef<EdgeInteractionHandlers>({
    onDelete: handleDeleteEdge,
    onButtonEnter: clearEdgeHideTimeout,
    onButtonLeave: scheduleEdgeHide,
  });
  edgeInteractionHandlersRef.current = {
    onDelete: handleDeleteEdge,
    onButtonEnter: clearEdgeHideTimeout,
    onButtonLeave: scheduleEdgeHide,
  };

  const edgeTypes = useMemo(() => ({ default: createDeletableEdge(edgeInteractionHandlersRef) }), []);

  // Projeção só de exibição: marca a aresta sob o mouse com `data.hovered`
  // pro edge customizado revelar o botão. Nunca toca no estado real de
  // `edges` (o que salva/desfaz continua limpo, sem esse campo efêmero).
  const displayEdges = useMemo(
    () => (hoveredEdgeId ? edges.map((e) => (e.id === hoveredEdgeId ? { ...e, data: { ...e.data, hovered: true } } : e)) : edges),
    [edges, hoveredEdgeId],
  );

  // ===== Seleção derivada (alimenta o painel; funciona por clique E teclado) =====
  const onSelectionChange = useCallback(({ nodes: selected }: OnSelectionChangeParams) => {
    setSelectedNodeId(selected.length === 1 ? selected[0].id : null);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedNodeId(null);
    // Desmarca no RF também — senão clicar de novo no MESMO nó não dispara
    // onSelectionChange e o painel não reabre.
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
  }, [setNodes]);

  // ===== Criação de nós =====
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  // Cria um nó do tipo dado. Sem posição explícita (clique na paleta / sheet
  // mobile), nasce no centro VISÍVEL do canvas com leve jitter pra não empilhar
  // blocos exatamente um sobre o outro.
  const addNode = useCallback(
    (type: string, position?: { x: number; y: number }) => {
      takeSnapshot();
      const pos =
        position ??
        (() => {
          const bounds = reactFlowWrapper.current?.getBoundingClientRect();
          const center = bounds
            ? screenToFlowPosition({
                x: bounds.left + bounds.width / 2,
                y: bounds.top + bounds.height / 2,
              })
            : { x: 120, y: 120 };
          const n = nodesRef.current.length;
          return { x: center.x + (n % 3) * 28, y: center.y + (n % 3) * 22 };
        })();
      const newNode: FlowNode = {
        id: generateNodeId(type),
        type: type as NodeType,
        position: pos,
        data: { ...defaultNodeData[type] },
      };
      setNodes((nds) => [...nds, newNode]);
      return newNode;
    },
    [screenToFlowPosition, setNodes, takeSnapshot],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type) return;
      // screenToFlowPosition já desconta pan/zoom — coordenada de tela direto.
      addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addNode, screenToFlowPosition],
  );

  const handleMobilePick = useCallback(
    (type: string) => {
      const newNode = addNode(type);
      // Espera o RF medir o nó novo antes de centralizar nele (feedback de que
      // o bloco realmente entrou no canvas).
      window.setTimeout(() => {
        void fitView({ nodes: [{ id: newNode.id }], duration: 300, maxZoom: 1 });
      }, 80);
    },
    [addNode, fitView],
  );

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      // gatilho é único; duplicar um bloco não mapeado não faz sentido
      // (mesma regra que o painel usa pra esconder o botão "Duplicar").
      if (!node || node.type === "trigger" || node.type === "unmapped") return;
      takeSnapshot();
      const newNode: Node = {
        id: generateNodeId(node.type ?? "node"),
        type: node.type,
        position: { x: node.position.x + 32, y: node.position.y + 32 },
        data: structuredClone(node.data),
        selected: true,
      };
      setNodes((nds) => [
        ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
        newNode,
      ]);
      setSelectedNodeId(newNode.id);
    },
    [setNodes, takeSnapshot],
  );

  // ===== Edição de nó (merge-patch) + poda de arestas órfãs =====
  // Burst de edição: só snapshota de novo depois de 500ms sem editar o mesmo nó.
  const lastEditRef = useRef<{ nodeId: string; time: number }>({ nodeId: "", time: 0 });

  const handleUpdateNode = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return;
      // Decide poda ANTES dos setState (refs ainda apontam pro estado atual).
      const mergedData = { ...node.data, ...patch };

      // Botões: o handle do canvas deriva de btn.value (ou paid:/not_paid:
      // pro botão de pagamento — buttonHandleIds em flow-utils.ts, única
      // fonte de verdade compartilhada com button-node.tsx e
      // validSourceHandles). Editar "Valor"/"Ir para no" troca esse valor, e
      // sem isso a aresta já desenhada ficava presa ao handle ANTIGO — a
      // checagem de poda logo abaixo a via como "handle removido" e apagava
      // a conexão a cada edição de texto no botão. Renomeia o sourceHandle
      // da aresta existente em vez de podar: mesma conexão, handle acompanha
      // o novo valor.
      let renamedEdges = edgesRef.current;
      if (node.type === "button") {
        const oldButtons = Array.isArray(node.data.buttons) ? (node.data.buttons as ButtonLike[]) : [];
        const newButtons = Array.isArray(mergedData.buttons) ? (mergedData.buttons as ButtonLike[]) : [];
        const renameMap = new Map<string, string>();
        oldButtons.forEach((oldBtn, i) => {
          const newIndex = oldBtn.id ? newButtons.findIndex((b) => b.id === oldBtn.id) : i;
          const newBtn = newIndex >= 0 ? newButtons[newIndex] : undefined;
          if (!newBtn) return; // botão removido — a poda abaixo cuida da(s) aresta(s)
          const oldHandles = buttonHandleIds(oldBtn, i);
          const newHandles = buttonHandleIds(newBtn, newIndex);
          // Só renomeia handle-a-handle quando a CONTAGEM bate (mesmo
          // esquema — ação não mudou): 1-pra-1 (comum) ou 2-pra-2
          // (pagamento, paid/not_paid na mesma ordem). Ação mudou (virou ou
          // deixou de ser payment/open_url) → contagem diverge, não tem
          // correspondência 1:1 sensata; os handles antigos somem de
          // verdade e a poda (agora precisa, também via buttonHandleIds)
          // cuida deles.
          if (oldHandles.length === newHandles.length) {
            oldHandles.forEach((oldHandle, hi) => {
              const newHandle = newHandles[hi];
              if (oldHandle !== newHandle) renameMap.set(oldHandle, newHandle);
            });
          }
        });
        if (renameMap.size > 0) {
          renamedEdges = renamedEdges.map((e) =>
            e.source === nodeId && e.sourceHandle && renameMap.has(e.sourceHandle)
              ? { ...e, sourceHandle: renameMap.get(e.sourceHandle) }
              : e,
          );
        }
      }

      const valid = validSourceHandles(node.type, mergedData);
      const willPrune =
        valid !== null &&
        renamedEdges.some((e) => e.source === nodeId && e.sourceHandle && !valid.has(e.sourceHandle));
      const now = Date.now();
      const isNewBurst =
        lastEditRef.current.nodeId !== nodeId || now - lastEditRef.current.time > 500;
      lastEditRef.current = { nodeId, time: now };
      if (isNewBurst || willPrune) takeSnapshot();
      // Merge sobre o estado ATUAL dentro do updater — os forms mandam patch parcial.
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
      // Handle sumiu de vez (botão removido, sale_type trocado...) → a aresta
      // presa nele viraria conexão fantasma no funil. Poda já.
      const finalEdges =
        willPrune && valid
          ? renamedEdges.filter((e) => e.source !== nodeId || !e.sourceHandle || valid.has(e.sourceHandle))
          : renamedEdges;
      if (finalEdges !== edgesRef.current) {
        setEdges(finalEdges);
      }
    },
    [setNodes, setEdges, takeSnapshot],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node || node.type === "trigger") return; // gatilho nunca deletável
      takeSnapshot();
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
    },
    [setNodes, setEdges, takeSnapshot],
  );

  // Deleção via teclado (Backspace/Delete) passa por aqui — 1 snapshot por ação
  // (a trava de microtask deduplica nó+arestas do mesmo delete).
  const onGraphElementsDelete = useCallback(() => {
    takeSnapshot();
  }, [takeSnapshot]);

  const onBeforeDelete = useCallback(
    // Retornar boolean vetaria a EXCLUSÃO INTEIRA do lote quando o gatilho
    // estiver entre os selecionados (ex.: seleção em área que engloba o
    // gatilho + outros blocos) — o React Flow trata `false` como "não exclua
    // nada". Filtramos só o gatilho (e as arestas que dependiam dele) pra
    // deixar o resto do lote ser excluído normalmente.
    async ({ nodes: toDelete, edges: edgesToDelete }: { nodes: Node[]; edges: Edge[] }) => {
      const keepNodes = toDelete.filter((n) => n.type !== "trigger");
      if (keepNodes.length === toDelete.length) return { nodes: toDelete, edges: edgesToDelete };
      const keptIds = new Set(keepNodes.map((n) => n.id));
      const keepEdges = edgesToDelete.filter(
        (e) => keptIds.has(e.source) && keptIds.has(e.target),
      );
      return { nodes: keepNodes, edges: keepEdges };
    },
    [],
  );

  const onNodeDragStart = useCallback(() => {
    takeSnapshot();
  }, [takeSnapshot]);

  // ===== Salvar =====
  const savingRef = useRef(false);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    // Validação não bloqueante: salva mesmo assim, mas avisa o que falta.
    const incomplete = nodes
      .map((n) => isNodeIncomplete(n.type, n.data))
      .filter((reason): reason is string => reason !== null);
    setIncompleteWarning(
      incomplete.length > 0
        ? { count: incomplete.length, title: incomplete.join("\n") }
        : null,
    );
    try {
      const flowData = projectFlow(nodes, edges);
      const saveFn = saveAction ?? saveFlow;
      const res = await saveFn(flowId, flowData);
      if (!res?.success) {
        setSaveError("Erro ao salvar. Tente novamente.");
        return;
      }
      lastSavedRef.current = JSON.stringify(flowData);
      setIsDirty(false);
      setLastSaved(new Date().toLocaleTimeString("pt-BR"));
    } catch (error) {
      console.error("Failed to save flow:", error);
      setSaveError("Erro ao salvar. Tente novamente.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [flowId, nodes, edges, saveAction]);

  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  // ===== Atalhos globais (undo/redo/duplicar/salvar) =====
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const inEditable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          !!target.closest("[contenteditable]"));
      if (key === "s") {
        // Salvar funciona até com foco num campo (padrão de editores).
        event.preventDefault();
        void handleSaveRef.current();
        return;
      }
      if (inEditable) return; // preserva undo/redo nativos dos campos de texto
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (key === "d") {
        event.preventDefault();
        if (selectedNodeIdRef.current) duplicateNode(selectedNodeIdRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, duplicateNode]);

  // ===== Navegação de volta com guarda de alterações não salvas =====
  const handleBack = useCallback(() => {
    if (isDirty && !window.confirm("Sair sem salvar as alterações?")) return;
    router.push(backUrl ?? `/dashboard/bots/${botId}/flows`);
  }, [isDirty, router, backUrl, botId]);

  // Projeção dos nós pro painel de config (ex.: seletor de "pular para bloco").
  const flowNodesProjection = useMemo(
    () => nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
    [nodes],
  );

  const iconButtonClass =
    "w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/6 disabled:opacity-35 disabled:pointer-events-none";
  const iconButtonStyle = {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid var(--border-subtle)",
  } as const;

  return (
    <div className="flex flex-col md:flex-row h-[100dvh]" style={{ background: "var(--bg-root)" }}>
      <NodePalette onAdd={(type) => addNode(type)} />

      <div className="flex-1 flex flex-col">
        {/* Top bar — pt-safe + box-content: os botões (voltar/logo/salvar) ficam
            ABAIXO do notch/Dynamic Island no iPhone. */}
        <div
          className="h-14 pt-safe box-content flex items-center justify-between px-5 relative"
          style={{
            background: "linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-root) 100%)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {/* Ambient glow line */}
          <div className="absolute top-0 left-[20%] right-[20%] h-px bg-linear-to-r from-transparent via-(--accent)/20 to-transparent" />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              aria-label="Voltar para a lista de fluxos"
              className={iconButtonClass}
              style={iconButtonStyle}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-2.5">
              <LionMark size={24} glow={false} />
              <h2 className="text-foreground font-semibold text-sm tracking-tight">{flowName}</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                aria-label="Desfazer"
                className={iconButtonClass}
                style={iconButtonStyle}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14L4 9l5-5" />
                  <path d="M20 20v-7a4 4 0 00-4-4H4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                aria-label="Refazer"
                className={iconButtonClass}
                style={iconButtonStyle}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 14l5-5-5-5" />
                  <path d="M4 20v-7a4 4 0 014-4h12" />
                </svg>
              </button>
            </div>

            {incompleteWarning && (
              <span
                title={incompleteWarning.title}
                className="hidden sm:flex text-(--amber) text-xs font-medium items-center gap-1.5 px-2 py-1 rounded-md"
                style={{
                  background: "color-mix(in srgb, var(--amber) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {incompleteWarning.count === 1
                  ? "1 bloco incompleto"
                  : `${incompleteWarning.count} blocos incompletos`}
              </span>
            )}

            <div role="alert">
              {saveError && (
                <span className="text-(--red) text-xs font-medium flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {saveError}
                </span>
              )}
            </div>
            <div role="status" aria-live="polite">
              {!saveError && isDirty && (
                <span className="text-(--amber) text-xs">Alterações não salvas</span>
              )}
              {!saveError && !isDirty && lastSaved && (
                <span className="text-(--text-secondary) text-xs flex items-center gap-1.5 stat-value">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                  Salvo às {lastSaved}
                </span>
              )}
            </div>

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
        <div ref={reactFlowWrapper} className="flex-1 flow-canvas relative">
          {/* Botão "+" flutuante (mobile): abre o sheet de blocos. No celular não
              dá pra arrastar, então adiciona por toque. */}
          <button
            onClick={() => setPaletteOpen(true)}
            aria-label="Adicionar bloco"
            className="md:hidden absolute bottom-5 right-5 z-20 w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform"
            style={{
              background: "linear-gradient(135deg, var(--accent), var(--purple))",
              boxShadow: "0 8px 24px -6px var(--accent-glow), 0 0 0 1px rgba(255,255,255,0.08) inset",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Empty state: só o gatilho no canvas, nenhuma conexão ainda. */}
          {nodes.length <= 1 && edges.length === 0 && (
            <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-center px-6">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-ghost)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="18" cy="18" r="3" />
                  <path d="M8.2 8.2l7.6 7.6" strokeDasharray="2 3" />
                </svg>
                <p className="text-sm text-(--text-secondary) font-medium">Monte seu fluxo</p>
                <p className="hidden md:block text-xs text-(--text-muted)">
                  Arraste ou clique nos blocos da paleta à esquerda
                </p>
                <p className="md:hidden text-xs text-(--text-muted)">
                  Toque no + para adicionar blocos
                </p>
              </div>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onReconnect={onReconnect}
            onReconnectStart={onReconnectStart}
            onReconnectEnd={onReconnectEnd}
            onEdgeMouseEnter={onEdgeMouseEnter}
            onEdgeMouseLeave={onEdgeMouseLeave}
            onSelectionChange={onSelectionChange}
            onNodeDragStart={onNodeDragStart}
            onNodesDelete={onGraphElementsDelete}
            onEdgesDelete={onGraphElementsDelete}
            onBeforeDelete={onBeforeDelete}
            deleteKeyCode={["Backspace", "Delete"]}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.1}
            maxZoom={2}
            snapToGrid
            snapGrid={[12, 12]}
            connectionRadius={40}
            ariaLabelConfig={ariaLabelConfig}
            style={{ background: "var(--bg-root)" }}
            defaultEdgeOptions={{
              style: { stroke: "var(--accent)", strokeWidth: 2 },
            }}
          >
            <Controls className="rounded-xl! border-0! overflow-hidden! shadow-lg! [&>button]:border-0! [&>button]:text-(--text-muted)! [&>button:hover]:text-foreground!" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-md)" }} />
            <MiniMap
              className="hidden! md:block! rounded-xl! border-0! overflow-hidden!"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-md)" }}
              pannable
              zoomable
              nodeColor={(n) => nodeColor(n.type)}
              maskColor="color-mix(in srgb, var(--bg-root) 78%, transparent)"
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
        onClose={handleClosePanel}
        onDelete={handleDeleteNode}
        onDuplicate={duplicateNode}
        flowNodes={flowNodesProjection}
        bundles={bundles}
        products={products}
        mediaAssets={mediaAssets}
        enabledGateways={enabledGateways}
        canRandomize={canRandomize}
      />

      {/* Mobile: sheet de blocos (toque pra adicionar) */}
      <MobileBlockSheet
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={handleMobilePick}
      />
    </div>
  );
}

/**
 * Wrapper com ReactFlowProvider — necessário pro useReactFlow do inner
 * (screenToFlowPosition converte coordenadas de tela em coordenadas do fluxo
 * respeitando pan/zoom; sem isso o drop caía no lugar errado).
 */
export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
