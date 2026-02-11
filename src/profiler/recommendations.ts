/**
 * Performance Recommendations Engine
 * 
 * Analyzes speedscope profiling data to automatically detect known Shopify
 * Liquid anti-patterns and generate actionable optimization suggestions.
 * 
 * Each recommendation includes:
 *   - Severity (critical / warning / info)
 *   - The specific file and line causing the issue
 *   - Measured impact (time and percentage)
 *   - A concrete fix suggestion
 */

import type { ProfilingData, ProfileNode, ProfileSummary, SlowNode, TemplateStats } from "./flamegraph-parser.js";

// ============================================================================
// Types
// ============================================================================

export type Severity = "critical" | "warning" | "info";

export interface Recommendation {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  impact: {
    timeMs: number;
    percentage: number;
  };
  suggestion: string;
  category: string;
}

export interface RecommendationsReport {
  totalRenderTimeMs: number;
  overallRating: "fast" | "moderate" | "slow" | "critical";
  recommendations: Recommendation[];
  summary: {
    critical: number;
    warning: number;
    info: number;
    estimatedSavingsMs: number;
  };
}

// ============================================================================
// Thresholds
// ============================================================================

const THRESHOLDS = {
  /** Overall render time ratings (in ms) */
  overallFast: 100,
  overallModerate: 250,
  overallSlow: 500,

  /** Single operation taking too long (in ms) */
  singleOpCritical: 10,
  singleOpWarning: 5,

  /** Template rendered too many times */
  excessiveRendersCritical: 500,
  excessiveRendersWarning: 100,

  /** Template taking too much % of total time */
  templatePercentCritical: 15,
  templatePercentWarning: 8,

  /** Third-party app block threshold (ms) */
  appBlockWarning: 2,
};

// ============================================================================
// Known Anti-Patterns
// ============================================================================

interface AntiPattern {
  id: string;
  category: string;
  title: string;
  /** Test against node name to detect the pattern */
  match: (node: FlatNode) => boolean;
  /** Generate recommendation description */
  describe: (node: FlatNode, totalTime: number) => { description: string; suggestion: string };
  /** Minimum severity for this pattern */
  minSeverity: Severity;
}

interface FlatNode {
  name: string;
  type: string;
  file?: string;
  line?: number;
  time: number;       // self time
  totalTime: number;  // total time including children
}

