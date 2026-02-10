/**
 * Flame graph data types and parser for Shopify Liquid profiling data.
 */

// ============================================================================
// Data Types
// ============================================================================

export interface ProfileResult {
  success: boolean;
  storeUrl: string;
  pagePath: string;
  profileUrl?: string;
  error?: string;
  data?: ProfilingData;
}

export interface ProfilingData {
  timestamp: string;
  totalTime: number;    // Total render time in ms
  nodeCount: number;    // Number of profiling nodes
  raw: any;             // Raw data from Shopify
  tree: any;            // Hierarchical node tree
}

export interface ProfileNode {
  name: string;
  type: string;         // e.g., 'template', 'section', 'snippet', 'block', 'tag'
  file?: string;        // Liquid file path
  line?: number;        // Line number in file
  time: number;         // Render time in ms (self time)
  totalTime: number;    // Total time including children
  children: ProfileNode[];
}

export interface ProfileSummary {
  totalRenderTime: number;
  nodeCount: number;
  topSlowNodes: SlowNode[];
  templateBreakdown: TemplateStats[];
  timestamp: string;
}

export interface SlowNode {
  name: string;
  type: string;
  file?: string;
  line?: number;
  time: number;
  percentage: number;
}

export interface TemplateStats {
  file: string;
  renders: number;
  totalTime: number;
  selfTime: number;
  percentage: number;
}

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse raw profiling data into a structured ProfileNode tree
 */
export function parseProfilingTree(rawData: any): ProfileNode {
  if (!rawData) {
    return createEmptyNode("root");
  }

  return parseNode(rawData, "root");
}

function parseNode(data: any, defaultName: string): ProfileNode {
  if (!data || typeof data !== "object") {
    return createEmptyNode(defaultName);
  }

  const name = data.name || data.label || data.code || defaultName;
  const time = data.time || data.self_time || data.selfTime || data.duration || 0;
  const totalTime = data.totalTime || data.total_time || data.duration || time;
  const type = inferNodeType(name, data);

  const children: ProfileNode[] = [];
  const childData = data.children || data.nodes || [];
  
  if (Array.isArray(childData)) {
    for (const child of childData) {
      children.push(parseNode(child, "unknown"));
    }
  }

  return {
    name,
    type,
    file: data.file || data.filepath || data.filename || extractFile(name),
    line: data.line || data.lineNumber || data.line_number,
    time,
    totalTime: totalTime || time + children.reduce((sum, c) => sum + c.totalTime, 0),
    children,
  };
}

function createEmptyNode(name: string): ProfileNode {
  return {
    name,
    type: "unknown",
    time: 0,
    totalTime: 0,
    children: [],
  };
}

/**
 * Infer the node type from its name and data
 */
function inferNodeType(name: string, data: any): string {
  if (data.type) return data.type;
  
  const nameLower = name.toLowerCase();
  if (nameLower.includes("snippet") || nameLower.startsWith("snippets/")) return "snippet";
  if (nameLower.includes("section") || nameLower.startsWith("sections/")) return "section";
  if (nameLower.includes("template") || nameLower.startsWith("templates/")) return "template";
  if (nameLower.includes("layout") || nameLower.startsWith("layout/")) return "layout";
  if (nameLower.includes("block")) return "block";
  if (nameLower.startsWith("{%")) return "tag";
  if (nameLower.startsWith("{{")) return "output";
  
  return "other";
}

/**
 * Extract file path from node name
 */
function extractFile(name: string): string | undefined {
  // Match patterns like "snippets/header.liquid" or "sections/footer.liquid"
  const match = name.match(
    /((?:snippets|sections|templates|layout|blocks)\/[\w-]+\.liquid)/
  );
  return match?.[1];
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Generate a profile summary from profiling data
 */
export function generateSummary(data: ProfilingData): ProfileSummary {
  const tree = parseProfilingTree(data.tree);
  const totalTime = data.totalTime || tree.totalTime;
  
  // Collect all nodes flattened
  const allNodes: ProfileNode[] = [];
  flattenNodes(tree, allNodes);

  // Find the top slow nodes (by self time)
  const topSlowNodes: SlowNode[] = allNodes
    .filter((n) => n.time > 0)
    .sort((a, b) => b.time - a.time)
    .slice(0, 10)
    .map((n) => ({
      name: n.name,
      type: n.type,
      file: n.file,
      line: n.line,
      time: Math.round(n.time * 100) / 100,
      percentage: totalTime > 0
        ? Math.round((n.time / totalTime) * 10000) / 100
        : 0,
    }));

  // Aggregate by template/file
  const fileMap = new Map<string, { renders: number; totalTime: number; selfTime: number }>();
  for (const node of allNodes) {
    const file = node.file || node.name;
    if (!file) continue;
    
    const existing = fileMap.get(file) || { renders: 0, totalTime: 0, selfTime: 0 };
    existing.renders += 1;
    existing.totalTime += node.totalTime;
    existing.selfTime += node.time;
    fileMap.set(file, existing);
  }

  const templateBreakdown: TemplateStats[] = Array.from(fileMap.entries())
    .map(([file, stats]) => ({
      file,
      renders: stats.renders,
      totalTime: Math.round(stats.totalTime * 100) / 100,
      selfTime: Math.round(stats.selfTime * 100) / 100,
      percentage: totalTime > 0
        ? Math.round((stats.totalTime / totalTime) * 10000) / 100
        : 0,
    }))
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, 20);

  return {
    totalRenderTime: Math.round(totalTime * 100) / 100,
    nodeCount: allNodes.length,
    topSlowNodes,
    templateBreakdown,
    timestamp: data.timestamp,
  };
}

/**
 * Flatten node tree into array
 */
function flattenNodes(node: ProfileNode, result: ProfileNode[]): void {
  result.push(node);
  for (const child of node.children) {
    flattenNodes(child, result);
  }
}
