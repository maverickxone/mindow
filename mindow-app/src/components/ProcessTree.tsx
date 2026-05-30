import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ProcessInfo, ProcessTreeNode } from "../types";

/** 格式化字节为人类可读格式 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 格式化 CPU 百分比 */
function formatCpu(percent: number): string {
  return percent < 0.1 ? "0" : percent.toFixed(1);
}

/** 从扁平进程列表构建进程树（前端侧构建） */
export function buildProcessTree(processes: ProcessInfo[]): ProcessTreeNode[] {
  const pidSet = new Set(processes.map((p) => p.pid));
  const childrenMap = new Map<number, number[]>();
  const roots: number[] = [];

  for (let i = 0; i < processes.length; i++) {
    const proc = processes[i];
    const ppid = proc.parent_pid;
    if (ppid != null && pidSet.has(ppid) && ppid !== proc.pid) {
      const existing = childrenMap.get(ppid);
      if (existing) {
        existing.push(i);
      } else {
        childrenMap.set(ppid, [i]);
      }
    } else {
      roots.push(i);
    }
  }

  function buildNode(idx: number): ProcessTreeNode {
    const process = processes[idx];
    const childIndices = childrenMap.get(process.pid) || [];
    const children = childIndices.map((ci) => buildNode(ci));

    const childrenCpu = children.reduce((sum, c) => sum + c.aggregated_cpu, 0);
    const childrenMemory = children.reduce((sum, c) => sum + c.aggregated_memory, 0);

    return {
      process,
      children,
      aggregated_cpu: process.cpu_percent + childrenCpu,
      aggregated_memory: process.memory_bytes + childrenMemory,
    };
  }

  return roots.map((idx) => buildNode(idx));
}

interface ProcessTreeProps {
  processes: ProcessInfo[];
  selectedPid: number | null;
  onSelectProcess: (pid: number | null) => void;
}

export function ProcessTree({ processes, selectedPid, onSelectProcess }: ProcessTreeProps) {
  const { t } = useTranslation();
  const [expandedPids, setExpandedPids] = useState<Set<number>>(new Set());

  const tree = useMemo(() => buildProcessTree(processes), [processes]);

  const toggleExpand = useCallback((pid: number) => {
    setExpandedPids((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* 表头 */}
      <div className="flex items-center px-3 py-2 bg-secondary border-b border-border text-text-secondary text-xs font-medium shrink-0">
        <div className="flex-[2] px-1">{t("processes.columns.name")}</div>
        <div className="w-20 px-1">{t("processes.columns.pid")}</div>
        <div className="w-20 px-1">{t("processes.columns.cpu")}</div>
        <div className="w-24 px-1">{t("processes.columns.memory")}</div>
        <div className="w-24 px-1">{t("processes.columns.cpu")}∑</div>
        <div className="w-24 px-1">{t("processes.columns.memory")}∑</div>
      </div>

      {/* 树形内容 */}
      <div className="flex-1 overflow-auto">
        {tree.map((node) => (
          <TreeNodeRow
            key={node.process.pid}
            node={node}
            depth={0}
            expandedPids={expandedPids}
            selectedPid={selectedPid}
            onToggleExpand={toggleExpand}
            onSelect={onSelectProcess}
          />
        ))}
      </div>
    </div>
  );
}

interface TreeNodeRowProps {
  node: ProcessTreeNode;
  depth: number;
  expandedPids: Set<number>;
  selectedPid: number | null;
  onToggleExpand: (pid: number) => void;
  onSelect: (pid: number | null) => void;
}

function TreeNodeRow({
  node,
  depth,
  expandedPids,
  selectedPid,
  onToggleExpand,
  onSelect,
}: TreeNodeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedPids.has(node.process.pid);
  const isSelected = node.process.pid === selectedPid;

  return (
    <>
      <div
        className={`flex items-center px-3 h-9 text-xs cursor-pointer border-b border-border/50 transition-colors
          ${isSelected ? "bg-accent-info/10 text-accent-info" : "hover:bg-tertiary text-text-primary"}`}
        onClick={() => onSelect(isSelected ? null : node.process.pid)}
      >
        {/* 名称列 + 缩进 + 展开/折叠按钮 */}
        <div className="flex-[2] px-1 flex items-center truncate">
          <span style={{ width: `${depth * 16}px` }} className="shrink-0" />
          {hasChildren ? (
            <button
              className="w-4 h-4 flex items-center justify-center text-text-secondary hover:text-text-primary shrink-0 mr-1"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.process.pid);
              }}
              aria-label={isExpanded ? "折叠" : "展开"}
            >
              <span
                className="inline-block transition-transform duration-150"
                style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                ▶
              </span>
            </button>
          ) : (
            <span className="w-4 h-4 shrink-0 mr-1" />
          )}
          <span className="truncate">{node.process.name}</span>
          {hasChildren && (
            <span className="ml-1 text-text-muted">({node.children.length})</span>
          )}
        </div>

        <div className="w-20 px-1 text-text-secondary">{node.process.pid}</div>
        <div className="w-20 px-1 text-text-secondary">{formatCpu(node.process.cpu_percent)}</div>
        <div className="w-24 px-1 text-text-secondary">{formatBytes(node.process.memory_bytes)}</div>

        {/* 汇总列 — 仅对有子进程的节点显示差异值 */}
        <div className="w-24 px-1 text-text-secondary">
          {hasChildren ? formatCpu(node.aggregated_cpu) : "—"}
        </div>
        <div className="w-24 px-1 text-text-secondary">
          {hasChildren ? formatBytes(node.aggregated_memory) : "—"}
        </div>
      </div>

      {/* 子节点递归渲染 */}
      {isExpanded &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.process.pid}
            node={child}
            depth={depth + 1}
            expandedPids={expandedPids}
            selectedPid={selectedPid}
            onToggleExpand={onToggleExpand}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}