const ANTI_PATTERNS: AntiPattern[] = [
  // ──────────────────────────────────────────────────────────────
  // all_products[] global lookup
  // ──────────────────────────────────────────────────────────────
  {
    id: "all-products-lookup",
    category: "Expensive Lookup",
    title: "all_products[] global lookup",
    match: (node) =>
      node.name.includes("all_products[") ||
      node.name.includes("all_products ["),
    describe: (node) => ({
      description:
        `\`all_products[handle]\` is one of the slowest Liquid operations. ` +
        `Each call performs a full product lookup by handle. ` +
        `Found in \`${node.file || "unknown"}\` at line ${node.line || "?"}.`,
      suggestion:
        `Replace \`all_products[block.settings.product]\` with a section setting ` +
        `that uses a product picker (\`"type": "product"\` in the schema). ` +
        `The product picker pre-loads the product object, avoiding the expensive global lookup. ` +
        `If inside a loop, this is especially critical — each iteration triggers a separate lookup.`,
    }),
    minSeverity: "warning",
  },

  // ──────────────────────────────────────────────────────────────
  // content_for_header string manipulation
  // ──────────────────────────────────────────────────────────────
  {
    id: "content-for-header-manipulation",
    category: "String Manipulation",
    title: "content_for_header string manipulation",
    match: (node) =>
      node.name.includes("content_for_header") &&
      (node.name.includes("contains") ||
        node.name.includes("split") ||
        node.name.includes("for ") ||
        node.name.includes("assign")),
    describe: (node) => ({
      description:
        `\`content_for_header\` is a very large string containing all Shopify-injected scripts. ` +
        `Performing string operations (contains, split, for loops) on it is extremely expensive. ` +
        `Found in \`${node.file || "unknown"}\` at line ${node.line || "?"}.`,
      suggestion:
        `This pattern is commonly used by SEO/speed optimization apps (like SEOAnt SpeedUp). ` +
        `Consider: (1) Disabling the app if it's not providing measurable benefit, or ` +
        `(2) Moving the script manipulation to JavaScript on the client side, or ` +
        `(3) Using \`{% content_for_header %}\` without modification and deferring scripts via \`async\`/\`defer\` attributes instead.`,
    }),
    minSeverity: "warning",
  },

  // ──────────────────────────────────────────────────────────────
  // Expensive for loop over content_for_header
  // ──────────────────────────────────────────────────────────────
  {
    id: "for-loop-content-for-header",
    category: "String Manipulation",
    title: "Iterating over content_for_header",
    match: (node) =>
      node.name.includes("for ") && node.name.includes("content_for_header"),
    describe: (node) => ({
      description:
        `Iterating a for loop over \`content_for_header\` characters is extremely expensive. ` +
        `This string can be 50KB+ and iterating character by character is O(n). ` +
        `Found in \`${node.file || "unknown"}\` at line ${node.line || "?"}.`,
      suggestion:
        `Remove the character-level iteration entirely. If the goal is to modify injected scripts, ` +
        `use JavaScript-based script loading instead of Liquid string manipulation. ` +
        `This single change can save 5-10ms of render time.`,
    }),
    minSeverity: "critical",
  },

  // ──────────────────────────────────────────────────────────────
  // Cart drawer rendered on every page
  // ──────────────────────────────────────────────────────────────
  {
    id: "cart-drawer-always-rendered",
    category: "Unnecessary Rendering",
    title: "Cart drawer rendered on every page",
    match: (node) =>
      ((node.name.includes("render 'cart-drawer'") ||
        node.name.includes("cart-drawer")) &&
      node.type === "render") || (!!node.file?.includes("cart-drawer") && node.type === "template"),
    describe: (node) => ({
      description:
        `The cart drawer snippet is rendered on every page load, even when the cart is empty. ` +
        `It takes ${(node.totalTime).toFixed(1)}ms per page load.`,
      suggestion:
        `Consider lazy-loading the cart drawer via JavaScript (fetch it only when the cart icon ` +
        `is clicked or hovered). Alternatively, wrap the render call with ` +
        `\`{% if cart.item_count > 0 %}{% render 'cart-drawer' %}{% endif %}\` ` +
        `to skip rendering when the cart is empty. Note: this may affect "add to cart" UX.`,
    }),
    minSeverity: "info",
  },

  // ──────────────────────────────────────────────────────────────
  // money filter in loops (expensive per-call)
  // ──────────────────────────────────────────────────────────────
  {
    id: "money-filter-in-render",
    category: "Expensive Filter",
    title: "money filter with high render time",
    match: (node) =>
      node.name.includes("| money") && node.totalTime > 1,
    describe: (node) => ({
      description:
        `The \`| money\` filter has a noticeable cost per invocation. ` +
        `When used inside loops that render many products, the cumulative cost adds up. ` +
        `This instance in \`${node.file || "unknown"}\` takes ${(node.totalTime).toFixed(1)}ms.`,
      suggestion:
        `If this is inside a product carousel or collection loop, consider: ` +
        `(1) Reducing the number of products displayed, ` +
        `(2) Using raw price values and formatting client-side with JavaScript, or ` +
        `(3) Caching the formatted price in an assign before the loop if the price is the same for multiple variants.`,
    }),
    minSeverity: "info",
  },

  // ──────────────────────────────────────────────────────────────
  // image_url filter (moderately expensive)
  // ──────────────────────────────────────────────────────────────
  {
    id: "image-url-heavy",
    category: "Expensive Filter",
    title: "image_url filter with high cumulative cost",
    match: (node) =>
      (node.name.includes("| image_url") || node.name.includes("| img_url")) &&
      node.totalTime > 2,
    describe: (node) => ({
      description:
        `Image URL processing (\`image_url\` or \`img_url\` filter) in ` +
        `\`${node.file || "unknown"}\` is taking ${(node.totalTime).toFixed(1)}ms. ` +
        `This filter transforms image URLs for Shopify's CDN.`,
      suggestion:
        `Reduce the number of image transformations by: ` +
        `(1) Using \`loading="lazy"\` to defer off-screen images, ` +
        `(2) Reducing the number of image variants/sizes requested, or ` +
        `(3) Pre-computing image URLs outside of loops using \`assign\`.`,
    }),
    minSeverity: "info",
  },

  // ──────────────────────────────────────────────────────────────
  // Schema tag (usually fast, but can be slow if huge)
  // ──────────────────────────────────────────────────────────────
  {
    id: "large-schema",
    category: "Large Schema",
    title: "Slow schema parsing",
    match: (node) =>
      node.name.includes("tag:schema") && node.totalTime > 3,
    describe: (node) => ({
      description:
        `The \`{% schema %}\` block in \`${node.file || "unknown"}\` is taking ` +
        `${(node.totalTime).toFixed(1)}ms to parse. Large schema blocks with many ` +
        `settings and blocks slow down rendering.`,
      suggestion:
        `Review the schema for unused settings or blocks that can be removed. ` +
        `Consider splitting complex sections into smaller, focused sections. ` +
        `Each schema definition is parsed on every page load.`,
    }),
    minSeverity: "info",
  },
];

