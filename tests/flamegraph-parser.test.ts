import { describe, it, expect } from 'vitest';

// Mirror the functions from src/profiler/flamegraph-parser.ts for testing
// This allows us to test the logic without importing internal functions

interface ProfileNode {
  name: string;
  type: string;
  file?: string;
  line?: number;
  time: number;
  totalTime: number;
  children: ProfileNode[];
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

function extractFile(name: string): string | undefined {
  const match = name.match(
    /((?:snippets|sections|templates|layout|blocks)\/[\w-]+\.liquid)/
  );
  return match?.[1];
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

function parseProfilingTree(rawData: any): ProfileNode {
  if (!rawData) {
    return createEmptyNode("root");
  }
  return parseNode(rawData, "root");
}

describe('parseProfilingTree', () => {
  describe('null/undefined handling', () => {
    it('should return empty node for null input', () => {
      const result = parseProfilingTree(null);
      expect(result.name).toBe('root');
      expect(result.type).toBe('unknown');
      expect(result.time).toBe(0);
    });

    it('should return empty node for undefined input', () => {
      const result = parseProfilingTree(undefined);
      expect(result.name).toBe('root');
      expect(result.type).toBe('unknown');
    });

    it('should return empty node for non-object input', () => {
      const result = parseProfilingTree("string");
      expect(result.name).toBe('root');
      expect(result.type).toBe('unknown');
    });
  });

  describe('basic node parsing', () => {
    it('should parse node with name', () => {
      const input = { name: 'template', time: 100 };
      const result = parseProfilingTree(input);
      expect(result.name).toBe('template');
      expect(result.time).toBe(100);
    });

    it('should use label as name fallback', () => {
      const input = { label: 'section-name', time: 50 };
      const result = parseProfilingTree(input);
      expect(result.name).toBe('section-name');
    });

    it('should use code as name fallback', () => {
      const input = { code: 'my-code', time: 50 };
      const result = parseProfilingTree(input);
      expect(result.name).toBe('my-code');
    });

    it('should use defaultName when no name provided', () => {
      const input = { time: 50 };
      const result = parseProfilingTree(input);
      expect(result.name).toBe('root');
    });
  });

  describe('time field handling', () => {
    it('should parse time field', () => {
      const input = { name: 'test', time: 100 };
      expect(parseProfilingTree(input).time).toBe(100);
    });

    it('should parse self_time field', () => {
      const input = { name: 'test', self_time: 200 };
      expect(parseProfilingTree(input).time).toBe(200);
    });

    it('should parse selfTime field', () => {
      const input = { name: 'test', selfTime: 300 };
      expect(parseProfilingTree(input).time).toBe(300);
    });

    it('should parse duration field', () => {
      const input = { name: 'test', duration: 400 };
      expect(parseProfilingTree(input).time).toBe(400);
    });
  });

  describe('children parsing', () => {
    it('should parse children array', () => {
      const input = {
        name: 'root',
        time: 100,
        children: [
          { name: 'child1', time: 50 },
          { name: 'child2', time: 30 }
        ]
      };
      const result = parseProfilingTree(input);
      expect(result.children).toHaveLength(2);
      expect(result.children[0].name).toBe('child1');
      expect(result.children[1].name).toBe('child2');
    });

    it('should parse nested children', () => {
      const input = {
        name: 'root',
        time: 100,
        children: [
          {
            name: 'parent',
            time: 50,
            children: [
              { name: 'child', time: 25 }
            ]
          }
        ]
      };
      const result = parseProfilingTree(input);
      expect(result.children[0].children).toHaveLength(1);
      expect(result.children[0].children[0].name).toBe('child');
    });

    it('should handle nodes array as children', () => {
      const input = {
        name: 'root',
        nodes: [
          { name: 'node1', time: 50 }
        ]
      };
      const result = parseProfilingTree(input);
      expect(result.children).toHaveLength(1);
    });
  });
});

describe('inferNodeType', () => {
  it('should return type from data.type', () => {
    expect(inferNodeType('anything', { type: 'custom-type' })).toBe('custom-type');
  });

  it('should detect snippet type', () => {
    expect(inferNodeType('snippets/header.liquid', {})).toBe('snippet');
    expect(inferNodeType('my snippet', {})).toBe('snippet');
  });

  it('should detect section type', () => {
    expect(inferNodeType('sections/footer.liquid', {})).toBe('section');
    expect(inferNodeType('my section', {})).toBe('section');
  });

  it('should detect template type', () => {
    expect(inferNodeType('templates/index.liquid', {})).toBe('template');
    expect(inferNodeType('my template', {})).toBe('template');
  });

  it('should detect layout type', () => {
    expect(inferNodeType('layout/theme.liquid', {})).toBe('layout');
    expect(inferNodeType('my layout', {})).toBe('layout');
  });

  it('should detect block type', () => {
    expect(inferNodeType('some block', {})).toBe('block');
  });

  it('should detect tag type', () => {
    expect(inferNodeType('{% for %}', {})).toBe('tag');
  });

  it('should detect output type', () => {
    expect(inferNodeType('{{ product.title }}', {})).toBe('output');
  });

  it('should return other for unknown types', () => {
    expect(inferNodeType('random-name', {})).toBe('other');
  });
});

describe('extractFile', () => {
  it('should extract snippets path', () => {
    expect(extractFile('snippets/header.liquid')).toBe('snippets/header.liquid');
  });

  it('should extract sections path', () => {
    expect(extractFile('sections/footer.liquid')).toBe('sections/footer.liquid');
  });

  it('should extract templates path', () => {
    // Note: Current regex only matches .liquid files
    expect(extractFile('templates/index.liquid')).toBe('templates/index.liquid');
  });

  it('should extract layout path', () => {
    expect(extractFile('layout/theme.liquid')).toBe('layout/theme.liquid');
  });

  it('should extract blocks path', () => {
    expect(extractFile('blocks/announcement.liquid')).toBe('blocks/announcement.liquid');
  });

  it('should return undefined for non-matching names', () => {
    expect(extractFile('some-random-name')).toBeUndefined();
  });
});
