/**
 * 内容分析器
 * 分析文本内容：代码检测、JSON提取、敏感信息过滤等
 */
export class ContentAnalyzer {
  constructor(options = {}) {
    this._codePatterns = [
      { lang: 'javascript', pattern: /```(?:javascript|js|node)\n([\s\S]*?)```/gi },
      { lang: 'typescript', pattern: /```typescript\n([\s\S]*?)```/gi },
      { lang: 'python', pattern: /```(?:python|py)\n([\s\S]*?)```/gi },
      { lang: 'java', pattern: /```java\n([\s\S]*?)```/gi },
      { lang: 'csharp', pattern: /```(?:csharp|c#)\n([\s\S]*?)```/gi },
      { lang: 'go', pattern: /```go\n([\s\S]*?)```/gi },
      { lang: 'rust', pattern: /```rust\n([\s\S]*?)```/gi },
      { lang: 'sql', pattern: /```sql\n([\s\S]*?)```/gi },
      { lang: 'bash', pattern: /```(?:bash|sh|shell)\n([\s\S]*?)```/gi },
      { lang: 'json', pattern: /```json\n([\s\S]*?)```/gi },
      { lang: 'html', pattern: /```html\n([\s\S]*?)```/gi },
      { lang: 'css', pattern: /```css\n([\s\S]*?)```/gi },
      { lang: 'xml', pattern: /```xml\n([\s\S]*?)```/gi },
      { lang: 'yaml', pattern: /```yaml\n([\s\S]*?)```/gi },
      { lang: 'markdown', pattern: /```markdown\n([\s\S]*?)```/gi },
      { lang: 'plain', pattern: /```\n([\s\S]*?)```/gi }
    ];

    this._intentPatterns = {
      code_generation: [
        /write.*code|generate.*code|create.*function|implement/i,
        /```\w+\n/,
        /def \w+\(|function \w+\(|class \w+/
      ],
      debugging: [
        /debug|error|exception|bug|fix|issue|problem/i,
        /stack.*trace|traceback|at line \d+/
      ],
      explanation: [
        /explain|what.*is|how.*does|tell.*me|describe|understand/i,
        /what.*mean|meaning.*of/i
      ],
      summarization: [
        /summarize|summary|condense|brief|shorten/i,
        /in.*short|to.*sum.*up|key.*points/
      ],
      translation: [
        /translate|translation|convert.*to|into.*language/i,
        /in.*chinese|in.*english|in.*japanese/
      ],
      data_analysis: [
        /analyze|analysis|statistic|trend|pattern|correlation/i,
        /data.*point|distribution|percentage/
      ],
      question_answering: [
        /what.*is|who.*is|when.*did|where.*is|why.*did|how.*does/i,
        /\?$/
      ],
      creative: [
        /write.*story|write.*poem|creative|imagine|generate.*idea/i,
        /brainstorm|dream.*up/
      ],
      extraction: [
        /extract|find.*all|identify.*all|list.*all|get.*from/i,
        /parse.*data|pull.*out|crawl/
      ]
    };

    this._sensitivePatterns = [
      /api[_-]?key/i,
      /password/i,
      /secret/i,
      /token/i,
      /bearer/i,
      /authorization/i,
      /private[_-]?key/i,
      /-----BEGIN.*PRIVATE KEY-----/,
      /-----BEGIN.*CERTIFICATE-----/,
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    ];
  }

  analyze(content) {
    return {
      hasCode: this.detectCode(content),
      codeBlocks: this.extractCodeBlocks(content),
      hasJson: this.detectJson(content),
      parsedJson: this.extractJson(content),
      hasMarkdown: this.detectMarkdown(content),
      formatted: this.formatMarkdown(content),
      hasSensitive: this.detectSensitive(content),
      filtered: this.filterSensitive(content),
      intent: this.recognizeIntent(content),
      statistics: this.getStatistics(content)
    };
  }

  detectCode(content) {
    for (const { pattern } of this._codePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        return true;
      }
    }
    return false;
  }

  extractCodeBlocks(content) {
    const blocks = [];

    for (const { lang, pattern } of this._codePatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        blocks.push({
          language: lang,
          code: match[1] || match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length
        });
      }
    }

    return blocks.sort((a, b) => a.startIndex - b.startIndex);
  }

  detectJson(content) {
    const trimmed = content.trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch (e) {}
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch (e) {}
    }

    const jsonBlockPattern = /```json\s*([\s\S]*?)\s*```/gi;
    let match;
    while ((match = jsonBlockPattern.exec(content)) !== null) {
      try {
        JSON.parse(match[1]);
        return true;
      } catch (e) {}
    }

    return false;
  }

  extractJson(content) {
    const trimmed = content.trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return { success: true, data: JSON.parse(trimmed), isBlock: false };
      } catch (e) {}
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        return { success: true, data: JSON.parse(trimmed), isBlock: false };
      } catch (e) {}
    }

    const jsonBlockPattern = /```json\s*([\s\S]*?)\s*```/gi;
    let match;
    while ((match = jsonBlockPattern.exec(content)) !== null) {
      try {
        return { success: true, data: JSON.parse(match[1]), isBlock: true };
      } catch (e) {}
    }

    return { success: false, data: null, isBlock: false };
  }

  detectMarkdown(content) {
    const markdownPatterns = [
      /^#{1,6}\s/m,
      /\*\*[^*]+\*\*/,
      /\*[^*]+\*/,
      /\[.+\]\(.+\)/,
      /```/m,
      />/m,
      /[-*]\s/m,
      /\d+\.\s/m
    ];

    let matchCount = 0;
    for (const pattern of markdownPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        matchCount++;
      }
    }

    return matchCount >= 2;
  }

  formatMarkdown(content) {
    return content
      .replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `\`\`\`${lang || ''}\n${code.trim()}\n\`\`\``;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^#{1,6}\s(.+)$/gm, (match, text) => {
        const level = match.match(/^#+/)[0].length;
        return `<h${level}>${text}</h${level}>`;
      })
      .replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^[-*]\s(.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>');
  }

  detectSensitive(content) {
    for (const pattern of this._sensitivePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        return true;
      }
    }
    return false;
  }

  filterSensitive(content, replacement = '[REDACTED]') {
    let filtered = content;

    for (const pattern of this._sensitivePatterns) {
      filtered = filtered.replace(pattern, replacement);
    }

    return filtered;
  }

  recognizeIntent(content) {
    const scores = {};

    for (const [intent, patterns] of Object.entries(this._intentPatterns)) {
      let score = 0;
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        if (pattern.test(content)) {
          score++;
        }
      }
      if (score > 0) {
        scores[intent] = score;
      }
    }

    if (Object.keys(scores).length === 0) {
      return { primary: 'general', confidence: 0, all: scores };
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const primary = sorted[0][0];
    const maxScore = sorted[0][1];
    const confidence = Math.min(1, maxScore / 3);

    return { primary, confidence, all: scores };
  }

  getStatistics(content) {
    const lines = content.split('\n');
    const words = content.split(/\s+/).filter(w => w.length > 0);
    const chars = content.length;

    const codeBlocks = this.extractCodeBlocks(content);
    const totalCodeLines = codeBlocks.reduce((sum, block) => {
      return sum + block.code.split('\n').length;
    }, 0);

    return {
      lines: lines.length,
      words: words.length,
      chars,
      codeLines: totalCodeLines,
      textLines: lines.length - totalCodeLines,
      hasCode: codeBlocks.length > 0,
      codeLanguages: [...new Set(codeBlocks.map(b => b.language))]
    };
  }
}

export default ContentAnalyzer;