// ============================================================================
// Main Analysis Functions
// ============================================================================

/**
 * Generate performance recommendations from profiling data.
 */
export function generateRecommendations(
  data: ProfilingData,
  summary?: ProfileSummary
): RecommendationsReport {
  const totalTimeMs = data.totalTime;
  const recommendations: Recommendation[] = [];

  // Flatten the tree for pattern matching
  const flatNodes = flattenTree(data.tree);

  // 1. Check overall render time
  addOverallTimeRecommendation(recommendations, totalTimeMs);

  // 2. Detect known anti-patterns
  for (const pattern of ANTI_PATTERNS) {
    const matchingNodes = flatNodes.filter(pattern.match);
    
    for (const node of matchingNodes) {
      const pct = totalTimeMs > 0 ? (node.totalTime / totalTimeMs) * 100 : 0;
      const { description, suggestion } = pattern.describe(node, totalTimeMs);

      // Determine severity based on impact
      let severity: Severity = pattern.minSeverity;
      if (node.totalTime > THRESHOLDS.singleOpCritical || pct > 5) {
        severity = "critical";
      } else if (node.totalTime > THRESHOLDS.singleOpWarning || pct > 2) {
        severity = severity === "info" ? "warning" : severity;
      }

      // Deduplicate: don't add if we already have the same pattern + file + line
      const dedupKey = `${pattern.id}:${node.file}:${node.line}`;
      if (recommendations.some(r => r.id === dedupKey)) continue;

      recommendations.push({
        id: dedupKey,
        severity,
        title: pattern.title,
        description,
        file: node.file,
        line: node.line,
        impact: {
          timeMs: Math.round(node.totalTime * 100) / 100,
          percentage: Math.round(pct * 100) / 100,
        },
        suggestion,
        category: pattern.category,
      });
    }
  }

  // 3. Check for excessive render counts
  if (summary?.templateBreakdown) {
    addExcessiveRenderRecommendations(recommendations, summary.templateBreakdown, totalTimeMs);
  }

  // 4. Check for third-party app blocks
  addAppBlockRecommendations(recommendations, flatNodes, totalTimeMs);

  // 5. Check for templates taking disproportionate time
  if (summary?.templateBreakdown) {
    addHeavyTemplateRecommendations(recommendations, summary.templateBreakdown, totalTimeMs);
  }

  // Sort by severity (critical first) then by impact
  const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  recommendations.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.impact.timeMs - a.impact.timeMs;
  });

  // Calculate overall rating
  const overallRating = getOverallRating(totalTimeMs);

  // Calculate estimated savings (sum of critical + warning items * 50% as conservative estimate)
  const estimatedSavingsMs = recommendations
    .filter(r => r.severity === "critical" || r.severity === "warning")
    .reduce((sum, r) => sum + r.impact.timeMs * 0.5, 0);

  return {
    totalRenderTimeMs: Math.round(totalTimeMs * 100) / 100,
    overallRating,
    recommendations,
    summary: {
      critical: recommendations.filter(r => r.severity === "critical").length,
      warning: recommendations.filter(r => r.severity === "warning").length,
      info: recommendations.filter(r => r.severity === "info").length,
      estimatedSavingsMs: Math.round(estimatedSavingsMs * 100) / 100,
    },
  };
}

