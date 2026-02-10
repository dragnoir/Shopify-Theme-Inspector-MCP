export interface SourceLocation {
  line: number;
  column: number;
}

export interface AnalysisIssue {
  type: "warning" | "error" | "info";
  message: string;
  location: SourceLocation;
  codeSnippet: string;
}

export interface AnalysisResult {
  issues: AnalysisIssue[];
  score: number; // 0-100
}

/**
 * Statically analyze Liquid code for performance anti-patterns
 */
export function analyzeLiquidCode(code: string): AnalysisResult {
  const issues: AnalysisIssue[] = [];
  const lines = code.split("\n");

  let nestingLevel = 0;
  let maxNesting = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for 'all_products' usage (major performance killer)
    if (line.includes("all_products")) {
      issues.push({
        type: "error",
        message: "Avoid using `all_products`. It is deprecated and extremely slow. Use collections or search instead.",
        location: { line: lineNum, column: line.indexOf("all_products") },
        codeSnippet: line.trim()
      });
    }

    // Check for deep nesting (nested loops)
    const openLoops = (line.match(/{%\s*for\s/g) || []).length;
    const closeLoops = (line.match(/{%\s*endfor\s*%}/g) || []).length;
    
    // Simple nesting tracking (might be fooled by comments/strings but good enough for rough check)
    nestingLevel += openLoops;
    
    if (nestingLevel > 2 && openLoops > 0) {
       issues.push({
        type: "warning",
        message: `Deeply nested loop (Level ${nestingLevel}). processing nested arrays can be slow.`,
        location: { line: lineNum, column: line.indexOf("{%") },
        codeSnippet: line.trim()
      });  
    }

    if (nestingLevel > maxNesting) maxNesting = nestingLevel;
    
    nestingLevel -= closeLoops;
    if (nestingLevel < 0) nestingLevel = 0;

    // Check for 'collections' iteration without filtering (potentially slow)
    if (line.match(/{%\s*for\s+.*\s+in\s+collections\s*%}/)) {
       issues.push({
        type: "warning",
        message: "Iterating over all `collections` can be slow if you have many collections.",
        location: { line: lineNum, column: 0 },
        codeSnippet: line.trim()
      });
    }
  }

  // Calculate generic score
  const score = Math.max(0, 100 - (issues.length * 10));

  return {
    issues,
    score
  };
}
