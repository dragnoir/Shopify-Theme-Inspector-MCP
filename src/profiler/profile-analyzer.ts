import { ProfilingData, ProfileSummary, ProfileNode, SlowNode, TemplateStats } from "./flamegraph-parser.js";

/**
 * Analyze profiling data to produce a summary of performance metrics,
 * slow nodes, and template breakdown.
 */
export function analyzeProfile(data: ProfilingData): ProfileSummary {
  // Check if this is basic profiling data (Server-Timing only)
  if (data.raw?.type === "basic") {
    return analyzeBasicProfile(data);
  }

  // Otherwise, assume it's a Liquid flame graph
  return analyzeLiquidProfile(data);
}

/**
 * Analyze basic profiling data (Server-Timing)
 */
function analyzeBasicProfile(data: ProfilingData): ProfileSummary {
  const entries: any[] = data.raw.serverTiming || [];
  
  // Map Server-Timing entries to "SlowNodes" for display
  const slowNodes: SlowNode[] = entries.map((e: any) => ({
    name: e.name || "unknown",
    type: "server-timing",
    time: e.duration || 0,
    percentage: data.totalTime > 0 ? ((e.duration || 0) / data.totalTime) * 100 : 0
  })).sort((a, b) => b.time - a.time);

  return {
    timestamp: data.timestamp,
    totalRenderTime: data.totalTime,
    nodeCount: data.nodeCount,
    topSlowNodes: slowNodes,
    templateBreakdown: [], // No template breakdown possible with basic data
  };
}

/**
 * Analyze detailed Liquid profiling data
 */
function analyzeLiquidProfile(data: ProfilingData): ProfileSummary {
  const root = data.tree; // Assumes tree is already normalized to ProfileNode-like structure or needs parsing?
  // page-profiler.ts normalizeProfilingData returns 'tree' as the raw object usually.
  // We might need to recursively traverse it.
  
  const allNodes: ProfileNode[] = [];
  collectNodes(root, allNodes);

  // Calculate self times if not present, and total times
  // Note: structured data usually has totalTime. selfTime might typically be derived.
  // But for now let's assume valid data.

  // Find slow nodes
  const sortedNodes = [...allNodes].sort((a, b) => (b.time || 0) - (a.time || 0));
  const topSlowNodes: SlowNode[] = sortedNodes.slice(0, 10).map(node => ({
    name: node.name,
    type: node.type || "unknown",
    file: node.file,
    line: node.line,
    time: node.time,
    percentage: data.totalTime > 0 ? (node.time / data.totalTime) * 100 : 0
  }));

  // Template breakdown
  const templateStats = new Map<string, TemplateStats>();
  
  for (const node of allNodes) {
    if (node.file) {
        const file = node.file;
        const existing = templateStats.get(file) || {
            file,
            renders: 0,
            totalTime: 0,
            selfTime: 0,
            percentage: 0
        };
        
        existing.renders++;
        existing.selfTime += node.time || 0;
        // totalTime for a template is tricky if it's recursive or included multiple times.
        // We'll just sum selfTime for now as the most accurate metric of "time spent in this file's code specifically".
        
        templateStats.set(file, existing);
    }
  }

  const breakdown: TemplateStats[] = Array.from(templateStats.values())
    .map(stat => ({
        ...stat,
        totalTime: stat.selfTime, // Approximation
        percentage: data.totalTime > 0 ? (stat.selfTime / data.totalTime) * 100 : 0
    }))
    .sort((a, b) => b.selfTime - a.selfTime);

  return {
    timestamp: data.timestamp,
    totalRenderTime: data.totalTime,
    nodeCount: data.nodeCount,
    topSlowNodes,
    templateBreakdown: breakdown
  };
}

function collectNodes(node: any, collection: ProfileNode[]) {
    if (!node) return;
    
    // If the node is already a ProfileNode, we can use it directly
    // But we might want to ensure we have a flat list for analysis
    
    // The node from parseProfilingTree should conform to ProfileNode
    const normalized: ProfileNode = {
        name: node.name,
        type: node.type,
        time: node.time,
        totalTime: node.totalTime,
        file: node.file,
        line: node.line,
        children: [] // We don't need children in the flat list for aggregation
    };
    
    collection.push(normalized);
    
    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            collectNodes(child, collection);
        }
    }
}

function inferType(name: string): string {
    if (name.includes(".liquid")) return "template";
    if (name.includes("Section")) return "section";
    return "code";
}