// ============================================================================
// Individual Recommendation Generators
// ============================================================================

function addOverallTimeRecommendation(recommendations: Recommendation[], totalTimeMs: number): void {
  if (totalTimeMs > THRESHOLDS.overallSlow) {
    recommendations.push({
      id: "overall-render-time",
      severity: "critical",
      title: "Overall render time is very slow",
      description:
        `Total Liquid render time is ${totalTimeMs.toFixed(0)}ms, which exceeds the ${THRESHOLDS.overallSlow}ms threshold. ` +
        `This significantly impacts page load speed and Core Web Vitals (TTFB, LCP).`,
      impact: { timeMs: totalTimeMs, percentage: 100 },
      suggestion:
        `Review the critical and warning recommendations below for specific optimizations. ` +
        `Target reducing total render time to under ${THRESHOLDS.overallModerate}ms. ` +
        `Key strategies: remove unused sections, reduce product lookups, simplify mega menus, ` +
        `and audit third-party app blocks.`,
      category: "Overall Performance",
    });
  } else if (totalTimeMs > THRESHOLDS.overallModerate) {
    recommendations.push({
      id: "overall-render-time",
      severity: "warning",
      title: "Overall render time is moderate",
      description:
        `Total Liquid render time is ${totalTimeMs.toFixed(0)}ms. ` +
        `While acceptable, there's room for improvement. Target is under ${THRESHOLDS.overallFast}ms.`,
      impact: { timeMs: totalTimeMs, percentage: 100 },
      suggestion:
        `Review the recommendations below for optimization opportunities. ` +
        `Focus on the highest-impact items first.`,
      category: "Overall Performance",
    });
  }
}

function addExcessiveRenderRecommendations(
  recommendations: Recommendation[],
  breakdown: TemplateStats[],
  totalTimeMs: number
): void {
  for (const template of breakdown) {
    if (template.renders >= THRESHOLDS.excessiveRendersCritical) {
      const pct = totalTimeMs > 0 ? (template.totalTime / totalTimeMs) * 100 : 0;
      recommendations.push({
        id: `excessive-renders:${template.file}`,
        severity: "critical",
        title: `Excessive renders: ${template.file}`,
        description:
          `\`${template.file}\` is rendered ${template.renders} times per page load, ` +
          `consuming ${template.totalTime.toFixed(1)}ms (${pct.toFixed(1)}%). ` +
          `This suggests deeply nested loops or excessive block iteration.`,
        file: template.file,
        impact: {
          timeMs: Math.round(template.totalTime * 100) / 100,
          percentage: Math.round(pct * 100) / 100,
        },
        suggestion:
          `Investigate why this template is rendered ${template.renders} times. Common causes: ` +
          `(1) Nested for loops iterating over menu links × sub-links × blocks, ` +
          `(2) The template is included inside another loop, ` +
          `(3) Excessive section blocks. Consider simplifying the template or reducing the number of items.`,
        category: "Excessive Rendering",
      });
    } else if (template.renders >= THRESHOLDS.excessiveRendersWarning) {
      const pct = totalTimeMs > 0 ? (template.totalTime / totalTimeMs) * 100 : 0;
      if (pct > 2) { // Only warn if it's actually impactful
        recommendations.push({
          id: `excessive-renders:${template.file}`,
          severity: "warning",
          title: `High render count: ${template.file}`,
          description:
            `\`${template.file}\` is rendered ${template.renders} times per page load ` +
            `(${pct.toFixed(1)}% of total time).`,
          file: template.file,
          impact: {
            timeMs: Math.round(template.totalTime * 100) / 100,
            percentage: Math.round(pct * 100) / 100,
          },
          suggestion:
            `Review if all ${template.renders} renders are necessary. ` +
            `Consider reducing loop iterations, paginating content, or lazy-loading off-screen sections.`,
          category: "Excessive Rendering",
        });
      }
    }
  }
}

function addAppBlockRecommendations(
  recommendations: Recommendation[],
  flatNodes: FlatNode[],
  totalTimeMs: number
): void {
  // Group app block nodes by app
  const appNodes = flatNodes.filter(
    (n) =>
      n.file?.startsWith("shopify://apps/") ||
      n.name.includes("shopify://apps/")
  );

  // Aggregate by app name
  const appMap = new Map<string, { totalTime: number; file: string; count: number }>();
  for (const node of appNodes) {
    const file = node.file || node.name;
    // Extract app name: shopify://apps/<app-name>/blocks/...
    const appMatch = file.match(/shopify:\/\/apps\/([^/]+)/);
    const appName = appMatch ? appMatch[1] : file;

    const existing = appMap.get(appName) || { totalTime: 0, file, count: 0 };
    existing.totalTime += node.totalTime;
    existing.count += 1;
    appMap.set(appName, existing);
  }

  for (const [appName, stats] of appMap) {
    const pct = totalTimeMs > 0 ? (stats.totalTime / totalTimeMs) * 100 : 0;
    if (stats.totalTime > THRESHOLDS.appBlockWarning) {
      recommendations.push({
        id: `app-block:${appName}`,
        severity: pct > 3 ? "warning" : "info",
        title: `Third-party app: ${appName}`,
        description:
          `The \`${appName}\` app block takes ${stats.totalTime.toFixed(1)}ms ` +
          `(${pct.toFixed(1)}% of total render time). Third-party app blocks execute ` +
          `server-side Liquid on every page load.`,
        file: stats.file,
        impact: {
          timeMs: Math.round(stats.totalTime * 100) / 100,
          percentage: Math.round(pct * 100) / 100,
        },
        suggestion:
          `Evaluate if this app is essential for this page. Options: ` +
          `(1) Disable the app embed if it's not needed on all pages, ` +
          `(2) Contact the app developer about performance optimization, ` +
          `(3) Consider alternative apps with lighter Liquid footprint, ` +
          `(4) If the app provides client-side functionality, check if it can load asynchronously.`,
        category: "Third-Party Apps",
      });
    }
  }
}

function addHeavyTemplateRecommendations(
  recommendations: Recommendation[],
  breakdown: TemplateStats[],
  totalTimeMs: number
): void {
  for (const template of breakdown) {
    const pct = totalTimeMs > 0 ? (template.totalTime / totalTimeMs) * 100 : 0;

    // Skip if we already have a recommendation for this file
    // (e.g., from anti-patterns or excessive renders)
    const existingForFile = breakdown.some(
      t => t.file === template.file && t !== template
    );

    if (pct > THRESHOLDS.templatePercentCritical && !template.file.includes("layout/theme")) {
      // layout/theme always dominates, so only flag other templates
      recommendations.push({
        id: `heavy-template:${template.file}`,
        severity: "warning",
        title: `Heavy template: ${template.file}`,
        description:
          `\`${template.file}\` accounts for ${pct.toFixed(1)}% of total render time ` +
          `(${template.totalTime.toFixed(1)}ms across ${template.renders} renders).`,
        file: template.file,
        impact: {
          timeMs: Math.round(template.totalTime * 100) / 100,
          percentage: Math.round(pct * 100) / 100,
        },
        suggestion:
          `This template is a major contributor to page render time. Consider: ` +
          `(1) Simplifying its Liquid logic, ` +
          `(2) Reducing the number of product/collection lookups within it, ` +
          `(3) Moving complex calculations to JavaScript (client-side), ` +
          `(4) Splitting it into smaller, conditionally-loaded sub-sections.`,
        category: "Heavy Templates",
      });
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function flattenTree(tree: any): FlatNode[] {
  const result: FlatNode[] = [];

  function walk(node: any): void {
    if (!node) return;

    result.push({
      name: node.name || "",
      type: node.type || "other",
      file: node.file,
      line: node.line,
      time: node.time || 0,
      totalTime: node.totalTime || 0,
    });

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return result;
}

function getOverallRating(totalTimeMs: number): "fast" | "moderate" | "slow" | "critical" {
  if (totalTimeMs <= THRESHOLDS.overallFast) return "fast";
  if (totalTimeMs <= THRESHOLDS.overallModerate) return "moderate";
  if (totalTimeMs <= THRESHOLDS.overallSlow) return "slow";
  return "critical";
}
